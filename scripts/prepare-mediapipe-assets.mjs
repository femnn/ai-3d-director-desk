import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public", "mediapipe");
const wasmSource = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmTarget = path.join(publicRoot, "wasm");
const modelTarget = path.join(publicRoot, "pose_landmarker_full.task");
const modelUrl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

fs.mkdirSync(wasmTarget, { recursive: true });
if (fs.existsSync(wasmSource)) {
  fs.cpSync(wasmSource, wasmTarget, { recursive: true, force: true });
}

if (!fs.existsSync(modelTarget)) {
  try {
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(modelTarget, Buffer.from(await response.arrayBuffer()));
    console.log("Prepared local MediaPipe pose model.");
  } catch (error) {
    console.warn(`MediaPipe pose model was not downloaded: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
