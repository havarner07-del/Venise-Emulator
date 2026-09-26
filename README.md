# Venise

A desktop Lua executor and emulator workbench built with [Neutralinojs](https://neutralino.js.org). Venise runs a Lua game inside its own Lua 5.3 VM. You can inject into it and execute scripts against it while it runs.

## Open it

Venise is a folder you open like a game. There's nothing to install.

```
Venise/
├── Venise.exe        ← double-click this
├── resources.neu     ← the app itself; keep it next to Venise.exe
├── README.txt
└── Data/
    ├── Scripts/      ← your .lua scripts (they show in the sidebar)
    ├── Images/       ← pictures for the "Press me" button
    └── Game/         ← put a game here as main.lua
```

1. Get the project: on GitHub, click **Code → Download ZIP** and extract it, or `git pull` if you already have it.
2. Open the **Venise** folder and double-click **Venise.exe**.

You can move the Venise folder anywhere, such as `C:\Games\Venise`. For a desktop icon, right-click `Venise.exe` and choose **Send to → Desktop (create shortcut)**.

If Windows shows "Windows protected your PC", click **More info → Run anyway**. It appears because the exe isn't code-signed. Venise uses Microsoft Edge WebView2, which comes with Windows 10 and 11.

### What happens when it opens

1. **Splash screen:** a small window shows while Venise loads.
2. **Start window:** **Open recent** lists the scripts you've opened or saved. **Get started** offers: open a script, create a new script, inject into a game, or open the Data folder. **Continue without code** goes straight to the editor.
3. **Editor:** the full Venise window. The home button next to **Press me** takes you back to the Start window.

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
| **ⓘ** button, **F1**, or the Lua label in the status bar | Opens **Runtime info**: window size and position, the local server port and URL, process ID, Neutralino and Lua versions, OS, memory, frame rate and folders. It updates live and has a **Copy info** button |

## Running your own game

Put your game in `Data\Game\main.lua` and press **Inject**. If there's no `main.lua`, Venise runs its built-in demo, Coin Run. Games can use these functions:

- `cls(c)`, `pset(x,y,c)`, `line(x0,y0,x1,y1,c)`, `rect(...)`, `rectfill(...)`, `circfill(x,y,r,c)` and `text(s,x,y,c)`
- `btn(i)` for input: 0 left, 1 right, 2 up, 3 down, 4 Z, 5 X
- `time()` and `rnd(n)`
- `getwindowinfo()` returns a table with `title`, `width`, `height`, `x`, `y`, `maximized`, `port`, `url`, `pid` and `mode`
- `getruntimeinfo()` returns a table with `lua`, `engine`, `neutralino`, `client`, `os`, `arch`, `app_version`, `memory_total_mb`, `memory_free_mb`, `injected`, `game`, `fps`, `uptime` and `data_path`
- The callbacks `_init()`, `_update()` (called 30 times a second) and `_draw()`

The screen is 128×128 and uses a 16-color palette. `print()` writes to the Output panel.

## Working on the source

```
src/                    the app: index.html, styles.css, app.js, js/native.js, vendor/fengari-web.js
scripts/                starter scripts copied into Venise/Data/Scripts
Venise/                 the ready-to-run app folder (built by npm run build)
tools/package.js        copies the build into Venise/ without touching Data/
neutralino.config.json  window size, title, allowed native APIs
```

To work on the source, install [Node.js](https://nodejs.org), then run:

```
npm install
npm run setup    # downloads the Neutralino runtime into bin/ and src/js/neutralino.js
npm start        # opens Venise from source
npm run build    # rebuilds Venise/Venise.exe and Venise/resources.neu from src/
```

The exe's icon comes from `src/icon.png`.

To support a game written for another engine, add that engine's functions in `registerApi()` in `src/app.js`.
