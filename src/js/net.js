// Client for the Venise Net Protocol v1 (see docs/PROTOCOL.md). app.js exposes it to Lua as `net`.
//
// Incoming events are queued rather than handled straight away, so the game can pull them at a
// safe point in its frame (app.js drains the queue before each _update).
(() => {
  const PROTOCOL_VERSION = 1;
  const PING_EVERY_MS = 5000;

  class VeniseNet {
    constructor() {
      this.ws = null;
      this.events = [];
      this.reset();
    }

    reset() {
      this.status = "closed";   // closed | connecting | open
      this.id = null;
      this.name = null;
      this.room = null;
      this.url = null;
      this.peers = new Map();   // id -> name
      this.state = new Map();   // shared room state, mirrored from the server
      this.ping = null;         // last round trip in ms
      clearInterval(this.pinger);
    }

    connect(url, { name = "player", room = "lobby" } = {}) {
      this.disconnect("reconnecting");
      this.events = [];
      this.status = "connecting";
      let ws;
      try {
        // "192.168.1.5" and "localhost" work too: ws:// and the default port 7777 are filled in.
        const u = new URL(/^wss?:\/\//i.test(url) ? url : "ws://" + url);
        if (!u.port && u.protocol === "ws:") u.port = "7777";
        this.url = url = u.href;
        ws = new WebSocket(url);
      }
      catch (err) { this.status = "closed"; this.push("disconnected", "couldn't connect: " + err.message); return false; }
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, name, room }));
      ws.onmessage = e => { if (this.ws === ws) this.receive(e.data); };
      ws.onclose = e => {
        if (this.ws !== ws) return;
        const was = this.status;
        this.ws = null;
        this.reset();
        this.push("disconnected", e.reason || (was === "open" ? "connection closed" : "couldn't reach " + url));
      };
      return true;
    }

    disconnect(reason = "left") {
      const ws = this.ws;
      if (!ws) return;
      this.ws = null;
      try { ws.close(1000, reason); } catch {}
      this.reset();
    }

    receive(text) {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      switch (m.t) {
        case "welcome":
          this.status = "open";
          this.id = m.id; this.name = m.name; this.room = m.room;
          this.peers = new Map(m.peers.map(p => [p.id, p.name]));
          this.state = new Map(Object.entries(m.state || {}));
          this.sendPing();
          this.pinger = setInterval(() => this.sendPing(), PING_EVERY_MS);
          return this.push("connected", m.id, m.name, m.room);
        case "join":
          this.peers.set(m.id, m.name);
          return this.push("joined", m.id, m.name);
        case "leave":
          this.peers.delete(m.id);
          return this.push("left", m.id, m.name, m.reason);
        case "msg":
          return this.push("message", m.from, m.ch, m.data, !!m.private);
        case "set":
          if (m.value === null) this.state.delete(m.key); else this.state.set(m.key, m.value);
          return this.push("state", m.key, m.value, m.from);
        case "pong":
          if (typeof m.n === "number") this.ping = Math.round(performance.now() - m.n);
          return;
        case "error":
          return this.push("neterror", m.code, m.text);
      }
    }

    push(type, ...args) {
      this.events.push({ type, args });
      if (this.events.length > 1000) this.events.shift(); // a game that never drains can't grow memory forever
    }
    drain() { const e = this.events; this.events = []; return e; }

    send(msg) {
      if (this.status !== "open") return false;
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    sendPing() { this.send({ t: "ping", n: performance.now() }); }

    message(ch, data, to) { return this.send(to == null ? { t: "msg", ch, data } : { t: "msg", ch, data, to }); }
    set(key, value) { return this.send({ t: "set", key, value: value === undefined ? null : value }); }
  }

  window.VeniseNet = VeniseNet;
})();
