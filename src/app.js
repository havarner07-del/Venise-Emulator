(() => {
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// window.venise comes from preload.js inside the desktop app. The fallback lets src/index.html
// open in a plain browser for quick UI work (no file system access there).
const api = window.venise || {
  listScripts: async () => [],
  readFile: async () => "",
  openFile: async () => null,
  saveFile: async () => null,
  randomImage: async () => ({ folder: "images", image: null }),
  loadGame: async () => null,
  openFolder: async () => {},
  openApp: async () => ({ ok: false, error: "Launching apps needs the desktop app." }),
  launchFiles: [],
  info: async () => ({
    window: { title: document.title, width: innerWidth, height: innerHeight, x: screenX, y: screenY, maximized: false },
    server: { port: Number(location.port) || null, url: location.origin, pid: null, mode: "browser" },
    runtime: { neutralino: null, client: null, os: navigator.platform, arch: null, appId: null, appVersion: null, memoryTotalMB: null, memoryFreeMB: null },
    paths: { app: null, data: null },
  }),
  win: { min() {}, max() {}, close() {}, onState() {}, layout: async () => {} },
};
const appStarted = performance.now();
const baseName = p => p.split(/[\\/]/).pop();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- built-in content ---------------- */
const DEMO_GAME = `-- Coin Run: Venise's built-in demo game.
-- Drop your own game in the game folder as main.lua to run that instead.

player = { x = 60, y = 104, speed = 1.5, color = 12 }
coins = {}
score = 0
t = 0

function spawn_coin()
  table.insert(coins, { x = math.random(4, 123), y = -4, vy = 0.6 + math.random() * 0.8 })
end

function _init()
  print("Coin Run loaded")
end

function _update()
  t = t + 1
  if btn(0) then player.x = player.x - player.speed end
  if btn(1) then player.x = player.x + player.speed end
  player.x = math.max(0, math.min(120, player.x))
  if t % 20 == 0 then spawn_coin() end

  for i = #coins, 1, -1 do
    local c = coins[i]
    c.y = c.y + c.vy
    if math.abs(c.x - (player.x + 4)) < 6 and math.abs(c.y - (player.y + 4)) < 6 then
      score = score + 1
      table.remove(coins, i)
    elseif c.y > 132 then
      table.remove(coins, i)
    end
  end
end

function _draw()
  cls(1)
  rectfill(0, 112, 127, 127, 3)
  for _, c in ipairs(coins) do circfill(c.x, c.y, 2, 10) end
  rectfill(player.x, player.y, player.x + 7, player.y + 7, player.color)
  text("SCORE " .. score, 3, 3, 7)
end
`;

const EXAMPLES = [
  { name: "SpeedBoost.lua", code:
`-- Makes the player 3x faster
player.speed = 4.5
print("speed is now", player.speed)` },
  { name: "AddScore.lua", code:
`score = score + 100
print("score:", score)` },
  { name: "Rainbow.lua", code:
`-- Wraps the game's _draw so the player changes color every few frames
local base_draw = _draw
function _draw()
  player.color = (t // 4) % 16
  base_draw()
end
print("rainbow on")` },
  { name: "CoinMagnet.lua", code:
`-- Pulls every coin toward the player
local base_update = _update
function _update()
  base_update()
  for _, c in ipairs(coins) do
    c.x = c.x + (player.x + 4 - c.x) * 0.06
  end
end
print("coin magnet on")` },
  { name: "DebugOverlay.lua", code:
`local base_draw = _draw
function _draw()
  base_draw()
  rect(0, 0, 127, 127, 8)
  text("coins " .. #coins, 3, 11, 6)
  text(string.format("x %.1f", player.x), 3, 19, 6)
end` },
  { name: "WindowInfo.lua", code:
`-- Prints details about the Venise window and runtime
local w = getwindowinfo()
print("window", w.title, string.format("%sx%s at %s,%s", w.width, w.height, w.x, w.y))
print("server", w.url, "port", w.port, "pid", w.pid)

local r = getruntimeinfo()
print("runtime", r.lua, "on", r.os, r.arch)
print("neutralino", r.neutralino, "fps", r.fps, "uptime", r.uptime)
return w.port` },
  { name: "Inspect.lua", code:
`-- Lists every value in the player table
for k, v in pairs(player) do
  print(k, v)
end
return #coins, score` },
];

/* ---------------- output ---------------- */
const logEl = $("#log");
function log(kind, msg) {
  const row = document.createElement("div");
  row.className = "line " + kind;
  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = new Date().toTimeString().slice(0, 8);
  const m = document.createElement("span");
  m.className = "msg";
  m.textContent = msg;
  row.append(ts, m);
  logEl.append(row);
  while (logEl.childElementCount > 500) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
$("#clearOut").onclick = () => { logEl.textContent = ""; };
$("#copyOut").onclick = async () => {
  const text = [...logEl.children].map(r => r.textContent.slice(0, 8) + "  " + r.textContent.slice(8)).join("\n");
  try { await navigator.clipboard.writeText(text); log("sys", "Output copied."); } catch { log("warn", "Couldn't copy the output."); }
};
$("#toggleOut").onclick = () => $("#output").classList.toggle("collapsed");

/* ---------------- tabs ---------------- */
const ed = $("#ed"), hl = $("#hl"), gutter = $("#gutter"), curline = $("#curline"), tabsEl = $("#tabs");
let tabs = store.get("venise.tabs", null);
if (!Array.isArray(tabs) || !tabs.length) tabs = [{ id: "t1", name: "Script.lua", code: "", saved: "", path: null }];
let active = store.get("venise.active", tabs[0].id);
if (!tabs.some(t => t.id === active)) active = tabs[0].id;
const cur = () => tabs.find(t => t.id === active);
const persist = () => { store.set("venise.tabs", tabs); store.set("venise.active", active); };

function renderTabs() {
  tabsEl.textContent = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === active ? " active" : "") + (t.code !== t.saved && t.path ? " dirty" : "");
    el.tabIndex = 0;
    el.title = t.path || t.name;
    const dot = document.createElement("span"); dot.className = "dot";
    const name = document.createElement("span"); name.textContent = t.name;
    const x = document.createElement("button");
    x.className = "x"; x.setAttribute("aria-label", "Close " + t.name);
    x.innerHTML = '<svg><use href="#i-x"/></svg>';
    x.onclick = e => { e.stopPropagation(); closeTab(t.id); };
    el.append(dot, name, x);
    el.onclick = () => select(t.id);
    el.onkeydown = e => { if (e.key === "Enter") select(t.id); };
    tabsEl.append(el);
  }
  const add = document.createElement("button");
  add.className = "tab-add"; add.textContent = "+"; add.title = "New script";
  add.onclick = () => openTab({ name: "Script.lua", code: "" });
  tabsEl.append(add);
}
function select(id) {
  active = id;
  ed.value = cur().code;
  ed.scrollTop = 0; ed.scrollLeft = 0;
  renderTabs(); refreshEditor(); markSidebar(); persist();
  $("#fileName").textContent = cur().name;
  scheduleCheck(0);
}
function openTab({ name, code, path = null }) {
  const existing = path && tabs.find(t => t.path === path);
  if (existing) return select(existing.id);
  let n = name, i = 2;
  while (tabs.some(t => t.name === n)) n = name.replace(/(\.\w+)?$/, ` (${i++})$1`);
  const t = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: n, code, saved: code, path };
  tabs.push(t);
  select(t.id);
}
function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  tabs.splice(i, 1);
  if (!tabs.length) tabs.push({ id: "t" + Date.now().toString(36), name: "Script.lua", code: "", saved: "", path: null });
  if (active === id || !tabs.some(t => t.id === active)) select(tabs[Math.max(0, i - 1)].id);
  else { renderTabs(); persist(); }
}

/* ---------------- editor ---------------- */
const KW = new Set("and break do else elseif end for function goto if in local not or repeat return then until while".split(" "));
const CONST = new Set(["true", "false", "nil"]);
const BUILTIN = new Set("print pairs ipairs type tostring tonumber select next error assert pcall xpcall require setmetatable getmetatable rawget rawset math string table os coroutine utf8 cls pset line rect rectfill circfill text btn time rnd getwindowinfo getruntimeinfo self".split(" "));
const TOKEN = /--\[(=*)\[[\s\S]*?(?:\]\1\]|$)|--[^\n]*|\[(=*)\[[\s\S]*?(?:\]\2\]|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\b0[xX][\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_]\w*/g;
const CALL = /\s*[({"']/y;
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function highlight(src) {
  let out = "", last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const t = m[0];
    let cls = null;
    if (t.startsWith("--")) cls = "c";
    else if (t[0] === '"' || t[0] === "'" || t[0] === "[") cls = "s";
    else if (/^\d/.test(t)) cls = "n";
    else if (CONST.has(t)) cls = "n";
    else if (KW.has(t)) cls = "k";
    else {
      CALL.lastIndex = TOKEN.lastIndex;
      if (CALL.test(src)) cls = "f";
      else if (BUILTIN.has(t)) cls = "b";
    }
    out += esc(src.slice(last, m.index)) + (cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t));
    last = TOKEN.lastIndex;
  }
  return out + esc(src.slice(last)) + "\n";
}

let badLine = 0;
function refreshEditor() {
  hl.innerHTML = highlight(ed.value);
  syncScroll();
  updateCursor();
}
function updateGutter(lineNo) {
  const n = ed.value.split("\n").length;
  let html = "";
  for (let i = 1; i <= n; i++) {
    const cls = i === badLine ? "bad" : i === lineNo ? "cur" : "";
    html += (cls ? `<span class="${cls}">${i}</span>` : i) + "\n";
  }
  gutter.innerHTML = html;
  gutter.scrollTop = ed.scrollTop;
}
function syncScroll() {
  hl.scrollTop = ed.scrollTop;
  hl.scrollLeft = ed.scrollLeft;
  gutter.scrollTop = ed.scrollTop;
  positionCurline();
}
let cursorLine = 1;
function updateCursor() {
  const before = ed.value.slice(0, ed.selectionStart).split("\n");
  cursorLine = before.length;
  $("#cursor").textContent = `Ln ${cursorLine}, Col ${before[before.length - 1].length + 1}`;
  updateGutter(cursorLine);
  positionCurline();
}
function positionCurline() {
  curline.style.top = (10 + (cursorLine - 1) * 21 - ed.scrollTop) + "px";
}

ed.addEventListener("input", () => {
  const t = cur();
  t.code = ed.value;
  refreshEditor(); persist(); scheduleCheck(350);
  const tab = tabsEl.querySelector(".tab.active");
  if (tab) tab.classList.toggle("dirty", !!t.path && t.code !== t.saved);
});
ed.addEventListener("scroll", syncScroll);
ed.addEventListener("keyup", updateCursor);
ed.addEventListener("click", updateCursor);
ed.addEventListener("select", updateCursor);
ed.addEventListener("keydown", e => {
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    ed.setRangeText("  ", ed.selectionStart, ed.selectionEnd, "end");
    ed.dispatchEvent(new Event("input"));
  } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
    // keep the current line's indentation
    const lineStart = ed.value.lastIndexOf("\n", ed.selectionStart - 1) + 1;
    const indent = ed.value.slice(lineStart).match(/^[ \t]*/)[0];
    e.preventDefault();
    ed.setRangeText("\n" + indent, ed.selectionStart, ed.selectionEnd, "end");
    ed.dispatchEvent(new Event("input"));
  }
});

/* ---------------- sidebar ---------------- */
const searchEl = $("#search");
let folderScripts = [];
function makeItem(name, icon, cls, onClick) {
  const b = document.createElement("button");
  b.className = "item " + cls;
  b.dataset.name = name;
  b.innerHTML = `<svg><use href="#${icon}"/></svg><span></span>`;
  b.querySelector("span").textContent = name;
  b.onclick = onClick;
  return b;
}
function renderSidebar() {
  const q = searchEl.value.trim().toLowerCase();
  const match = n => !q || n.toLowerCase().includes(q);
  const folder = $("#folderList"), examples = $("#exampleList");
  folder.textContent = ""; examples.textContent = "";
  const shown = folderScripts.filter(s => match(s.name));
  for (const s of shown) {
    folder.append(makeItem(s.name, "i-file", "file", async () => {
      await openPath(s.path);
    }));
  }
  if (!shown.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = q ? "No matches." : "No scripts yet. Save one or drop .lua files into the scripts folder.";
    folder.append(note);
  }
  for (const ex of EXAMPLES.filter(e => match(e.name))) {
    examples.append(makeItem(ex.name, "i-spark", "example", () => {
      const open = tabs.find(t => t.name === ex.name && !t.path);
      open ? select(open.id) : openTab({ name: ex.name, code: ex.code });
    }));
  }
  markSidebar();
}
function markSidebar() {
  document.querySelectorAll(".item").forEach(i => i.classList.toggle("active", i.dataset.name === cur().name));
}
async function refreshScripts(announce) {
  folderScripts = await api.listScripts();
  renderSidebar();
  if (announce) log("sys", `Scripts folder: ${folderScripts.length} script${folderScripts.length === 1 ? "" : "s"}.`);
}
searchEl.addEventListener("input", renderSidebar);
$("#refreshBtn").onclick = () => refreshScripts(true);
$("#folderBtn").onclick = () => api.openFolder("scripts");

/* ---------------- file buttons ---------------- */
$("#clearBtn").onclick = () => { ed.value = ""; ed.dispatchEvent(new Event("input")); ed.focus(); };
$("#openBtn").onclick = async () => {
  const f = await api.openFile();
  if (f) { openTab(f); addRecent(f.path); log("sys", `Opened ${f.name}`); }
};
async function saveCurrent(saveAs) {
  const t = cur();
  const r = await api.saveFile({ path: t.path, name: t.name, code: t.code, saveAs });
  if (!r) { if (!window.venise) log("warn", "Saving needs the desktop app."); return; }
  t.path = r.path; t.name = r.name; t.saved = t.code;
  addRecent(r.path);
  renderTabs(); persist();
  $("#fileName").textContent = t.name;
  log("ok", `Saved ${r.path}`);
  refreshScripts(false);
}
$("#saveBtn").onclick = () => saveCurrent(false);

/* ---------------- Lua VM ---------------- */
const F = window.fengari;
const lua = F && F.lua, lauxlib = F && F.lauxlib, lualib = F && F.lualib;
const S = s => F.to_luastring(s);
const PAL = ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
             "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"];
const cv = $("#screen"), g = cv.getContext("2d");
const pressed = [false, false, false, false, false, false];
let L = null, running = false, raf = 0, deadline = 0, startTime = 0, gameName = null, currentFps = 0;

const col = c => PAL[((Math.floor(c) % 16) + 16) % 16];
const num = (L, i, d) => lua.lua_isnoneornil(L, i) ? d : lauxlib.luaL_checknumber(L, i);
function jsString(L, i) { lauxlib.luaL_tolstring(L, i); const s = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return s; }
function popError(L) { const m = jsString(L, -1); lua.lua_pop(L, 1); return m; }

function registerApi(L) {
  const reg = (name, fn) => { lua.lua_pushjsfunction(L, fn); lua.lua_setglobal(L, S(name)); };
  reg("print", L => {
    const n = lua.lua_gettop(L), parts = [];
    for (let i = 1; i <= n; i++) parts.push(jsString(L, i));
    log("out", parts.join("\t"));
    return 0;
  });
  reg("cls", L => { g.fillStyle = col(num(L, 1, 0)); g.fillRect(0, 0, 128, 128); return 0; });
  reg("pset", L => { g.fillStyle = col(num(L, 3, 7)); g.fillRect(Math.floor(num(L, 1, 0)), Math.floor(num(L, 2, 0)), 1, 1); return 0; });
  reg("rectfill", L => {
    const x0 = Math.floor(num(L, 1, 0)), y0 = Math.floor(num(L, 2, 0)), x1 = Math.floor(num(L, 3, 0)), y1 = Math.floor(num(L, 4, 0));
    g.fillStyle = col(num(L, 5, 7));
    g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1);
    return 0;
  });
  reg("rect", L => {
    const x0 = Math.floor(Math.min(num(L, 1, 0), num(L, 3, 0))), x1 = Math.floor(Math.max(num(L, 1, 0), num(L, 3, 0)));
    const y0 = Math.floor(Math.min(num(L, 2, 0), num(L, 4, 0))), y1 = Math.floor(Math.max(num(L, 2, 0), num(L, 4, 0)));
    g.fillStyle = col(num(L, 5, 7));
    g.fillRect(x0, y0, x1 - x0 + 1, 1); g.fillRect(x0, y1, x1 - x0 + 1, 1);
    g.fillRect(x0, y0, 1, y1 - y0 + 1); g.fillRect(x1, y0, 1, y1 - y0 + 1);
    return 0;
  });
  reg("circfill", L => {
    const x = Math.floor(num(L, 1, 0)), y = Math.floor(num(L, 2, 0)), r = Math.floor(num(L, 3, 4));
    g.fillStyle = col(num(L, 4, 7));
    for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(x - w, y + dy, 2 * w + 1, 1); }
    return 0;
  });
  reg("line", L => {
    let x0 = Math.floor(num(L, 1, 0)), y0 = Math.floor(num(L, 2, 0));
    const x1 = Math.floor(num(L, 3, 0)), y1 = Math.floor(num(L, 4, 0));
    g.fillStyle = col(num(L, 5, 7));
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 512; n++) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return 0;
  });
  reg("text", L => {
    g.fillStyle = col(num(L, 4, 7));
    g.font = "7px Consolas, monospace"; g.textBaseline = "top";
    g.fillText(jsString(L, 1), Math.floor(num(L, 2, 0)), Math.floor(num(L, 3, 0)));
    return 0;
  });
  reg("btn", L => { lua.lua_pushboolean(L, !!pressed[Math.floor(num(L, 1, 0))]); return 1; });
  reg("time", L => { lua.lua_pushnumber(L, (performance.now() - startTime) / 1000); return 1; });
  reg("rnd", L => { lua.lua_pushnumber(L, Math.random() * num(L, 1, 1)); return 1; });
  reg("getwindowinfo", L => { pushValue(L, luaWindowInfo()); return 1; });
  reg("getruntimeinfo", L => { pushValue(L, luaRuntimeInfo()); return 1; });
}

// Pushes a JS value onto the Lua stack; objects become tables, null becomes nil.
function pushValue(L, v) {
  if (v === null || v === undefined) lua.lua_pushnil(L);
  else if (typeof v === "boolean") lua.lua_pushboolean(L, v);
  else if (typeof v === "number") Number.isInteger(v) ? lua.lua_pushinteger(L, v) : lua.lua_pushnumber(L, v);
  else if (typeof v === "object") {
    lua.lua_createtable(L, 0, Object.keys(v).length);
    for (const [k, val] of Object.entries(v)) {
      if (val === null || val === undefined) continue;
      pushValue(L, val);
      lua.lua_setfield(L, -2, S(k));
    }
  } else lua.lua_pushstring(L, S(String(v)));
}

function runChunk(code, name, limitMs) {
  const top = lua.lua_gettop(L), buf = S(code);
  if (lauxlib.luaL_loadbuffer(L, buf, buf.length, S("=" + name)) !== lua.LUA_OK) return { ok: false, msg: popError(L) };
  deadline = performance.now() + limitMs;
  if (lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0) !== lua.LUA_OK) return { ok: false, msg: popError(L) };
  const out = [];
  for (let i = top + 1; i <= lua.lua_gettop(L); i++) out.push(jsString(L, i));
  lua.lua_settop(L, top);
  return { ok: true, results: out };
}
function callGlobal(name, limitMs) {
  if (lua.lua_getglobal(L, S(name)) !== lua.LUA_TFUNCTION) { lua.lua_pop(L, 1); return { ok: true }; }
  deadline = performance.now() + limitMs;
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) return { ok: false, msg: popError(L) };
  return { ok: true };
}

/* ---------------- compile / live error checking ---------------- */
let checker = null, checkTimer = 0;
function syntaxError(code, name) {
  if (!F) return null;
  if (!checker) checker = lauxlib.luaL_newstate();
  const buf = S(code);
  const st = lauxlib.luaL_loadbuffer(checker, buf, buf.length, S("=" + name));
  const msg = st === lua.LUA_OK ? null : lua.lua_tojsstring(checker, -1);
  lua.lua_settop(checker, 0);
  return msg;
}
function lineOf(msg) { const m = /:(\d+):/.exec(msg || ""); return m ? +m[1] : 0; }
function scheduleCheck(delay) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    const err = syntaxError(cur().code, cur().name);
    badLine = lineOf(err);
    const p = $("#problems");
    p.textContent = err ? "1 problem: " + err.replace(/^[^:]*:\d+:\s*/, "line " + badLine + ": ") : "No problems";
    p.classList.toggle("bad", !!err);
    p.title = err || "";
    updateGutter(cursorLine);
  }, delay);
}
$("#compileBtn").onclick = () => {
  const t = cur();
  if (!F) { log("err", "The Lua runtime (src/vendor/fengari-web.js) is missing. Reinstall Venise."); return; }
  const err = syntaxError(t.code, t.name);
  if (err) { log("err", "Compile failed: " + err); scheduleCheck(0); return; }
  const lines = t.code.split("\n").length;
  log("ok", `Compiled ${t.name}: no errors (${lines} line${lines === 1 ? "" : "s"}).`);
  scheduleCheck(0);
};

/* ---------------- inject / detach ---------------- */
const injectBtn = $("#injectBtn");
function setInjected(on, label) {
  injectBtn.classList.toggle("on", on);
  injectBtn.querySelector("span").textContent = on ? "Detach" : "Inject";
  $("#game").hidden = !on && !label;
  const rt = $("#runtime");
  rt.textContent = on ? `Lua 5.3 · Injected into ${label}` : "Lua 5.3 · Emulator runtime";
  rt.classList.toggle("on", on);
}
function stop() { running = false; cancelAnimationFrame(raf); }
async function inject() {
  if (!F) { log("err", "The Lua runtime (src/vendor/fengari-web.js) is missing. Reinstall Venise."); return; }
  stop();
  const custom = await api.loadGame();
  const game = custom || { name: "Coin Run", code: DEMO_GAME };
  gameName = game.name;
  L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  registerApi(L);
  lua.lua_sethook(L, L => {
    if (performance.now() > deadline) lauxlib.luaL_error(L, S("stopped: the script ran too long (infinite loop?)"));
  }, lua.LUA_MASKCOUNT, 5000);
  startTime = performance.now();
  $("#gameName").textContent = game.name;
  $("#game").hidden = false;
  const r = runChunk(game.code, game.name, 500);
  if (!r.ok) return crash("loading " + game.name, r.msg);
  const i = callGlobal("_init", 500);
  if (!i.ok) return crash("_init", i.msg);
  running = true;
  setInjected(true, game.name);
  log("ok", `Injected into ${game.name}. Execute now runs inside the game.`);
  last = performance.now(); acc = 0; fpsT = last; draws = 0;
  raf = requestAnimationFrame(frame);
  cv.focus({ preventScroll: true });
}
function detach() {
  stop(); L = null;
  setInjected(false);
  log("sys", "Detached. The game VM was closed.");
}
function crash(where, msg) {
  stop(); L = null;
  setInjected(false, "crashed");
  g.fillStyle = PAL[1]; g.fillRect(0, 0, 128, 128);
  g.fillStyle = PAL[8]; g.font = "8px Consolas, monospace"; g.textAlign = "center"; g.textBaseline = "top";
  g.fillText("CRASHED", 64, 56); g.textAlign = "left";
  log("err", msg);
  log("sys", `The game stopped in ${where}. Fix the error, then press Inject again.`);
}
injectBtn.onclick = () => (running ? detach() : inject());

/* ---------------- execute ---------------- */
function execute() {
  const t = cur();
  if (!t.code.trim()) { log("warn", "The script is empty."); return; }
  if (!running) { log("warn", "Not injected. Press Inject first to start the game, then Execute."); return; }
  const r = runChunk(t.code, t.name, 250);
  if (!r.ok) { log("err", r.msg); return; }
  log("sys", `Executed ${t.name}`);
  if (r.results.length) log("ret", "→ " + r.results.join(", "));
}
$("#execBtn").onclick = execute;

/* ---------------- game loop ---------------- */
const STEP = 1000 / 30;
let last = 0, acc = 0, draws = 0, fpsT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  acc += Math.min(now - last, 250); last = now;
  while (acc >= STEP) {
    acc -= STEP;
    const u = callGlobal("_update", 120);
    if (!u.ok) return crash("_update", u.msg);
  }
  const d = callGlobal("_draw", 120);
  if (!d.ok) return crash("_draw", d.msg);
  draws++;
  if (now - fpsT >= 1000) { currentFps = Math.round(draws * 1000 / (now - fpsT)); $("#fps").textContent = currentFps + " fps"; draws = 0; fpsT = now; }
  $("#clock").textContent = ((now - startTime) / 1000).toFixed(1) + "s";
}

/* ---------------- input ---------------- */
const KEYS = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3, z: 4, c: 4, x: 5, v: 5 };
const typing = () => /^(TEXTAREA|INPUT)$/.test(document.activeElement && document.activeElement.tagName);
addEventListener("keydown", e => {
  if (view !== "ide") return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "Enter") { e.preventDefault(); execute(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveCurrent(e.shiftKey); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); $("#openBtn").click(); return; }
  if (e.key === "F1") { e.preventDefault(); openInfo(); return; }
  if (e.key === "Escape" && !$("#infoModal").hidden) { closeInfo(); return; }
  if (e.key === "Escape" && !$("#modal").hidden) { closeModal(); return; }
  if (typing() || mod) return;
  const b = KEYS[e.key];
  if (b === undefined) return;
  pressed[b] = true;
  if (e.key.startsWith("Arrow")) e.preventDefault();
});
addEventListener("keyup", e => { const b = KEYS[e.key]; if (b !== undefined) pressed[b] = false; });
addEventListener("blur", () => pressed.fill(false));
document.querySelectorAll(".pad button").forEach(b => {
  const i = +b.dataset.b;
  b.addEventListener("pointerdown", e => { pressed[i] = true; b.setPointerCapture(e.pointerId); });
  const up = () => { pressed[i] = false; };
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
});

/* ---------------- press me: random image ---------------- */
const modal = $("#modal"), modalBody = $("#modalBody");
let lastImage = null;
async function showRandomImage() {
  const r = await api.randomImage();
  modal.hidden = false;
  modalBody.textContent = "";
  if (!r.image) {
    $("#modalTitle").textContent = "No images yet";
    const p = document.createElement("p");
    p.innerHTML = "Put some .png, .jpg, .gif or .webp files in the images folder,<br>then press the button again.<br><code></code>";
    p.querySelector("code").textContent = r.folder;
    modalBody.append(p);
    $("#againBtn").hidden = true;
    return;
  }
  // avoid showing the same picture twice in a row when there's a choice
  if (r.count > 1 && r.image.name === lastImage) return showRandomImage();
  lastImage = r.image.name;
  $("#modalTitle").textContent = r.image.name;
  const img = document.createElement("img");
  img.src = r.image.url;
  img.alt = r.image.name;
  modalBody.append(img);
  $("#againBtn").hidden = r.count < 2;
}
function closeModal() { modal.hidden = true; }
$("#pressMe").onclick = showRandomImage;
$("#againBtn").onclick = showRandomImage;
$("#modalClose").onclick = closeModal;
$("#imgFolderBtn").onclick = () => api.openFolder("images");
modal.addEventListener("mousedown", e => { if (e.target === modal) closeModal(); });

/* ---------------- window + theme ---------------- */
document.querySelectorAll("[data-win]").forEach(b => {
  b.onclick = () => api.win[b.dataset.win]();
});
api.win.onState(max => {
  document.querySelectorAll('[data-win="max"] use').forEach(u => u.setAttribute("href", max ? "#i-restore" : "#i-max"));
});

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("#themeBtn use").setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
  store.set("venise.theme", t);
}
$("#themeBtn").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

/* ---------------- runtime info ---------------- */
// Refreshed every second so Lua can read it synchronously through getwindowinfo() / getruntimeinfo().
let nativeInfo = { window: {}, server: {}, runtime: {}, paths: {} };
async function refreshInfo() {
  try { nativeInfo = await api.info(); } catch {}
  if (!$("#infoModal").hidden) renderInfo();
}
setInterval(refreshInfo, 1000);

const uptime = () => Math.round((performance.now() - appStarted) / 100) / 10;
function luaWindowInfo() {
  const w = nativeInfo.window, sv = nativeInfo.server;
  return { title: w.title, width: w.width, height: w.height, x: w.x, y: w.y, maximized: w.maximized,
           port: sv.port, url: sv.url, pid: sv.pid, mode: sv.mode };
}
function luaRuntimeInfo() {
  const r = nativeInfo.runtime;
  return {
    lua: F ? lua.LUA_RELEASE : null, engine: F ? F.FENGARI_RELEASE : null,
    neutralino: r.neutralino, client: r.client, os: r.os, arch: r.arch,
    app_id: r.appId, app_version: r.appVersion, memory_total_mb: r.memoryTotalMB, memory_free_mb: r.memoryFreeMB,
    injected: running, game: running ? gameName : null, fps: running ? currentFps : 0, uptime: uptime(),
    data_path: nativeInfo.paths.data,
  };
}

const show = v => (v === null || v === undefined || v === "" ? "—" : String(v));
function infoSections() {
  const w = nativeInfo.window, sv = nativeInfo.server, r = nativeInfo.runtime, p = nativeInfo.paths;
  return [
    ["Window", [
      ["Title", w.title],
      ["Size", w.width ? `${w.width} × ${w.height}` : null],
      ["Position", w.x !== null && w.x !== undefined ? `${w.x}, ${w.y}` : null],
      ["Maximized", w.maximized ? "Yes" : "No"],
    ]],
    ["Server", [
      ["Port", sv.port],
      ["URL", sv.url],
      ["Process ID", sv.pid],
      ["Mode", sv.mode],
    ]],
    ["Runtime", [
      ["Neutralino", r.neutralino],
      ["Client library", r.client],
      ["Operating system", r.os],
      ["Architecture", r.arch],
      ["App version", r.appVersion],
      ["Memory", r.memoryTotalMB ? `${r.memoryFreeMB.toLocaleString()} MB free of ${r.memoryTotalMB.toLocaleString()} MB` : null],
    ]],
    ["Lua", [
      ["Version", F ? `${lua.LUA_RELEASE} (${F.FENGARI_RELEASE})` : "Not loaded"],
      ["Injected", running ? `Yes, into ${gameName}` : "No", running],
      ["Frame rate", running ? `${currentFps} fps` : null],
      ["Uptime", `${uptime().toFixed(1)} s`],
    ]],
    ["Folders", [
      ["App", p.app],
      ["Data", p.data],
    ]],
  ];
}
function renderInfo() {
  const body = $("#infoBody");
  const keepScroll = body.scrollTop;
  body.textContent = "";
  for (const [title, rows] of infoSections()) {
    const h = document.createElement("div");
    h.className = "info-section"; h.textContent = title;
    const dl = document.createElement("dl");
    dl.className = "info-grid";
    for (const [label, value, good] of rows) {
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = show(value);
      if (good) dd.className = "good";
      dl.append(dt, dd);
    }
    body.append(h, dl);
  }
  body.scrollTop = keepScroll;
}
async function openInfo() {
  $("#infoModal").hidden = false;
  renderInfo();
  await refreshInfo();
}
function closeInfo() { $("#infoModal").hidden = true; }
$("#infoBtn").onclick = openInfo;
$("#runtime").onclick = openInfo;
$("#infoClose").onclick = closeInfo;
$("#infoModal").addEventListener("mousedown", e => { if (e.target.id === "infoModal") closeInfo(); });
$("#infoCopy").onclick = async () => {
  const text = infoSections().map(([title, rows]) =>
    title + "\n" + rows.map(([label, value]) => `  ${label}: ${show(value)}`).join("\n")).join("\n\n");
  const label = $("#infoCopy").lastChild;
  try { await navigator.clipboard.writeText(text); label.textContent = "Copied"; }
  catch { label.textContent = "Couldn't copy"; }
  setTimeout(() => { label.textContent = "Copy info"; }, 1500);
};

/* ---------------- recent files ---------------- */
let recent = store.get("venise.recent", []);
if (!Array.isArray(recent)) recent = [];
function addRecent(path) {
  if (!path) return;
  recent = [{ path, time: Date.now() }, ...recent.filter(r => r.path !== path)].slice(0, 25);
  store.set("venise.recent", recent);
}
function removeRecent(path) {
  recent = recent.filter(r => r.path !== path);
  store.set("venise.recent", recent);
}
async function openPath(path) {
  try {
    openTab({ name: baseName(path), code: await api.readFile(path), path });
    addRecent(path);
    return true;
  } catch (err) {
    log("err", `Couldn't open ${path}: ${(err && err.message) || err}`);
    removeRecent(path);
    return false;
  }
}
function formatWhen(time) {
  const d = new Date(time), today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const clock = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? clock : d.toLocaleDateString() + " " + clock;
}
function renderRecent() {
  const q = $("#recentSearch").value.trim().toLowerCase();
  const list = $("#recentList");
  list.textContent = "";
  const items = recent.filter(r => !q || r.path.toLowerCase().includes(q));
  if (!items.length) {
    const p = document.createElement("div");
    p.className = "recent-empty";
    p.textContent = q ? "No recent files match that search." : "Scripts you open or save show up here, so you can jump back into them.";
    list.append(p);
    return;
  }
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const groupOf = t => t >= midnight.getTime() ? "Today" : t >= midnight.getTime() - 6 * 864e5 ? "This week" : "Older";
  let group = null;
  for (const r of items) {
    const g = groupOf(r.time);
    if (g !== group) {
      group = g;
      const h = document.createElement("div");
      h.className = "recent-group"; h.textContent = g;
      list.append(h);
    }
    const b = document.createElement("button");
    b.className = "recent-item";
    b.title = r.path;
    b.innerHTML = '<svg><use href="#i-lua"/></svg><span><b></b><span class="path"></span></span><time></time>';
    b.querySelector("b").textContent = baseName(r.path);
    b.querySelector(".path").textContent = r.path.slice(0, r.path.length - baseName(r.path).length).replace(/[\\/]$/, "");
    b.querySelector("time").textContent = formatWhen(r.time);
    b.onclick = async () => {
      if (await openPath(r.path)) return showView("ide");
      const note = $("#startNote");
      note.textContent = `Couldn't open ${baseName(r.path)}. It may have been moved or deleted, so it was removed from the list.`;
      note.hidden = false;
      renderRecent();
    };
    list.append(b);
  }
}
$("#recentSearch").addEventListener("input", renderRecent);

/* ---------------- views: splash, start window, editor ---------------- */
const views = { splash: $("#splash"), start: $("#start"), ide: $("#ide") };
let view = "splash";
async function showView(name) {
  if (name === view) return;
  try { await api.win.layout(name); } catch {}
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  view = name;
  if (name === "start") { $("#startNote").hidden = true; renderRecent(); }
  if (name === "ide") refreshEditor();
}

$("#actOpen").onclick = async () => {
  const f = await api.openFile();
  if (!f) return;
  openTab(f); addRecent(f.path);
  showView("ide");
};
$("#actNew").onclick = async () => {
  openTab({ name: "Script.lua", code: "" });
  await showView("ide");
  ed.focus();
};
$("#actInject").onclick = async () => {
  await showView("ide");
  if (!running) inject();
};
$("#actData").onclick = () => api.openFolder("data");
$("#actRoblox").onclick = async () => {
  // "roblox-player:" is Roblox's own launch protocol — the same one the Play button on roblox.com uses.
  const r = await api.openApp({ uri: "roblox-player:1+launchmode:app" });
  await showView("ide");
  if (r.ok) log("ok", "Asked Windows to open Roblox. If nothing happens, install Roblox from roblox.com first.");
  else log("err", "Couldn't launch Roblox: " + r.error);
};
$("#actContinue").onclick = () => showView("ide");
$("#homeBtn").onclick = () => showView("start");

/* ---------------- boot ---------------- */
applyTheme(store.get("venise.theme", "dark"));
g.imageSmoothingEnabled = false;
select(active);

refreshInfo();

(async function boot() {
  const started = performance.now();
  const bar = $("#splashBar"), status = $("#splashStatus");
  const step = async (text, pct) => { status.textContent = text; bar.style.width = pct + "%"; await sleep(260); };

  await step("Starting the Lua 5.3 runtime", 20);
  await step("Loading scripts", 50);
  await refreshScripts(false);
  await step("Reading recent files", 75);
  renderRecent();
  await step("Preparing the workspace", 100);
  const left = 1600 - (performance.now() - started);
  if (left > 0) await sleep(left);

  log("sys", F ? "Venise ready. Press Inject to start the game, then Execute your script." : "The Lua runtime (src/vendor/fengari-web.js) is missing. Reinstall Venise.");

  // Opened by double-clicking a .lua file: go straight to the editor, like Visual Studio does for a project.
  let opened = false;
  for (const p of api.launchFiles || []) opened = (await openPath(p)) || opened;
  showView(opened ? "ide" : "start");
})();
})();
