const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

// Folders live next to Venise.exe (portable build) or the project folder (running from source),
// so you can drop scripts and images in without digging through AppData.
function pickBaseDir() {
  const candidate = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : __dirname);
  try {
    fs.mkdirSync(path.join(candidate, "scripts"), { recursive: true });
    fs.accessSync(candidate, fs.constants.W_OK);
    return candidate;
  } catch {
    return app.getPath("userData");
  }
}

let win;
let dirs;
const SCRIPT_EXT = /\.(lua|luau|txt)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

function listFiles(dir, pattern) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && pattern.test(e.name))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    backgroundColor: "#0e0c14",
    title: "Venise",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "src", "index.html"));
  win.on("maximize", () => win.webContents.send("win:state", true));
  win.on("unmaximize", () => win.webContents.send("win:state", false));
}

app.whenReady().then(() => {
  const base = pickBaseDir();
  dirs = {
    scripts: path.join(base, "scripts"),
    images: path.join(base, "images"),
    game: path.join(base, "game"),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

  ipcMain.handle("scripts:list", () =>
    listFiles(dirs.scripts, SCRIPT_EXT).map(name => ({ name, path: path.join(dirs.scripts, name) })));

  ipcMain.handle("file:read", (_e, p) => fs.readFileSync(p, "utf8"));

  ipcMain.handle("file:open", async () => {
    const r = await dialog.showOpenDialog(win, {
      defaultPath: dirs.scripts,
      properties: ["openFile"],
      filters: [{ name: "Lua scripts", extensions: ["lua", "luau", "txt"] }, { name: "All files", extensions: ["*"] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    return { name: path.basename(p), path: p, code: fs.readFileSync(p, "utf8") };
  });

  ipcMain.handle("file:save", async (_e, { path: p, name, code, saveAs }) => {
    let target = p;
    if (!target || saveAs) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(dirs.scripts, name || "Script.lua"),
        filters: [{ name: "Lua scripts", extensions: ["lua"] }],
      });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    fs.writeFileSync(target, code, "utf8");
    return { name: path.basename(target), path: target };
  });

  ipcMain.handle("images:random", () => {
    const files = listFiles(dirs.images, IMAGE_EXT);
    if (!files.length) return { folder: dirs.images, image: null };
    const name = files[Math.floor(Math.random() * files.length)];
    return { folder: dirs.images, count: files.length, image: { name, url: pathToFileURL(path.join(dirs.images, name)).href } };
  });

  ipcMain.handle("game:load", () => {
    const p = path.join(dirs.game, "main.lua");
    return fs.existsSync(p) ? { name: "game/main.lua", code: fs.readFileSync(p, "utf8") } : null;
  });

  ipcMain.handle("folder:open", (_e, key) => dirs[key] && shell.openPath(dirs[key]));

  ipcMain.on("win:min", () => win.minimize());
  ipcMain.on("win:max", () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on("win:close", () => win.close());

  createWindow();
});

app.on("window-all-closed", () => app.quit());
