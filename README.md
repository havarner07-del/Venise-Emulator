# Venise

A desktop Lua executor and emulator workbench built with [Neutralinojs](https://neutralino.js.org). Venise runs a Lua game inside its own Lua 5.3 VM. You can inject into it and execute scripts against it while it runs.

## Install

1. On GitHub, open the **Actions** tab and click the latest **Build Venise** run.
2. Under **Artifacts**, download **VeniseSetup**, unzip it and double-click `VeniseSetup.exe`.
3. Click through the installer. It doesn't need admin rights.

The installer adds **Venise** to the Start menu and the desktop, and adds Venise to "Open with" for `.lua` files. After that, open Venise like any other app, such as Visual Studio: from the Start menu, the desktop icon, or by right-clicking a `.lua` file and choosing **Open with → Venise**.

If Windows shows "Windows protected your PC", click **More info → Run anyway**. The warning appears because the installer isn't code-signed. Venise uses Microsoft Edge WebView2, which comes with Windows 10 and 11.

### What happens when it opens

1. **Splash screen:** a small window shows while Venise loads the Lua runtime and your scripts.
2. **Start window:** **Open recent** lists the scripts you've opened or saved, with search. **Get started** offers: open a script, create a new script, inject into a game, or open the Data folder. **Continue without code** goes straight to the editor.
3. **Editor:** the full Venise window. The home button next to **Press me** takes you back to the Start window.

If you open a `.lua` file with Venise, it skips the Start window and opens the file in the editor.

### Where things are installed

```
%LOCALAPPDATA%\Programs\Venise\
├── Venise.exe
├── resources.neu
└── Data\
    ├── Scripts\     your .lua scripts (they show in the sidebar)
    ├── Images\      pictures for the "Press me" button
    └── Game\        put a game here as main.lua
```

Uninstall from **Settings → Apps**. Your Data folder is kept, so you don't lose your scripts.

### No-install version

The **Venise-portable** artifact is the same app as a plain folder. Unzip it anywhere and double-click `Venise.exe`.

## Using it

| Control | What it does |
|---|---|
| **Press me** | Shows a random image from `Data\Images` |
| **Inject** / **Detach** | Starts the game in a fresh Lua VM and attaches the executor, or closes it |
| **Execute** (Ctrl+Enter) | Runs the open script inside the injected game |
| **Clear** | Empties the editor |
| **Open File** (Ctrl+O) / **Save File** (Ctrl+S) | Opens or saves `.lua` files. Ctrl+Shift+S saves as a new file |
| **Compile** | Checks the script for syntax errors. Errors also show live in the status bar |
| Sun / moon button | Switches between light and dark themes |

## Running your own game

Put your game in `Data\Game\main.lua` and press **Inject**. If there's no `main.lua`, Venise runs its built-in demo, Coin Run. Games can use these functions:

- `cls(c)`, `pset(x,y,c)`, `line(x0,y0,x1,y1,c)`, `rect(...)`, `rectfill(...)`, `circfill(x,y,r,c)` and `text(s,x,y,c)`
- `btn(i)` for input: 0 left, 1 right, 2 up, 3 down, 4 Z, 5 X
- `time()` and `rnd(n)`
- The callbacks `_init()`, `_update()` (called 30 times a second) and `_draw()`

The screen is 128×128 and uses a 16-color palette. `print()` writes to the Output panel.

## Working on the source

```
src/                    the app: index.html, styles.css, app.js, js/native.js, vendor/fengari-web.js
scripts/                scripts copied into Data/Scripts in the release
tools/package.js        builds the portable folder in release/portable/Venise
installer/venise.iss    Inno Setup script that turns it into VeniseSetup.exe
neutralino.config.json  window size, title, allowed native APIs
```

To work on the source, install [Node.js](https://nodejs.org), then run:

```
npm install
npm run setup    # downloads the Neutralino runtime into bin/ and src/js/neutralino.js
npm start        # opens Venise from source
npm run build    # makes release/portable/Venise with Venise.exe
```

To build the installer on Windows, install [Inno Setup 6](https://jrsoftware.org/isinfo.php), run `npm run build`, then compile `installer\venise.iss`.

The exe gets its Venise icon only when you build on Windows. The GitHub build does this for you.

To support a game written for another engine, add that engine's functions in `registerApi()` in `src/app.js`.
