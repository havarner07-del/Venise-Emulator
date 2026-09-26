// Turns the `neu build` output into a ready-to-play folder, laid out like a game install:
//
//   release/Venise/
//     Venise.exe          <- double-click this
//     resources.neu       <- the app's UI (must stay next to Venise.exe)
//     Data/Scripts/       <- your .lua scripts
//     Data/Images/        <- pictures for the "Press me" button
//     Data/Game/          <- put a game here as main.lua
//     README.txt
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const out = path.join(root, "release", "Venise");

function findFile(dir, test) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, test); if (hit) return hit; }
    else if (test(e.name)) return p;
  }
  return null;
}

async function main() {
  const exe = findFile(dist, n => n.endsWith("-win_x64.exe"));
  const res = findFile(dist, n => n === "resources.neu");
  if (!exe || !res) throw new Error("Run `neu build` first: couldn't find the Windows exe and resources.neu in dist/.");

  fs.rmSync(out, { recursive: true, force: true });
  for (const d of ["Data/Scripts", "Data/Images", "Data/Game"]) fs.mkdirSync(path.join(out, d), { recursive: true });

  const outExe = path.join(out, "Venise.exe");
  fs.copyFileSync(exe, outExe);
  fs.copyFileSync(res, path.join(out, "resources.neu"));

  for (const f of fs.readdirSync(path.join(root, "scripts"))) {
    fs.copyFileSync(path.join(root, "scripts", f), path.join(out, "Data", "Scripts", f));
  }

  fs.writeFileSync(path.join(out, "Data", "Images", "PUT IMAGES HERE.txt"),
    "Put .png, .jpg, .gif, .webp or .bmp files in this folder.\r\nThe \"Press me\" button shows a random one.\r\n");
  fs.writeFileSync(path.join(out, "Data", "Game", "PUT YOUR GAME HERE.txt"),
    "Put a Lua game here as main.lua and press Inject to run it.\r\n" +
    "If there is no main.lua, Venise runs its built-in demo game (Coin Run).\r\n\r\n" +
    "Games can use: cls, pset, line, rect, rectfill, circfill, text, btn, time, rnd\r\n" +
    "and the callbacks _init(), _update() (30 times a second) and _draw().\r\n");
  fs.writeFileSync(path.join(out, "README.txt"),
    "VENISE\r\n======\r\n\r\n" +
    "Double-click Venise.exe to start.\r\n\r\n" +
    "Keep Venise.exe and resources.neu together in this folder.\r\n" +
    "To get a desktop icon: right-click Venise.exe > Send to > Desktop (create shortcut).\r\n\r\n" +
    "Data\\Scripts  your scripts (they show in the sidebar)\r\n" +
    "Data\\Images   pictures for the Press me button\r\n" +
    "Data\\Game     your game as main.lua\r\n\r\n" +
    "If Windows shows \"Windows protected your PC\", click More info > Run anyway.\r\n" +
    "Venise needs Microsoft Edge WebView2, which comes with Windows 10 and 11.\r\n");

  // Give the exe the Venise icon. rcedit is a Windows tool, so this runs on Windows only (the CI build does).
  if (process.platform === "win32") {
    const { rcedit } = require("rcedit");
    const pngToIco = require("png-to-ico").default || require("png-to-ico");
    const ico = path.join(root, "dist", "venise.ico");
    fs.writeFileSync(ico, await pngToIco(path.join(root, "src", "icon.png")));
    await rcedit(outExe, {
      icon: ico,
      "version-string": { ProductName: "Venise", FileDescription: "Venise", CompanyName: "Venise" },
      "file-version": "1.0.0",
      "product-version": "1.0.0",
    });
  } else {
    console.log("Skipped setting the exe icon (needs Windows).");
  }

  console.log("Built " + path.relative(root, out));
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
