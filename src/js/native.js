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

  // Window size for each screen, like Visual Studio: small splash, then the start window, then the full editor.
  const LAYOUTS = {
    splash: { width: 600, height: 340, minWidth: 600, minHeight: 340, maxWidth: 600, maxHeight: 340, resizable: false },
    start: { width: 1000, height: 640, minWidth: 820, minHeight: 540, maxWidth: 10000, maxHeight: 10000, resizable: true },
    ide: { width: 1200, height: 760, minWidth: 860, minHeight: 560, maxWidth: 10000, maxHeight: 10000, resizable: true },
  };

  let lastImageUrl = null;
  let onWindowState = () => {};

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

    // Files passed on the command line, e.g. when a .lua file is opened with Venise from Explorer.
    launchFiles: (window.NL_ARGS || []).slice(1).filter(a => !a.startsWith("--") && SCRIPT_EXT.test(a)),

    win: {
      async layout(name) {
        const size = LAYOUTS[name];
        if (!size) return;
        if (await N.window.isMaximized()) { await N.window.unmaximize(); onWindowState(false); }
        await N.window.setSize(size);
        await N.window.center();
      },
      min: () => N.window.minimize(),
      async max() {
        if (await N.window.isMaximized()) { await N.window.unmaximize(); onWindowState(false); }
        else { await N.window.maximize(); onWindowState(true); }
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
