// Tests the Venise server against the protocol in docs/PROTOCOL.md. Needs Node 22+ (built-in WebSocket).
//   node server/test.js
const assert = require("assert");
const { createServer, LIMITS } = require("./venise-server");

let url;
const open = [];

// A small test client that collects messages and lets a test wait for the next one of a type.
function client() {
  const ws = new WebSocket(url);
  const inbox = [], waiting = [];
  const c = {
    ws, inbox, closed: null,
    send: m => ws.send(typeof m === "string" ? m : JSON.stringify(m)),
    next(type, ms = 2000) {
      const i = inbox.findIndex(m => m.t === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { type, resolve, timer: setTimeout(() => reject(new Error(`no "${type}" within ${ms}ms`)), ms) };
        waiting.push(w);
      });
    },
    async join(name, room = "test") {
      await c.opened;
      c.send({ t: "hello", v: 1, name, room });
      return c.next("welcome");
    },
    closedWith: () => new Promise(r => { if (c.closed) r(c.closed); else ws.addEventListener("close", e => r({ code: e.code, reason: e.reason })); }),
  };
  c.opened = new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    const w = waiting.findIndex(x => x.type === m.t);
    if (w >= 0) { const [x] = waiting.splice(w, 1); clearTimeout(x.timer); x.resolve(m); } else inbox.push(m);
  });
  ws.addEventListener("close", e => { c.closed = { code: e.code, reason: e.reason }; });
  open.push(c);
  return c;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("hello gets a welcome with an id, name, room, peers and state", async () => {
  const a = client();
  const w = await a.join("alice", "r1");
  assert.strictEqual(w.v, 1);
  assert.strictEqual(typeof w.id, "number");
  assert.strictEqual(w.name, "alice");
  assert.strictEqual(w.room, "r1");
  assert.deepStrictEqual(w.peers, []);
  assert.deepStrictEqual(w.state, {});
});

test("others in the room see join and leave", async () => {
  const a = client(), b = client();
  const wa = await a.join("alice", "r2");
  const wb = await b.join("bob", "r2");
  assert.deepStrictEqual(wb.peers, [{ id: wa.id, name: "alice" }]);
  const j = await a.next("join");
  assert.deepStrictEqual([j.id, j.name], [wb.id, "bob"]);
  b.ws.close();
  const l = await a.next("leave");
  assert.deepStrictEqual([l.id, l.name], [wb.id, "bob"]);
});

test("duplicate names get a suffix", async () => {
  const a = client(), b = client();
  await a.join("sam", "r3");
  assert.strictEqual((await b.join("SAM", "r3")).name, "SAM-2");
});

test("msg is broadcast to others but not echoed to the sender", async () => {
  const a = client(), b = client(), c = client();
  const wa = await a.join("a", "r4"); await b.join("b", "r4"); await c.join("c", "r4");
  a.send({ t: "msg", ch: "pos", data: { x: 1, y: [2, 3] } });
  for (const p of [b, c]) {
    const m = await p.next("msg");
    assert.deepStrictEqual(m, { t: "msg", from: wa.id, ch: "pos", data: { x: 1, y: [2, 3] } });
  }
  await assert.rejects(a.next("msg", 200));
});

test("msg with to goes only to that player and is marked private", async () => {
  const a = client(), b = client(), c = client();
  const wa = await a.join("a", "r5"); const wb = await b.join("b", "r5"); await c.join("c", "r5");
  a.send({ t: "msg", ch: "dm", data: "hi", to: wb.id });
  assert.deepStrictEqual(await b.next("msg"), { t: "msg", from: wa.id, ch: "dm", data: "hi", private: true });
  await assert.rejects(c.next("msg", 200));
  a.send({ t: "msg", ch: "dm", data: "hi", to: 999999 });
  assert.strictEqual((await a.next("error")).code, "no_peer");
});

test("rooms are isolated", async () => {
  const a = client(), b = client();
  await a.join("a", "r6a"); await b.join("b", "r6b");
  a.send({ t: "msg", ch: "x", data: 1 });
  await assert.rejects(b.next("msg", 200));
});

test("set updates shared state for everyone, newcomers get it in welcome, null deletes", async () => {
  const a = client(), b = client();
  const wa = await a.join("a", "r7"); await b.join("b", "r7");
  a.send({ t: "set", key: "best", value: 42 });
  assert.deepStrictEqual(await a.next("set"), { t: "set", from: wa.id, key: "best", value: 42 });
  assert.deepStrictEqual(await b.next("set"), { t: "set", from: wa.id, key: "best", value: 42 });
  const c = client();
  assert.deepStrictEqual((await c.join("c", "r7")).state, { best: 42 });
  a.send({ t: "set", key: "best", value: null });
  assert.strictEqual((await c.next("set")).value, null);
  const d = client();
  assert.deepStrictEqual((await d.join("d", "r7")).state, {});
});

test("ping is answered with pong carrying the same n", async () => {
  const a = client();
  await a.join("a", "r8");
  a.send({ t: "ping", n: 123.5 });
  assert.deepStrictEqual(await a.next("pong"), { t: "pong", n: 123.5 });
});

test("anything before hello closes the connection", async () => {
  const a = client();
  await a.opened;
  a.send({ t: "msg", ch: "x", data: 1 });
  assert.strictEqual((await a.next("error")).code, "bad_hello");
  assert.strictEqual((await a.closedWith()).code, 4000);
});

test("wrong protocol version is refused", async () => {
  const a = client();
  await a.opened;
  a.send({ t: "hello", v: 99, name: "x" });
  assert.strictEqual((await a.next("error")).code, "version");
  await a.closedWith();
});

test("bad JSON, unknown types and missing fields are errors but keep the connection", async () => {
  const a = client();
  await a.join("a", "r9");
  a.send("not json");
  assert.strictEqual((await a.next("error")).code, "bad_json");
  a.send({ t: "dance" });
  assert.strictEqual((await a.next("error")).code, "unknown_type");
  a.send({ t: "msg", data: 1 });
  assert.strictEqual((await a.next("error")).code, "bad_field");
  a.send({ t: "ping", n: 1 });
  await a.next("pong");
});

test("messages over the size limit close the connection", async () => {
  const a = client();
  await a.join("a", "r10");
  a.send({ t: "msg", ch: "big", data: "x".repeat(LIMITS.frameBytes + 10) });
  assert.strictEqual((await a.closedWith()).code, 1009);
});

test("rooms have a player limit", async () => {
  for (let i = 0; i < LIMITS.peersPerRoom; i++) await client().join("p" + i, "r11");
  const extra = client();
  await extra.opened;
  extra.send({ t: "hello", v: 1, name: "late", room: "r11" });
  assert.strictEqual((await extra.next("error")).code, "room_full");
});

test("flooding is rate limited", async () => {
  const a = client();
  await a.join("a", "r12");
  for (let i = 0; i < LIMITS.rateBurst + 20; i++) a.send({ t: "ping", n: i });
  assert.strictEqual((await a.next("error")).code, "rate_limit");
});

(async () => {
  const server = createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  url = `ws://127.0.0.1:${server.address().port}`;
  const quiet = console.log; console.log = () => {};
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); process.stdout.write(`ok    ${t.name}\n`); }
    catch (err) { failed++; process.stdout.write(`FAIL  ${t.name}\n      ${err.message}\n`); }
    for (const c of open.splice(0)) c.ws.close();
    await new Promise(r => setTimeout(r, 30));
  }
  console.log = quiet;
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  server.close();
  process.exit(failed ? 1 : 0);
})();
