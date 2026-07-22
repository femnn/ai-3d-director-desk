export function createFrame(payload) {
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

export function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  const messages = [];

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const finalFrame = (first & 0x80) !== 0;
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
    } else {
      payload = Buffer.from(payload);
    }
    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) {
      client.fragments = [];
      client.fragmentedOpcode = null;
      client.socket.end();
      continue;
    }
    if (opcode === 0x1) {
      if (finalFrame) messages.push(payload.toString("utf8"));
      else {
        client.fragmentedOpcode = opcode;
        client.fragments = [payload];
      }
      continue;
    }
    if (opcode === 0x0 && client.fragmentedOpcode !== null) {
      client.fragments.push(payload);
      if (finalFrame) {
        if (client.fragmentedOpcode === 0x1) messages.push(Buffer.concat(client.fragments).toString("utf8"));
        client.fragments = [];
        client.fragmentedOpcode = null;
      }
    }
  }

  return messages;
}
