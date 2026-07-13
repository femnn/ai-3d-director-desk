import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetPlatform = process.argv.find((argument) => argument.startsWith("--platform="))?.split("=")[1] ?? process.platform;
const target = targetPlatform === "win32"
  ? {
      cloudflaredName: "cloudflared-windows-x64.exe",
      cloudflaredUrl: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
      ffmpegName: "ffmpeg-windows-x64.exe",
      ffmpegPackage: ["@ffmpeg-installer", "win32-x64", "ffmpeg.exe"],
    }
  : {
      cloudflaredName: "cloudflared-darwin-arm64",
      cloudflaredUrl: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
      ffmpegName: "ffmpeg-darwin-arm64",
      ffmpegPackage: ["@ffmpeg-installer", "darwin-arm64", "ffmpeg"],
    };

if (targetPlatform !== "win32" && targetPlatform !== "darwin") {
  throw new Error(`Unsupported desktop target: ${targetPlatform}`);
}

const binaryDirectory = path.join(projectRoot, "tools", "desktop-bin");
await fs.mkdir(binaryDirectory, { recursive: true });

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const ffmpegTarget = path.join(binaryDirectory, target.ffmpegName);
if (!(await exists(ffmpegTarget))) {
  const ffmpegSource = path.join(projectRoot, "node_modules", ...target.ffmpegPackage);
  if (!(await exists(ffmpegSource))) {
    throw new Error(`Missing ${targetPlatform} FFmpeg package. Run npm install on the target platform first.`);
  }
  await fs.copyFile(ffmpegSource, ffmpegTarget);
  await fs.chmod(ffmpegTarget, 0o755);
}

const cloudflaredTarget = path.join(binaryDirectory, target.cloudflaredName);
if (!(await exists(cloudflaredTarget))) {
  const response = await fetch(target.cloudflaredUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`cloudflared download failed: HTTP ${response.status}`);
  const download = Buffer.from(await response.arrayBuffer());
  if (targetPlatform === "darwin") {
    const archive = path.join(binaryDirectory, "cloudflared-darwin-arm64.tgz");
    await fs.writeFile(archive, download);
    const { spawnSync } = await import("node:child_process");
    const unpacked = spawnSync("tar", ["-xzf", archive, "-C", binaryDirectory], { encoding: "utf8" });
    await fs.rm(archive, { force: true });
    if (unpacked.status !== 0) throw new Error(unpacked.stderr || "Unable to unpack cloudflared");
    const downloadedBinary = path.join(binaryDirectory, "cloudflared");
    await fs.rename(downloadedBinary, cloudflaredTarget);
  } else {
    await fs.writeFile(cloudflaredTarget, download);
  }
  await fs.chmod(cloudflaredTarget, 0o755);
}

console.log(`Desktop binaries ready for ${targetPlatform}.`);
