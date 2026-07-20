import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import QRCode from "qrcode";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const DEFAULT_HTTP_PORT = 5173;
const CONTROL_DIR = path.join(os.homedir(), ".config", "storyai-director-desk");
const CONTROL_FILE = path.join(CONTROL_DIR, "control.json");
const VIDEO_TEMP_DIR = path.join(os.tmpdir(), "storyai-director-desk-video");
const PHONE_ASSET_DIR = path.join(os.tmpdir(), "storyai-director-desk-phone-assets");
const GENERATED_ANIMATION_DIR = path.join(CONTROL_DIR, "generated-animations");
const ANIMOFLOW_URL = (process.env.ANIMOFLOW_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const REMOTE_ANIMOFLOW_URL = "https://animoflow-animoflow-demo.hf.space";
const CLOUDFLARED_PATH = process.env.CLOUDFLARED_PATH || path.resolve("tools/cloudflared/cloudflared");
const FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegInstaller.path;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const token = process.env.DIRECTOR_DESK_TOKEN || crypto.randomBytes(24).toString("hex");
const phoneSessionToken = crypto.randomBytes(24).toString("base64url");
const commandResults = new Map();
const pendingAgentCommands = [];
const remoteAnimoJobs = new Map();
const phoneAssetContentTypes = new Map();
const clients = new Map();
let commandSeq = 0;
let clientSeq = 0;
let activeDesktopClientId = null;
let phoneState = null;
let latestDesktopState = null;
let tunnelBaseUrl = null;
let tunnelProcess = null;
let tunnelRestartTimer = null;
let shuttingDown = false;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function readBuffer(req, limit = 120_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Video is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getVideoFilter(captureFrameRate) {
  return captureFrameRate <= 30
    ? "fps=30,minterpolate=fps=60:mi_mode=blend"
    : "fps=60";
}

function convertWebmToMp4(inputPath, outputPath, captureFrameRate = 60, maxDurationSeconds = 5) {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG_PATH,
      [
        "-y",
        "-i",
        inputPath,
        "-t",
        String(maxDurationSeconds),
        "-vf",
        getVideoFilter(captureFrameRate),
        "-vsync",
        "cfr",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { maxBuffer: 2_000_000 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const details = stderr
          ?.trim()
          .split("\n")
          .slice(-6)
          .join("\n");
        reject(new Error(details || error.message));
      }
    );
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, contentType, body) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

const STATIC_CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".task", "application/octet-stream"],
  [".wasm", "application/wasm"],
]);

async function serveStaticApp(req, res, staticRoot) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
  } catch {
    sendJson(res, 400, { error: "Invalid path" });
    return;
  }
  const root = path.resolve(staticRoot);
  const requestedPath = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  const insideRoot = requestedPath === root || requestedPath.startsWith(`${root}${path.sep}`);
  if (!insideRoot) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  let filePath = requestedPath;
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(root, "index.html");
  }

  try {
    const body = await fs.promises.readFile(filePath);
    res.writeHead(200, {
      "content-type": STATIC_CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
      "content-length": body.length,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function sendRemoteAnimoJob(res, job, status = 200) {
  sendJson(res, status, {
    job_id: job.id,
    status: job.status,
    download_url: job.downloadUrl ?? null,
    error: job.error ?? null,
  });
}

async function proxyRemoteAnimoFlow(req, res, suffix, body) {
  if (req.method === "GET" && suffix === "/health") {
    sendJson(res, 200, { status: "ready", provider: "remote-animoflow" });
    return;
  }

  if (req.method === "POST" && suffix === "/jobs") {
    let request;
    try {
      request = JSON.parse(String(body ?? "{}"));
    } catch {
      sendJson(res, 400, { error: "Invalid AnimoFlow request" });
      return;
    }
    const prompt = typeof request.prompt === "string"
      ? request.prompt.trim()
      : typeof request.input?.prompt === "string"
        ? request.input.prompt.trim()
        : "";
    if (!prompt) {
      sendJson(res, 400, { error: "Missing animation prompt" });
      return;
    }
    const id = `remote_${crypto.randomBytes(10).toString("hex")}`;
    const duration = typeof request.duration === "number" && Number.isFinite(request.duration) ? Math.min(Math.max(request.duration, 1), 10) : 5;
    const job = { id, status: "running", downloadUrl: null, sourceUrl: null, error: null };
    remoteAnimoJobs.set(id, job);
    const model = ["mdm", "momask", "kimodo"].includes(request.model) ? request.model : "mdm";
    const character = ["Doozy", "Kaya", "Knight", "Suzie", "Vanguard", "Y_bot"].includes(request.character)
      ? request.character
      : "Y_bot";
    void fetch(`${REMOTE_ANIMOFLOW_URL}/gradio_api/call/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: [prompt, model, character, duration, Math.floor(Math.random() * 1_000_000)] }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || typeof payload?.event_id !== "string") {
          throw new Error(payload?.detail || payload?.error || "AnimoFlow did not accept the animation request");
        }
        const eventResponse = await fetch(`${REMOTE_ANIMOFLOW_URL}/gradio_api/call/generate/${payload.event_id}`);
        const eventText = await eventResponse.text();
        const completedData = eventText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data: "))
          .map((line) => {
            try {
              return JSON.parse(line.slice(6));
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .pop();
        const downloadUrl = completedData?.[0]?.url;
        if (!eventResponse.ok || typeof downloadUrl !== "string") throw new Error("AnimoFlow did not return an animation file");
        job.status = "done";
        job.sourceUrl = downloadUrl;
        job.downloadUrl = `/api/animoflow/files/${id}`;
      })
      .catch((error) => {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "Remote AnimoFlow generation failed";
      });
    sendRemoteAnimoJob(res, job, 202);
    return;
  }

  const jobMatch = suffix.match(/^\/jobs\/([a-zA-Z0-9_.-]+)$/);
  if (req.method === "GET" && jobMatch) {
    const job = remoteAnimoJobs.get(jobMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: "Unknown AnimoFlow job" });
      return;
    }
    sendRemoteAnimoJob(res, job);
    return;
  }

  const fileMatch = suffix.match(/^\/files\/(remote_[a-zA-Z0-9_.-]+)$/);
  if (req.method === "GET" && fileMatch) {
    const job = remoteAnimoJobs.get(fileMatch[1]);
    if (!job?.sourceUrl) {
      sendJson(res, 404, { error: "Generated animation is not ready" });
      return;
    }
    try {
      const response = await fetch(job.sourceUrl);
      if (!response.ok) throw new Error("Remote animation download failed");
      res.writeHead(200, {
        "content-type": response.headers.get("content-type") ?? "model/gltf-binary",
        "cache-control": "no-store",
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      sendJson(res, 502, { error: "无法下载 AnimoFlow 生成的动作文件" });
    }
    return;
  }

  sendJson(res, 503, { error: "AnimoFlow 代理不可用" });
}

async function proxyAnimoflowRequest(req, res, url) {
  const suffix = url.pathname.slice("/api/animoflow".length);
  if (!/^\/(health|tasks|jobs(?:\/[a-zA-Z0-9_.-]+)?|files\/[a-zA-Z0-9_.-]+)$/.test(suffix)) {
    sendJson(res, 404, { error: "Unknown AnimoFlow endpoint" });
    return;
  }

  const body = ["POST", "PUT", "PATCH"].includes(req.method ?? "") ? await readBuffer(req) : undefined;
  if (suffix.startsWith("/files/remote_")) {
    await proxyRemoteAnimoFlow(req, res, suffix, body);
    return;
  }
  try {
    const response = await fetch(`${ANIMOFLOW_URL}/v1${suffix}${url.search}`, {
      method: req.method,
      headers: req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : undefined,
      body: body?.length ? body : undefined,
    });
    if (response.status >= 500) throw new Error("Local AnimoFlow unavailable");
    const content = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(content);
  } catch {
    await proxyRemoteAnimoFlow(req, res, suffix, body);
  }
}

function isAuthorized(req) {
  return req.headers.authorization === `Bearer ${token}`;
}

function getLanAddresses(port, protocol = "http") {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("198.18.")) {
        addresses.push(`${protocol}://${entry.address}:${port}`);
      }
    }
  }
  return addresses;
}

function getPhoneUrl(port, protocol = "http") {
  return `${getLanAddresses(port, protocol)[0] ?? `${protocol}://127.0.0.1:${port}`}/phone?mode=standard`;
}

function getPublicPhoneUrl(mode = "motion") {
  return tunnelBaseUrl
    ? `${tunnelBaseUrl}/phone?mode=${encodeURIComponent(mode)}&session=${encodeURIComponent(phoneSessionToken)}`
    : null;
}

function isTunnelRequest(req) {
  const host = String(req.headers.host ?? "").split(":")[0].toLowerCase();
  return host.endsWith(".trycloudflare.com");
}

function hasPhoneSessionCookie(req) {
  const cookies = String(req.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim());
  return cookies.includes(`storyai_phone_session=${phoneSessionToken}`);
}

function authorizeTunnelRequest(req, res) {
  if (!isTunnelRequest(req)) return true;
  const url = new URL(req.url ?? "/", `https://${req.headers.host}`);
  const validQuerySession = url.pathname === "/phone" && url.searchParams.get("session") === phoneSessionToken;
  if (validQuerySession) {
    res.setHeader(
      "set-cookie",
      `storyai_phone_session=${phoneSessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`
    );
    return true;
  }
  if (hasPhoneSessionCookie(req)) return true;
  sendText(res, 403, "text/plain; charset=utf-8", "Invalid or expired phone session.");
  return false;
}

function startQuickTunnel(httpPort) {
  if (!fs.existsSync(CLOUDFLARED_PATH)) {
    console.warn(`Secure phone tunnel unavailable: ${CLOUDFLARED_PATH} is missing.`);
    return;
  }

  tunnelBaseUrl = null;
  const child = spawn(
    CLOUDFLARED_PATH,
    ["tunnel", "--url", `http://127.0.0.1:${httpPort}`, "--no-autoupdate", "--loglevel", "info"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );
  tunnelProcess = child;

  const handleOutput = (chunk) => {
    const output = String(chunk);
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (!match || tunnelBaseUrl === match[0]) return;
    tunnelBaseUrl = match[0];
    console.log(`Secure phone controller: ${getPublicPhoneUrl()}`);
  };

  child.stdout.on("data", handleOutput);
  child.stderr.on("data", handleOutput);
  child.on("exit", () => {
    if (tunnelProcess === child) tunnelProcess = null;
    tunnelBaseUrl = null;
    if (shuttingDown) return;
    tunnelRestartTimer = setTimeout(() => startQuickTunnel(httpPort), 1500);
  });
}

function waitForFreePort(startPort) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const tester = net.createServer();
      tester.once("error", () => tryPort(port + 1));
      tester.once("listening", () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, "0.0.0.0");
    };
    tryPort(startPort);
  });
}

function createFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const length = body.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), body]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, body]);
}

function sendSocketJson(client, payload) {
  if (!client || client.socket.destroyed) return;
  client.socket.write(createFrame(payload));
}

function broadcastToType(type, payload) {
  clients.forEach((client) => {
    if (client.type === type) sendSocketJson(client, payload);
  });
}

function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  const messages = [];

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) break;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) break;
      length = Number(client.buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (client.buffer.length < offset + length) break;

    let payload = client.buffer.subarray(offset, offset + length);
    if (masked) {
      const mask = client.buffer.subarray(maskOffset, maskOffset + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }
    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) {
      client.socket.end();
      continue;
    }
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
  }

  return messages;
}

function getActiveDesktopClient() {
  const desktops = Array.from(clients.values()).filter((client) => client.type === "desktop");
  if (!desktops.length) {
    activeDesktopClientId = null;
    return null;
  }
  const ranked = desktops.sort((a, b) => {
    const score = (client) => (client.hasFocus ? 4 : 0) + (client.visibilityState === "visible" ? 2 : 0);
    return score(b) - score(a) || b.lastActiveAt - a.lastActiveAt;
  });
  const active = ranked[0];
  activeDesktopClientId = active.id;
  return active;
}

function getPhoneControllerId(payload, fallback) {
  const candidate = typeof payload?.phoneClientId === "string" ? payload.phoneClientId : "";
  return /^[a-z0-9_-]{8,80}$/i.test(candidate) ? candidate : fallback;
}

function releaseDisconnectedPhoneController(phoneClientId) {
  setTimeout(() => {
    const stillConnected = Array.from(clients.values()).some(
      (client) => client.type === "phone" && client.phoneControllerId === phoneClientId
    );
    if (stillConnected) return;
    const desktop = getActiveDesktopClient();
    if (desktop) sendSocketJson(desktop, { type: "phone_disconnected", phoneClientId });
  }, 5000);
}

function flushPendingAgentCommands() {
  const desktop = getActiveDesktopClient();
  if (!desktop) return;
  while (pendingAgentCommands.length > 0) {
    sendSocketJson(desktop, { type: "agent_command", command: pendingAgentCommands.shift() });
  }
}

function queueAgentCommand(command) {
  const desktop = getActiveDesktopClient();
  if (desktop) {
    sendSocketJson(desktop, { type: "agent_command", command });
    return;
  }
  pendingAgentCommands.push(command);
}

function handleSocketMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    sendSocketJson(client, { type: "error", error: "Invalid JSON" });
    return;
  }

  if (message.type === "client_hello") {
    client.type = message.clientType === "phone" ? "phone" : "desktop";
    if (client.type === "desktop") {
      client.visibilityState = message.visibilityState === "hidden" ? "hidden" : "visible";
      client.hasFocus = message.hasFocus === true;
      client.lastActiveAt = Date.now();
      getActiveDesktopClient();
      flushPendingAgentCommands();
    }
    sendSocketJson(client, {
      type: "connection_ready",
      clientId: client.id,
      clientType: client.type,
      desktopState: latestDesktopState,
    });
    if (client.type === "phone" && latestDesktopState) {
      sendSocketJson(client, { type: "desktop_state", state: latestDesktopState });
    }
    return;
  }

  if (message.type === "desktop_presence" && client.type === "desktop") {
    client.visibilityState = message.visibilityState === "hidden" ? "hidden" : "visible";
    client.hasFocus = message.hasFocus === true;
    client.lastActiveAt = Date.now();
    getActiveDesktopClient();
    return;
  }

  if (message.type === "desktop_state" && client.type === "desktop") {
    if (getActiveDesktopClient()?.id !== client.id) return;
    latestDesktopState = message.state ? { ...(latestDesktopState ?? {}), ...message.state } : null;
    // Current phones only need the fields sent by this frame. The server keeps
    // the merged state so a newly connected phone still receives the latest
    // scene preview without retransmitting large motion clips at animation FPS.
    broadcastToType("phone", { type: "desktop_state", state: message.state });
    return;
  }

  if ((message.type === "phone_state" || message.type === "phone_control" || message.type === "phone_mocap" || message.type === "phone_pose") && client.type === "phone") {
    const phoneClientId = getPhoneControllerId(message.payload, client.id);
    client.phoneControllerId = phoneClientId;
    phoneState = {
      ...(message.payload ?? {}),
      phoneClientId,
      updatedAt:
        typeof message.payload?.updatedAt === "number" && Number.isFinite(message.payload.updatedAt)
          ? message.payload.updatedAt
          : Date.now(),
    };
    const desktop = getActiveDesktopClient();
    if (desktop) {
      sendSocketJson(desktop, { type: message.type, payload: phoneState });
    }
    return;
  }

  if (message.type === "agent_result" && client.type === "desktop") {
    if (typeof message.id !== "string") {
      sendSocketJson(client, { type: "error", error: "Missing agent result id" });
      return;
    }
    commandResults.set(message.id, {
      result: message.result ?? null,
      error: message.error ?? null,
      completedAt: Date.now(),
    });
  }
}

function handleUpgrade(req, socket) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  if (url.pathname !== "/realtime" || (isTunnelRequest(req) && !hasPhoneSessionCookie(req))) {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );

  const client = {
    id: `client_${Date.now()}_${++clientSeq}`,
    type: "unknown",
    socket,
    buffer: Buffer.alloc(0),
    phoneControllerId: null,
    visibilityState: "hidden",
    hasFocus: false,
    lastActiveAt: Date.now(),
  };
  clients.set(client.id, client);

  socket.on("data", (chunk) => {
    parseFrames(client, chunk).forEach((message) => handleSocketMessage(client, message));
  });
  socket.on("close", () => {
    clients.delete(client.id);
    if (client.type === "phone" && client.phoneControllerId) {
      releaseDisconnectedPhoneController(client.phoneControllerId);
    }
    if (activeDesktopClientId === client.id) {
      activeDesktopClientId = null;
      getActiveDesktopClient();
    }
  });
  socket.on("error", () => {
    clients.delete(client.id);
  });
}

async function handleApi(req, res, context) {
  const { desktopUrl, port, protocol } = context;
  const url = new URL(req.url ?? "/", `${protocol}://${req.headers.host ?? "127.0.0.1"}`);
  const phoneUrl = getPublicPhoneUrl();

  if (url.pathname === "/api/generated-animations" && req.method === "POST") {
    try {
      const requestedFileName = path.basename(url.searchParams.get("fileName") || "animation.glb");
      const extension = path.extname(requestedFileName).toLowerCase();
      if (!/[.](fbx|glb|gltf)$/.test(extension)) throw new Error("Unsupported animation format");
      const animation = await readBuffer(req);
      if (!animation.length) throw new Error("Animation is empty");
      const id = crypto.randomBytes(12).toString("hex");
      const fileName = `${id}${extension}`;
      fs.mkdirSync(GENERATED_ANIMATION_DIR, { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(path.join(GENERATED_ANIMATION_DIR, fileName), animation, { mode: 0o600 });
      sendJson(res, 201, { url: `/api/generated-animations/${fileName}`, fileName });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Animation persistence failed" });
    }
    return true;
  }

  const generatedAnimationMatch = url.pathname.match(/^\/api\/generated-animations\/([a-f0-9]{24}\.(?:fbx|glb|gltf))$/i);
  if (generatedAnimationMatch && req.method === "GET") {
    const fileName = generatedAnimationMatch[1];
    const filePath = path.join(GENERATED_ANIMATION_DIR, fileName);
    try {
      const animation = await fs.promises.readFile(filePath);
      const extension = path.extname(fileName).toLowerCase();
      sendText(res, 200, extension === ".glb" ? "model/gltf-binary" : "application/octet-stream", animation);
    } catch {
      sendJson(res, 404, { error: "Generated animation is no longer available" });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const lanUrls = getLanAddresses(port, protocol);
    const localPhoneUrl = getPhoneUrl(port, protocol);
    sendJson(res, 200, {
      desktopUrl,
      phoneUrl,
      localPhoneUrl,
      websocketUrl: isTunnelRequest(req) ? `wss://${url.host}/realtime` : `ws://${url.hostname}:${port}/realtime`,
      lanUrls,
      secure: Boolean(phoneUrl),
      tunnelStatus: phoneUrl ? "ready" : fs.existsSync(CLOUDFLARED_PATH) ? "connecting" : "unavailable",
    });
    return true;
  }

  if (url.pathname.startsWith("/api/animoflow/")) {
    await proxyAnimoflowRequest(req, res, url);
    return true;
  }

  const phoneAssetIdMatch = url.pathname.match(/^\/api\/phone-assets\/([a-zA-Z0-9_-]{1,120})$/);
  if (phoneAssetIdMatch) {
    const assetId = phoneAssetIdMatch[1];
    const assetPath = path.join(PHONE_ASSET_DIR, assetId);

    if (req.method === "POST") {
      try {
        const asset = await readBuffer(req);
        if (!asset.length) throw new Error("Asset is empty");
        fs.mkdirSync(PHONE_ASSET_DIR, { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(assetPath, asset, { mode: 0o600 });
        phoneAssetContentTypes.set(assetId, String(req.headers["content-type"] ?? "application/octet-stream"));
        sendJson(res, 200, { url: `/api/phone-assets/${assetId}` });
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : "Asset upload failed" });
      }
      return true;
    }

    if (req.method === "GET") {
      try {
        const asset = await fs.promises.readFile(assetPath);
        res.writeHead(200, {
          "content-type": phoneAssetContentTypes.get(assetId) ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(asset);
      } catch {
        sendJson(res, 404, { error: "Phone asset not found" });
      }
      return true;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/phone-qr.svg") {
    const mode = url.searchParams.get("mode");
    const qrPhoneUrl = mode === "standard" ? getPhoneUrl(port, protocol) : getPublicPhoneUrl(mode === "pose" ? mode : "motion");
    if (!qrPhoneUrl) {
      sendJson(res, 503, { error: "Secure phone tunnel is not ready" });
      return true;
    }
    const svg = await QRCode.toString(qrPhoneUrl, {
      type: "svg",
      margin: 1,
      width: 256,
      color: {
        dark: "#101820",
        light: "#ffffff",
      },
    });
    sendText(res, 200, "image/svg+xml; charset=utf-8", svg);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/video/convert") {
    const id = crypto.randomBytes(12).toString("hex");
    const inputPath = path.join(VIDEO_TEMP_DIR, `${id}.webm`);
    const outputPath = path.join(VIDEO_TEMP_DIR, `${id}.mp4`);
    try {
      const captureFrameRate = Number(req.headers["x-capture-frame-rate"]) === 30 ? 30 : 60;
      const requestedDuration = Number(req.headers["x-recording-duration"]);
      const maxDurationSeconds = requestedDuration === 10 || requestedDuration === 15 ? requestedDuration : 5;
      const video = await readBuffer(req);
      if (!video.length) throw new Error("Video is empty");
      fs.mkdirSync(VIDEO_TEMP_DIR, { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(inputPath, video);
      await convertWebmToMp4(inputPath, outputPath, captureFrameRate, maxDurationSeconds);
      const mp4 = await fs.promises.readFile(outputPath);
      res.writeHead(200, {
        "content-type": "video/mp4",
        "cache-control": "no-store",
      });
      res.end(mp4);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Video conversion failed" });
    } finally {
      fs.rmSync(inputPath, { force: true });
      fs.rmSync(outputPath, { force: true });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/phone-state") {
    try {
      const payload = await readJson(req);
      phoneState = {
        ...payload,
        updatedAt: Date.now(),
      };
      const desktop = getActiveDesktopClient();
      if (desktop) sendSocketJson(desktop, { type: "phone_state", payload: phoneState });
      sendJson(res, 200, { ok: true, updatedAt: phoneState.updatedAt });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid phone state" });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/phone-state") {
    sendJson(res, 200, phoneState ?? { updatedAt: 0 });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/command") {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    try {
      const payload = await readJson(req);
      const id = `cmd_${Date.now()}_${++commandSeq}`;
      queueAgentCommand({
        id,
        tool: payload.tool,
        args: payload.args ?? {},
        createdAt: Date.now(),
      });
      sendJson(res, 200, { id, queued: true, activeDesktop: Boolean(getActiveDesktopClient()) });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid command" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/result") {
    try {
      const payload = await readJson(req);
      if (typeof payload.id !== "string") {
        sendJson(res, 400, { error: "Missing command id" });
        return true;
      }
      commandResults.set(payload.id, {
        result: payload.result ?? null,
        error: payload.error ?? null,
        completedAt: Date.now(),
      });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid result" });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/agent/result/")) {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    const id = decodeURIComponent(url.pathname.slice("/api/agent/result/".length));
    sendJson(res, 200, commandResults.get(id) ?? { pending: true });
    return true;
  }

  return false;
}

async function main() {
  const httpPort = Number(process.env.PORT) || (await waitForFreePort(DEFAULT_HTTP_PORT));
  const staticRoot = process.env.DIRECTOR_DESK_STATIC_ROOT;
  const vite = staticRoot
    ? null
    : await import("vite").then(({ createServer }) =>
        createServer({
          server: { middlewareMode: true, allowedHosts: [".trycloudflare.com"] },
          appType: "spa",
        })
      );
  const desktopUrl = `http://127.0.0.1:${httpPort}/`;

  function createRequestHandler(context) {
    return async (req, res) => {
      if (!authorizeTunnelRequest(req, res)) return;
      if (await handleApi(req, res, context)) return;
      if (vite) {
        vite.middlewares(req, res);
        return;
      }
      await serveStaticApp(req, res, staticRoot);
    };
  }

  const httpServer = http.createServer(
    createRequestHandler({
      desktopUrl,
      port: httpPort,
      protocol: "http",
    })
  );
  httpServer.on("upgrade", handleUpgrade);

  function onListening() {
    fs.mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      CONTROL_FILE,
      JSON.stringify(
        {
          port: httpPort,
          httpPort,
          token,
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    console.log(`Director desk: ${desktopUrl}`);
    console.log(`Local phone fallback: ${getPhoneUrl(httpPort)}`);
    console.log(`Realtime socket: ws://127.0.0.1:${httpPort}/realtime`);
    console.log(`Agent control: ${CONTROL_FILE}`);
    if (process.env.DIRECTOR_DESK_OPEN === "1" && process.platform === "darwin") {
      const opener = spawn("open", [desktopUrl], { detached: true, stdio: "ignore" });
      opener.unref();
    }
    startQuickTunnel(httpPort);
  }

  httpServer.listen(httpPort, "0.0.0.0", onListening);

  const cleanup = () => {
    shuttingDown = true;
    if (tunnelRestartTimer) clearTimeout(tunnelRestartTimer);
    tunnelProcess?.kill("SIGTERM");
    try {
      fs.rmSync(CONTROL_FILE, { force: true });
      fs.rmSync(PHONE_ASSET_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures on shutdown.
    }
    httpServer.close();
    void vite?.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
