import { describe, expect, it, vi } from "vitest";
import { createFrame, parseFrames } from "./websocket-frames.mjs";

function createMaskedClientFrame(opcode: number, finalFrame: boolean, text: string) {
  const body = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const length = body.length;
  const lengthHeader = length < 126 ? Buffer.from([0x80 | length]) : Buffer.from([0x80 | 126, length >> 8, length & 0xff]);
  const header = Buffer.from([(finalFrame ? 0x80 : 0) | opcode]);
  const maskedBody = Buffer.from(body.map((byte, index) => byte ^ mask[index % 4]));
  return Buffer.concat([header, lengthHeader, mask, maskedBody]);
}

function createClient() {
  return {
    buffer: Buffer.alloc(0),
    fragmentedOpcode: null as number | null,
    fragments: [] as Buffer[],
    socket: { end: vi.fn() },
  };
}

describe("websocket frames", () => {
  it("reassembles a fragmented browser text message", () => {
    const client = createClient();
    const first = createMaskedClientFrame(0x1, false, '{"type":"desktop_state","state":{"phonePreviewProject":"');
    const second = createMaskedClientFrame(0x0, false, "large-scene");
    const third = createMaskedClientFrame(0x0, true, '"}}');

    expect(parseFrames(client, first)).toEqual([]);
    expect(parseFrames(client, second)).toEqual([]);
    expect(parseFrames(client, third)).toEqual([
      '{"type":"desktop_state","state":{"phonePreviewProject":"large-scene"}}',
    ]);
  });

  it("waits for a complete network chunk before parsing a frame", () => {
    const client = createClient();
    const frame = createMaskedClientFrame(0x1, true, '{"type":"client_hello"}');

    expect(parseFrames(client, frame.subarray(0, 7))).toEqual([]);
    expect(parseFrames(client, frame.subarray(7))).toEqual(['{"type":"client_hello"}']);
  });

  it("creates an unmasked final text frame for server messages", () => {
    const frame = createFrame({ type: "desktop_state" });

    expect(frame[0]).toBe(0x81);
    expect(frame[1] & 0x80).toBe(0);
  });
});
