import { app, BrowserWindow, dialog } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let quitting = false;
let logFile = null;

function writeLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (!logFile) {
    process.stdout.write(line);
    return;
  }
  try {
    fs.appendFileSync(logFile, line, "utf8");
  } catch {
    process.stdout.write(line);
  }
}

function initializeLogging() {
  const logDirectory = app.getPath("logs");
  fs.mkdirSync(logDirectory, { recursive: true });
  logFile = path.join(logDirectory, "director-desk.log");
  writeLog(`app=${app.getVersion()} platform=${process.platform} packaged=${app.isPackaged}`);
  writeLog(`resources=${process.resourcesPath} appRoot=${app.getAppPath()}`);
}

function getRuntimeBinary(name) {
  const extension = process.platform === "win32" ? ".exe" : "";
  if (!app.isPackaged) {
    const platformName = process.platform === "win32" ? "windows-x64" : "darwin-arm64";
    return path.join(app.getAppPath(), "tools", "desktop-bin", `${name}-${platformName}${extension}`);
  }
  return path.join(process.resourcesPath, "bin", `${name}${extension}`);
}

function startDirectorServer() {
  const appRoot = app.getAppPath();
  const serverScript = path.join(appRoot, "server", "dev-server.mjs");
  const staticRoot = path.join(appRoot, "dist");
  writeLog(`starting server script=${serverScript} staticRoot=${staticRoot}`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverScript], {
      cwd: app.isPackaged ? process.resourcesPath : appRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        DIRECTOR_DESK_OPEN: "0",
        DIRECTOR_DESK_STATIC_ROOT: staticRoot,
        CLOUDFLARED_PATH: getRuntimeBinary("cloudflared"),
        FFMPEG_PATH: getRuntimeBinary("ffmpeg"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    serverProcess = child;
    let settled = false;
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      writeLog(`server stdout: ${String(chunk).trim()}`);
      const match = String(chunk).match(/Director desk: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match && !settled) {
        settled = true;
        serverUrl = match[1];
        resolve(match[1]);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
      writeLog(`server stderr: ${String(chunk).trim()}`);
    });
    child.on("error", (error) => {
      writeLog(`server spawn error: ${error.stack ?? error.message}`);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("exit", (code) => {
      serverProcess = null;
      serverUrl = null;
      if (!settled) {
        settled = true;
        reject(new Error(stderr || `导演台服务启动失败，退出码 ${code ?? "unknown"}`));
      } else if (!quitting && code !== 0) {
        writeLog(`server exited code=${code ?? "unknown"}`);
        void dialog.showErrorBox("导演台服务已停止", stderr || `后台服务退出码 ${code ?? "unknown"}`);
      }
    });
  });
}

async function createWindow() {
  const url = serverUrl ?? (await startDirectorServer());
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0b1018",
    show: false,
    title: "AI影视导演台",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(url);
  writeLog(`window loaded ${url}`);
  const loaded = await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const startedAt = Date.now();
      const inspect = () => {
        const hasDirectorDesk = Boolean(document.querySelector('.director-canvas'));
        if (hasDirectorDesk || Date.now() - startedAt > 10000) {
          resolve({ title: document.title, hasDirectorDesk });
          return;
        }
        setTimeout(inspect, 100);
      };
      inspect();
    })`
  );
  if (!loaded?.hasDirectorDesk) throw new Error("桌面窗口未能加载导演台界面");
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

app.whenReady().then(() => {
  initializeLogging();
  void createWindow().catch((error) => {
    writeLog(`startup error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    dialog.showErrorBox("无法启动AI影视导演台", error instanceof Error ? error.message : String(error));
    app.quit();
  });
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => {
  quitting = true;
  serverProcess?.kill("SIGTERM");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
