#!/usr/bin/env node
// Venise multiplayer server: relays messages between Venise clients that join the same room.
// It speaks the Venise Net Protocol v1 (see docs/PROTOCOL.md) over plain WebSocket.
//
//   node venise-server.js [--port 7777] [--host 0.0.0.0]
//
// No npm packages needed: it only uses Node's built-in modules (Node 18 or newer).
const http = require("http");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");

const PROTOCOL_VERSION = 1;
const LIMITS = {
  frameBytes: 16 * 1024,   // largest message a client may send
  nameLength: 24,
  roomLength: 32,
  channelLength: 32,
  keyLength: 64,
  peersPerRoom: 16,
  stateKeys: 256,
  ratePerSecond: 60,       // steady message rate per client
  rateBurst: 120,          // short bursts allowed on top of that
  helloTimeoutMs: 10000,   // time a client gets to send "hello"
  pingIntervalMs: 15000,
  idleTimeoutMs: 45000,
};

/* ---------------- WebSocket transport (RFC 6455) ---------------- */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP = { cont: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xA };

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | opcode; // FIN + opcode; server frames are never masked
  return Buffer.concat([head, payload]);
}

// Wraps a raw socket and turns incoming bytes into whole messages.
class WsConnection {
  constructor(socket, { onText, onClose }) {
    this.socket = socket;
    this.onText = onText;
    this.onClose = onClose;
    this.buf = Buffer.alloc(0);
    this.fragments = null; // pieces of a fragmented text message
    this.closed = false;
    this.lastSeen = Date.now();
    socket.setNoDelay(true);
    socket.on("data", d => this.receive(d));
    socket.on("close", () => this.finish(1006, "connection lost"));
    socket.on("error", () => this.finish(1006, "connection error"));
  }

  receive(data) {
    this.lastSeen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    while (!this.closed) {
      const frame = this.parseFrame();
      if (!frame) break;
      this.handleFrame(frame);
    }
  }

  parseFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0, opcode = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, offset = 2;
    if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); offset = 4; }
    else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(LIMITS.frameBytes)) { this.close(1009, "message too big"); return null; }
      len = Number(big); offset = 10;
    }
    if (!masked) { this.close(1002, "client frames must be masked"); return null; }
    if (len > LIMITS.frameBytes) { this.close(1009, "message too big"); return null; }
    if (b.length < offset + 4 + len) return null;
    const mask = b.subarray(offset, offset + 4);
    const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + len));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(offset + 4 + len);
    return { fin, opcode, payload };
  }

  handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OP.text:
        if (fin) return this.onText(payload.toString("utf8"));
        this.fragments = [payload];
        return;
      case OP.cont: {
        if (!this.fragments) return this.close(1002, "unexpected continuation frame");
        this.fragments.push(payload);
        const size = this.fragments.reduce((n, p) => n + p.length, 0);
        if (size > LIMITS.frameBytes) return this.close(1009, "message too big");
        if (fin) { const whole = Buffer.concat(this.fragments); this.fragments = null; this.onText(whole.toString("utf8")); }
        return;
      }
      case OP.binary: return this.close(1003, "only text messages are supported");
      case OP.ping: return this.write(OP.pong, payload);
      case OP.pong: return;
      case OP.close: return this.close(1000, "");
      default: return this.close(1002, "unknown opcode");
    }
  }

  write(opcode, payload) {
    if (!this.closed && this.socket.writable) this.socket.write(encodeFrame(opcode, payload));
  }
  sendText(text) { this.write(OP.text, Buffer.from(text, "utf8")); }
  ping() { this.write(OP.ping, Buffer.alloc(0)); }

  close(code, reason) {
    if (this.closed) return;
    const r = Buffer.from(String(reason || "").slice(0, 120), "utf8");
    const body = Buffer.alloc(2 + r.length);
    body.writeUInt16BE(code, 0); r.copy(body, 2);
    this.write(OP.close, body);
    this.socket.end();
    this.finish(code, reason);
  }

  finish(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onClose(code, reason);
  }
}

/* ---------------- rooms and protocol ---------------- */
const rooms = new Map(); // name -> { name, clients: Map<id, Client>, state: Map<key, value> }
let nextId = 1;

const clean = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const isValue = v => v === null || ["string", "number", "boolean", "object"].includes(typeof v);

function getRoom(name) {
  let room = rooms.get(name);
  if (!room) { room = { name, clients: new Map(), state: new Map() }; rooms.set(name, room); }
  return room;
}

function uniqueName(room, wanted) {
  const taken = new Set([...room.clients.values()].map(c => c.name.toLowerCase()));
  let name = wanted, n = 2;
  while (taken.has(name.toLowerCase())) name = `${wanted.slice(0, LIMITS.nameLength - 3)}-${n++}`;
  return name;
}

// Frame logging: off by default. --log-frames [file] turns it on, so you can watch or record the
// whole conversation (Venise's protocol is plain JSON) without a packet sniffer. Only the messages
// this server sends and receives are logged; there is nothing else on the wire to capture.
let frameLog = null;
function configureFrameLog(target) {
  const write = target && target !== "-"
    ? (() => { const s = fs.createWriteStream(target, { flags: "a" }); return line => s.write(line + "\n"); })()
    : line => process.stdout.write(line + "\n");
  frameLog = (dir, client, text) => {
    const who = client.id ? `#${client.id} ${client.name}` : `(${client.address})`;
    write(`${new Date().toISOString()} ${dir === "in" ? "→" : "←"} ${who} ${text}`);
  };
}

function broadcast(room, msg, except) {
  const text = JSON.stringify(msg);
  for (const c of room.clients.values()) if (c !== except) c.deliver(text);
}

class Client {
  constructor(socket, address) {
    this.id = null;
    this.name = null;
    this.room = null;
    this.address = address;
    this.tokens = LIMITS.rateBurst;
    this.lastRefill = Date.now();
    this.ws = new WsConnection(socket, {
      onText: text => this.receive(text),
      onClose: (code, reason) => this.left(reason || "disconnected"),
    });
    this.helloTimer = setTimeout(() => this.fail("bad_hello", "send hello first", true), LIMITS.helloTimeoutMs);
  }

  send(msg) { this.deliver(JSON.stringify(msg)); }
  // Single outgoing choke point, so frame logging sees every server → client frame.
  deliver(text) { if (frameLog) frameLog("out", this, text); this.ws.sendText(text); }

  // Sends an error. Fatal errors also close the connection.
  fail(code, text, fatal) {
    this.send({ t: "error", code, text });
    if (fatal) this.ws.close(4000, code);
  }

  allowed() {
    const now = Date.now();
    this.tokens = Math.min(LIMITS.rateBurst, this.tokens + (now - this.lastRefill) / 1000 * LIMITS.ratePerSecond);
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  receive(text) {
    if (frameLog) frameLog("in", this, text);
    let m;
    try { m = JSON.parse(text); } catch { return this.fail("bad_json", "messages must be JSON objects"); }
    if (!m || typeof m !== "object" || Array.isArray(m) || typeof m.t !== "string") return this.fail("bad_json", "messages must be JSON objects with a \"t\" field");
    if (!this.allowed()) return this.fail("rate_limit", "slow down: too many messages");
    if (!this.room) return m.t === "hello" ? this.hello(m) : this.fail("bad_hello", "send hello first", true);

    switch (m.t) {
      case "msg": return this.relay(m);
      case "set": return this.setState(m);
      case "ping": return this.send({ t: "pong", n: m.n ?? null });
      case "hello": return this.fail("bad_hello", "already joined a room");
      default: return this.fail("unknown_type", `unknown message type "${clean(m.t, 32)}"`);
    }
  }

  hello(m) {
    if (m.v !== PROTOCOL_VERSION) return this.fail("version", `this server speaks protocol version ${PROTOCOL_VERSION}`, true);
    const name = clean(m.name ?? "player", LIMITS.nameLength) || "player";
    const roomName = clean(m.room ?? "lobby", LIMITS.roomLength) || "lobby";
    const room = getRoom(roomName);
    if (room.clients.size >= LIMITS.peersPerRoom) return this.fail("room_full", `room "${roomName}" is full`, true);
    clearTimeout(this.helloTimer);
    this.id = nextId++;
    this.name = uniqueName(room, name);
    this.room = room;
    const peers = [...room.clients.values()].map(c => ({ id: c.id, name: c.name }));
    room.clients.set(this.id, this);
    this.send({ t: "welcome", v: PROTOCOL_VERSION, id: this.id, name: this.name, room: room.name,
                peers, state: Object.fromEntries(room.state) });
    broadcast(room, { t: "join", id: this.id, name: this.name }, this);
    log(`${this.name} (#${this.id}, ${this.address}) joined ${room.name} [${room.clients.size} in room]`);
  }

  relay(m) {
    const ch = typeof m.ch === "string" ? clean(m.ch, LIMITS.channelLength) : "";
    if (!ch) return this.fail("bad_field", "msg needs a \"ch\" channel name");
    if (!isValue(m.data ?? null)) return this.fail("bad_field", "msg data must be JSON");
    const out = { t: "msg", from: this.id, ch, data: m.data ?? null };
    if (m.to === undefined || m.to === null) return broadcast(this.room, out, this);
    const target = this.room.clients.get(m.to);
    if (!target) return this.fail("no_peer", `no player #${m.to} in this room`);
    target.send({ ...out, private: true });
  }

  setState(m) {
    const key = typeof m.key === "string" ? clean(m.key, LIMITS.keyLength) : "";
    if (!key) return this.fail("bad_field", "set needs a \"key\"");
    const value = m.value ?? null;
    if (!isValue(value)) return this.fail("bad_field", "set value must be JSON");
    const state = this.room.state;
    if (value === null) state.delete(key);
    else {
      if (!state.has(key) && state.size >= LIMITS.stateKeys) return this.fail("state_full", `rooms hold at most ${LIMITS.stateKeys} keys`);
      state.set(key, value);
    }
    // Everyone, the sender included, sees sets in the same order the server applied them.
    broadcast(this.room, { t: "set", from: this.id, key, value });
  }

  left(reason) {
    clearTimeout(this.helloTimer);
    clients.delete(this);
    const room = this.room;
    if (!room) return;
    this.room = null;
    room.clients.delete(this.id);
    broadcast(room, { t: "leave", id: this.id, name: this.name, reason });
    log(`${this.name} (#${this.id}) left ${room.name}: ${reason} [${room.clients.size} in room]`);
    if (!room.clients.size) rooms.delete(room.name); // empty rooms and their state go away
  }
}

/* ---------------- HTTP server + upgrade ---------------- */
const clients = new Set();
const log = msg => console.log(new Date().toTimeString().slice(0, 8), msg);

function createServer() {
  const server = http.createServer((req, res) => {
    // A plain GET shows that the server is up and who is connected.
    const summary = { server: "venise", protocol: PROTOCOL_VERSION,
      rooms: [...rooms.values()].map(r => ({ name: r.name, players: [...r.clients.values()].map(c => c.name) })) };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(summary, null, 2) + "\n");
  });

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const upgrade = String(req.headers.upgrade || "").toLowerCase();
    if (upgrade !== "websocket" || !key || req.headers["sec-websocket-version"] !== "13") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                 `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    clients.add(new Client(socket, socket.remoteAddress));
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const c of clients) {
      if (now - c.ws.lastSeen > LIMITS.idleTimeoutMs) c.ws.close(4001, "timed out");
      else c.ws.ping();
    }
  }, LIMITS.pingIntervalMs);
  server.on("close", () => clearInterval(heartbeat));
  return server;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === "IPv4" && !a.internal).map(a => a.address);
}

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
  const port = Number(arg("port", process.env.PORT || 7777));
  const host = arg("host", "0.0.0.0");
  // --log-frames writes every frame in and out; the optional next word is a file (else the console).
  const li = process.argv.indexOf("--log-frames");
  if (li >= 0) {
    const next = process.argv[li + 1];
    configureFrameLog(next && !next.startsWith("--") ? next : null);
  }
  createServer().listen(port, host, () => {
    log(`Venise server (protocol v${PROTOCOL_VERSION}) listening on port ${port}`);
    log(`  this computer:      ws://localhost:${port}`);
    for (const a of lanAddresses()) log(`  your local network: ws://${a}:${port}`);
    if (li >= 0) { const next = process.argv[li + 1]; log(`  logging frames to:  ${next && !next.startsWith("--") ? next : "the console"}`); }
  });
}

module.exports = { createServer, PROTOCOL_VERSION, LIMITS };
