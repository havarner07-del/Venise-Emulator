// Builds the ready-to-run Venise folder at the top of the project, laid out like a game:
//
//   Venise/
//     Venise.exe          <- double-click this
//     resources.neu       <- the app's UI (must stay next to Venise.exe)
//     README.txt
//     Data/Scripts/       <- your .lua scripts
//     Data/Images/        <- pictures for the "Press me" button
//     Data/Game/          <- put a game here as main.lua
//
// Only Venise.exe, resources.neu and README.txt are replaced. Nothing you put in Data is touched.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const out = path.join(root, "Venise");

function findFile(dir, test) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, test); if (hit) return hit; }
    else if (test(e.name)) return p;
  }
  return null;
}

function writeIfMissing(file, text) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
}

const exe = fs.existsSync(dist) && findFile(dist, n => n.endsWith("-win_x64.exe"));
const res = fs.existsSync(dist) && findFile(dist, n => n === "resources.neu");
if (!exe || !res) {
  console.error("Run `neu build` first: couldn't find the Windows exe and resources.neu in dist/.");
  process.exit(1);
}

for (const d of ["Data/Scripts", "Data/Images", "Data/Game"]) fs.mkdirSync(path.join(out, d), { recursive: true });

fs.copyFileSync(exe, path.join(out, "Venise.exe"));
fs.copyFileSync(res, path.join(out, "resources.neu"));

for (const f of fs.readdirSync(path.join(root, "scripts"))) {
  const target = path.join(out, "Data", "Scripts", f);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(root, "scripts", f), target);
}

writeIfMissing(path.join(out, "Data", "Images", "PUT IMAGES HERE.txt"),
  "Put .png, .jpg, .gif, .webp or .bmp files in this folder.\r\nThe \"Press me\" button shows a random one.\r\n");
writeIfMissing(path.join(out, "Data", "Game", "PUT YOUR GAME HERE.txt"),
  "Put a Lua game here as main.lua and press Inject to run it.\r\n" +
  "If there is no main.lua, Venise runs its built-in demo game (Coin Run).\r\n\r\n" +
  "Games can use: cls, pset, line, rect, rectfill, circfill, text, btn, time, rnd\r\n" +
  "and the callbacks _init(), _update() (30 times a second) and _draw().\r\n");

fs.writeFileSync(path.join(out, "README.txt"),
  "VENISE\r\n======\r\n\r\n" +
  "Double-click Venise.exe to start.\r\n\r\n" +
  "Keep Venise.exe and resources.neu together in this folder.\r\n" +
  "You can move the whole Venise folder anywhere, like C:\\Games\\Venise.\r\n" +
  "For a desktop icon: right-click Venise.exe > Send to > Desktop (create shortcut).\r\n\r\n" +
  "Data\\Scripts  your scripts (they show in the sidebar)\r\n" +
  "Data\\Images   pictures for the Press me button\r\n" +
  "Data\\Game     your game as main.lua\r\n\r\n" +
  "If Windows shows \"Windows protected your PC\", click More info > Run anyway.\r\n" +
  "Venise needs Microsoft Edge WebView2, which comes with Windows 10 and 11.\r\n");

console.log("Built " + path.relative(root, out) + path.sep + "Venise.exe");
