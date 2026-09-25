# Venise

A desktop Lua executor and emulator workbench. Venise runs a Lua game inside its own Lua 5.3 VM. You can inject into it and execute scripts against it while it runs.

## Open it as an app (double-click)

**Option 1: download Venise.exe (no install needed)**

1. On GitHub, open the **Actions** tab and click the latest **Build Venise.exe** run.
2. Under **Artifacts**, download **Venise-windows** and unzip it.
3. Put `Venise.exe` in its own folder, such as `Documents\Venise`, and double-click it.

The first time it runs, Venise creates `scripts`, `images` and `game` folders next to the exe. Right-click `Venise.exe` and choose **Send to → Desktop (create shortcut)** to get a desktop icon.

Windows SmartScreen may warn you because the exe isn't code-signed. Click **More info → Run anyway**.

**Option 2: run from the source folder**

Install [Node.js](https://nodejs.org), then double-click `Start Venise.bat`. The first run installs everything, which takes a minute.

To build the exe yourself, run `npm install`, then `npm run dist`. The result is `dist\Venise.exe`.

## Using it

| Control | What it does |
|---|---|
| **Press me** | Shows a random image from the `images` folder |
| **Inject** / **Detach** | Starts the game in a fresh Lua VM and attaches the executor, or closes it |
| **Execute** (Ctrl+Enter) | Runs the open script inside the injected game |
| **Clear** | Empties the editor |
| **Open File** (Ctrl+O) / **Save File** (Ctrl+S) | Opens or saves `.lua` files. Ctrl+Shift+S saves as a new file |
| **Compile** | Checks the script for syntax errors. Errors also show live in the status bar |
| Sun / moon button | Switches between light and dark themes |

Scripts saved in the `scripts` folder show up under **Scripts folder** in the sidebar. The refresh button rescans the folder, and the folder button opens it in Explorer.

## Running your own game

Put your game in `game\main.lua` and press **Inject**. If there's no `main.lua`, Venise runs its built-in demo, Coin Run. Games can use these functions:

- `cls(c)`, `pset(x,y,c)`, `line(x0,y0,x1,y1,c)`, `rect(...)`, `rectfill(...)`, `circfill(x,y,r,c)` and `text(s,x,y,c)`
- `btn(i)` for input: 0 left, 1 right, 2 up, 3 down, 4 Z, 5 X
- `time()` and `rnd(n)`
- The callbacks `_init()`, `_update()` (called 30 times a second) and `_draw()`

The screen is 128×128 and uses a 16-color palette. `print()` writes to the Output panel.

To support a game written for another engine, add that engine's functions in `registerApi()` in `src/app.js`.
