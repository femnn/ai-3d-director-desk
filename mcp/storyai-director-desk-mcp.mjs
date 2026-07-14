#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const CONTROL_FILE = path.join(os.homedir(), ".config", "storyai-director-desk", "control.json");
const POLL_INTERVAL_MS = 200;
const RESULT_TIMEOUT_MS = 10_000;

const tools = [
  "get_scene",
  "reset_scene",
  "apply_scene_script",
  "validate_scene_plan",
  "apply_scene_plan",
  "get_scene_plan",
  "add_character",
  "update_character",
  "add_prop",
  "add_group",
  "update_prop",
  "add_camera",
  "set_camera_view",
  "delete_object",
  "capture_shot",
  "export_project",
  "export_scene_script",
  "export_character",
  "import_character",
  "import_scene_script",
  "record_camera_animation",
  "play_camera_animation",
  "screenshot",
].map((name) => ({
  name,
  description: `StoryAI director desk tool: ${name}`,
  inputSchema: {
    type: "object",
    additionalProperties: true,
  },
}));

function readControlInfo() {
  const raw = fs.readFileSync(CONTROL_FILE, "utf8");
  return JSON.parse(raw);
}

async function callDirectorDesk(tool, args = {}) {
  const control = readControlInfo();
  const baseUrl = `http://127.0.0.1:${control.port}`;
  const commandResponse = await fetch(`${baseUrl}/api/agent/command`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${control.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tool, args }),
  });

  if (!commandResponse.ok) {
    throw new Error(`Director desk command failed: HTTP ${commandResponse.status}`);
  }

  const command = await commandResponse.json();
  const startedAt = Date.now();
  while (Date.now() - startedAt < RESULT_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const resultResponse = await fetch(`${baseUrl}/api/agent/result/${encodeURIComponent(command.id)}`, {
      headers: {
        "authorization": `Bearer ${control.token}`,
      },
    });
    const payload = await resultResponse.json();
    if (payload.pending) continue;
    if (payload.error) throw new Error(payload.error);
    return payload.result;
  }

  throw new Error("Timed out waiting for the director desk browser tab to process the command");
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "storyai-director-desk", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }

  if (method === "tools/call") {
    try {
      const result = await callDirectorDesk(params?.name, params?.arguments ?? {});
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Tool call failed",
        },
      });
    }
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  lines.forEach((line) => {
    if (!line.trim()) return;
    try {
      void handleRequest(JSON.parse(line));
    } catch (error) {
      send({
        jsonrpc: "2.0",
        error: {
          code: -32700,
          message: error instanceof Error ? error.message : "Invalid JSON",
        },
      });
    }
  });
});
