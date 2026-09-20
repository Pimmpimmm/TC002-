import net from 'node:net';
import { ProbeError } from './safety.mjs';

function remainingLength(length) {
  const bytes = [];
  do {
    let digit = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) digit |= 0x80;
    bytes.push(digit);
  } while (length > 0);
  return Buffer.from(bytes);
}

function utf8(value) {
  const body = Buffer.from(value);
  const size = Buffer.alloc(2);
  size.writeUInt16BE(body.length);
  return Buffer.concat([size, body]);
}

export function packet(typeAndFlags, body = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([typeAndFlags]), remainingLength(body.length), body]);
}

export function publishPacket(topic, payload) {
  return packet(0x30, Buffer.concat([utf8(topic), Buffer.from(payload)]));
}

export class MqttClient {
  constructor({ host, port, clientId = `tc002-probe-${process.pid}` }) {
    this.host = host; this.port = port; this.clientId = clientId;
    this.socket = null; this.buffer = Buffer.alloc(0); this.handlers = [];
    this.disconnectHandlers = []; this.pingTimer = null; this.closing = false;
  }

  async connect(timeoutMs = 5000) {
    this.closing = false;
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.on('data', chunk => this.#consume(chunk));
    this.socket.on('error', () => {});
    this.socket.once('close', hadError => {
      this.#stopKeepalive();
      if (!this.closing) {
        for (const handler of this.disconnectHandlers) handler({ hadError });
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ProbeError('ALARM MQTT connect timeout')), timeoutMs);
      this.socket.once('error', reject);
      this.socket.once('connect', () => { clearTimeout(timer); resolve(); });
    });
    const variable = Buffer.concat([utf8('MQTT'), Buffer.from([4, 2]), Buffer.from([0, 120])]);
    this.socket.write(packet(0x10, Buffer.concat([variable, utf8(this.clientId)])));
    const connack = await this.#waitFor(2, timeoutMs);
    if (connack.body.length < 2 || connack.body[1] !== 0) {
      throw new ProbeError(`ALARM MQTT CONNACK rejected with code ${connack.body[1] ?? 'missing'}`);
    }
    this.pingTimer = setInterval(() => {
      if (this.socket?.writable) this.socket.write(packet(0xc0));
    }, 30_000);
  }

  async subscribe(topic, timeoutMs = 5000) {
    const id = Buffer.from([0, 1]);
    this.socket.write(packet(0x82, Buffer.concat([id, utf8(topic), Buffer.from([0])])));
    const suback = await this.#waitFor(9, timeoutMs);
    if (suback.body.length < 3 || suback.body.at(-1) === 0x80) {
      throw new ProbeError('ALARM MQTT subscription rejected');
    }
  }

  publish(topic, payload) { this.socket.write(publishPacket(topic, payload)); }
  onPublish(handler) { this.handlers.push(handler); }
  onDisconnect(handler) { this.disconnectHandlers.push(handler); }
  close() {
    this.closing = true;
    this.#stopKeepalive();
    this.socket?.end(packet(0xe0));
  }

  #stopKeepalive() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  #waitFor(type, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ProbeError(`ALARM MQTT packet ${type} timeout`)), timeoutMs);
      const listener = packetInfo => {
        if (packetInfo.type === type) { clearTimeout(timer); this._packets.delete(listener); resolve(packetInfo); }
      };
      this._packets ||= new Set(); this._packets.add(listener);
    });
  }

  #consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length > 1) {
      let multiplier = 1, length = 0, index = 1, digit;
      do {
        if (index >= this.buffer.length) return;
        digit = this.buffer[index++]; length += (digit & 127) * multiplier; multiplier *= 128;
      } while (digit & 128);
      if (this.buffer.length < index + length) return;
      const header = this.buffer[0], body = this.buffer.subarray(index, index + length);
      this.buffer = this.buffer.subarray(index + length);
      const info = { type: header >> 4, body };
      for (const listener of this._packets || []) listener(info);
      if (info.type === 3 && body.length >= 2) {
        const topicLength = body.readUInt16BE(0);
        const topic = body.subarray(2, 2 + topicLength).toString('utf8');
        const payload = body.subarray(2 + topicLength);
        for (const handler of this.handlers) handler({ topic, payload });
      }
    }
  }
}
