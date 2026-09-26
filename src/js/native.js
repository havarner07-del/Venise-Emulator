// Connects the UI to Neutralino (files, dialogs, window controls).
// Everything the user adds lives in the Data folder next to Venise.exe, like a game install:
//   Venise/Venise.exe, Venise/resources.neu, Venise/Data/{Scripts,Images,Game}
(() => {
  const N = window.Neutralino;
  if (!N) return; // opened in a plain browser: app.js falls back to its no-file-access stubs

  N.init();

  // Anchor Data to the folder Venise.exe sits in, even when launched from a shortcut with another "Start in".
  const exePath = (window.NL_ARGS && window.NL_ARGS[0] || "").replace(/\\/g, "/");
  const isAbsolute = /^([a-zA-Z]:)?\//.test(exePath);
  const root = isAbsolute && exePath.includes("/")
    ? exePath.slice(0, exePath.lastIndexOf("/"))
    : (window.NL_PATH || ".").replace(/\\/g, "/");
  const data = root + "/Data";
  const dirs = { data, scripts: data + "/Scripts", images: data + "/Images", game: data + "/Game" };
  const SCRIPT_EXT = /\.(lua|luau|txt)$/i;
  const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

  const winPath = p => (window.NL_OS === "Windows" ? p.replace(/\//g, "\\") : p);
  const baseName = p => p.split(/[\\/]/).pop();

  async function ensureDir(d) {
    try { await N.filesystem.getStats(d); } catch { await N.filesystem.createDirectory(d); }
  }
  const ready = (async () => {
    try {
      await ensureDir(data);
      for (const d of Object.values(dirs)) await ensureDir(d);
    } catch (err) {
      console.error("Couldn't create the Data folders", err);
    }
  })();

  async function listFiles(dir, pattern) {
    await ready;
    try {
      const entries = await N.filesystem.readDirectory(dir);
      return entries
        .filter(e => e.type === "FILE" && pattern.test(e.entry))
        .map(e => e.entry)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  // The splash is a small fixed window. After it, the window grows once to the main size, and the
  // start window and editor share it: switching between them never resizes or moves the window.
  const SPLASH_SIZE = { width: 600, height: 340, minWidth: 600, minHeight: 340, maxWidth: 600, maxHeight: 340, resizable: false };
  const MAIN_SIZE = { width: 1200, height: 760, minWidth: 860, minHeight: 560, maxWidth: 10000, maxHeight: 10000, resizable: true };
  let windowMode = "splash";

  let lastImageUrl = null;
  let onWindowState = () => {};
  // Square corners while maximized, rounded otherwise (the page draws the rounded window itself).
  const setMaximized = max => {
    document.documentElement.classList.toggle("maximized", max);
    onWindowState(max);
  };

  let osInfo = null;
  N.computer.getOSInfo().then(i => { osInfo = i; }).catch(() => {});

  window.venise = {
    async listScripts() {
      return (await listFiles(dirs.scripts, SCRIPT_EXT)).map(name => ({ name, path: dirs.scripts + "/" + name }));
    },

    readFile: p => N.filesystem.readFile(p),

    async openFile() {
      await ready;
      const picked = await N.os.showOpenDialog("Open script", {
        defaultPath: winPath(dirs.scripts),
        filters: [{ name: "Lua scripts", extensions: ["lua", "luau", "txt"] }, { name: "All files", extensions: ["*"] }],
      });
      if (!picked || !picked.length) return null;
      const p = picked[0];
      return { name: baseName(p), path: p, code: await N.filesystem.readFile(p) };
    },

    async saveFile({ path, name, code, saveAs }) {
      await ready;
      let target = path;
      if (!target || saveAs) {
        target = await N.os.showSaveDialog("Save script", {
          defaultPath: winPath(dirs.scripts + "/" + (name || "Script.lua")),
          filters: [{ name: "Lua scripts", extensions: ["lua"] }],
        });
        if (!target) return null;
        if (!/\.\w+$/.test(baseName(target))) target += ".lua";
      }
      await N.filesystem.writeFile(target, code);
      return { name: baseName(target), path: target };
    },

    async randomImage() {
      const files = await listFiles(dirs.images, IMAGE_EXT);
      const folder = winPath(dirs.images);
      if (!files.length) return { folder, image: null };
      const name = files[Math.floor(Math.random() * files.length)];
      const bytes = await N.filesystem.readBinaryFile(dirs.images + "/" + name);
      const type = IMAGE_TYPES[name.split(".").pop().toLowerCase()];
      if (lastImageUrl) URL.revokeObjectURL(lastImageUrl);
      lastImageUrl = URL.createObjectURL(new Blob([bytes], { type }));
      return { folder, count: files.length, image: { name, url: lastImageUrl } };
    },

    async loadGame() {
      await ready;
      try {
        return { name: "Data/Game/main.lua", code: await N.filesystem.readFile(dirs.game + "/main.lua") };
      } catch {
        return null;
      }
    },

    async openFolder(key) {
      await ready;
      const dir = winPath(dirs[key]);
      if (window.NL_OS === "Windows") await N.os.execCommand(`explorer "${dir}"`, { background: true });
      else await N.os.open("file://" + dir);
    },

    // Launch an external app the normal way, like clicking its shortcut. Nothing is injected or read
    // from the launched app; Venise just asks Windows to start it and then leaves it alone.
    //   openApp({ uri: "roblox-player:1" })  -> starts Roblox through its own launcher (it auto-updates)
    //   openApp({ path: "C:/Path/App.exe" }) -> starts that executable
    async openApp({ uri, path } = {}) {
      try {
        if (uri) {
          // A registered URL protocol (e.g. roblox-player:) — Windows hands it to the app that owns it.
          if (window.NL_OS === "Windows") await N.os.execCommand(`cmd /c start "" "${uri}"`, { background: true });
          else await N.os.open(uri);
          return { ok: true, launched: uri };
        }
        if (path) {
          const exe = winPath(path);
          if (window.NL_OS === "Windows") {
            const dir = exe.slice(0, Math.max(exe.lastIndexOf("\\"), 0));
            await N.os.execCommand(`cmd /c start "" /d "${dir}" "${exe}"`, { background: true });
          } else {
            await N.os.execCommand(`"${exe}" &`, { background: true });
          }
          return { ok: true, launched: exe };
        }
        return { ok: false, error: "Nothing to launch" };
      } catch (err) {
        return { ok: false, error: (err && err.message) || String(err) };
      }
    },

    // Details about this window and the runtime behind it (shown in Runtime info and returned to Lua).
    async info() {
      const [size, pos, isMax, mem] = await Promise.all([
        N.window.getSize().catch(() => null),
        N.window.getPosition().catch(() => null),
        N.window.isMaximized().catch(() => false),
        N.computer.getMemoryInfo().catch(() => null),
      ]);
      const maximized = isMax === true;
      // Also catches maximize/restore done with Windows shortcuts or snapping.
      if (document.documentElement.classList.contains("maximized") !== maximized) setMaximized(maximized);
      return {
        window: {
          title: document.title,
          width: size && typeof size.width === "number" ? size.width : null,
          height: size && typeof size.height === "number" ? size.height : null,
          x: pos && typeof pos.x === "number" ? pos.x : null,
          y: pos && typeof pos.y === "number" ? pos.y : null,
          maximized,
        },
        server: { port: window.NL_PORT, url: location.origin, pid: Number(window.NL_PID) || window.NL_PID, mode: window.NL_MODE },
        runtime: {
          neutralino: window.NL_VERSION,
          client: window.NL_CVERSION,
          os: osInfo ? `${osInfo.name} ${osInfo.version}`.trim() : window.NL_OS,
          arch: window.NL_ARCH,
          appId: window.NL_APPID,
          appVersion: window.NL_APPVERSION,
          memoryTotalMB: mem && mem.physical ? Math.round(mem.physical.total / 1048576) : null,
          memoryFreeMB: mem && mem.physical ? Math.round(mem.physical.available / 1048576) : null,
        },
        paths: { app: winPath(root), data: winPath(data) },
      };
    },

    // Files passed on the command line, e.g. when a .lua file is opened with Venise from Explorer.
    launchFiles: (window.NL_ARGS || []).slice(1).filter(a => !a.startsWith("--") && SCRIPT_EXT.test(a)),

    win: {
      async layout(name) {
        const mode = name === "splash" ? "splash" : "main";
        if (mode === windowMode) return; // start window <-> editor: keep the user's size and position
        windowMode = mode;
        if (await N.window.isMaximized()) { await N.window.unmaximize(); setMaximized(false); }
        await N.window.setSize(mode === "splash" ? SPLASH_SIZE : MAIN_SIZE);
        await N.window.center();
      },
      min: () => N.window.minimize(),
      async max() {
        if (await N.window.isMaximized()) { await N.window.unmaximize(); setMaximized(false); }
        else { await N.window.maximize(); setMaximized(true); }
      },
      close: () => N.app.exit(),
      onState: cb => { onWindowState = cb; },
    },
  };

  N.events.on("windowClose", () => N.app.exit());

  // The window has no system title bar, so the empty parts of ours drag it (double-click maximizes).
  document.querySelectorAll("[data-drag]").forEach(el => {
    N.window.setDraggableRegion(el).catch(() => {});
    el.addEventListener("dblclick", () => window.venise.win.max());
  });
  // The splash can be dragged anywhere.
  const splash = document.getElementById("splash");
  if (splash) N.window.setDraggableRegion(splash).catch(() => {});
})();
