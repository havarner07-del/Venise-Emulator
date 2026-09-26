# Venise

A desktop Lua executor and emulator workbench built with [Neutralinojs](https://neutralino.js.org). Venise runs a Lua game inside its own Lua 5.3 VM. You can inject into it and execute scripts against it while it runs.

## Open it

Venise is a folder you open like a game. There's nothing to install.

```
Venise/
├── Venise.exe        ← double-click this
├── resources.neu     ← the app itself; keep it next to Venise.exe
├── README.txt
├── Data/
│   ├── Scripts/      ← your .lua scripts (they show in the sidebar)
│   ├── Images/       ← pictures for the "Press me" button
│   └── Game/         ← put a game here as main.lua
└── Server/           ← the multiplayer server (see Multiplayer below)
```

1. Get the project: on GitHub, click **Code → Download ZIP** and extract it, or `git pull` if you already have it.
2. Open the **Venise** folder and double-click **Venise.exe**.

You can move the Venise folder anywhere, such as `C:\Games\Venise`. For a desktop icon, right-click `Venise.exe` and choose **Send to → Desktop (create shortcut)**.

If Windows shows "Windows protected your PC", click **More info → Run anyway**. It appears because the exe isn't code-signed. Venise uses Microsoft Edge WebView2, which comes with Windows 10 and 11.

### What happens when it opens

1. **Splash screen:** a small window shows while Venise loads.
2. **Start window:** **Open recent** lists the scripts you've opened or saved. **Get started** offers: open a script, create a new script, inject into a game, or open the Data folder. **Continue without code** goes straight to the editor.
3. **Editor:** the full Venise window. The home button next to **Press me** takes you back to the Start window.

The Start window also has a **Launch Roblox** button. It opens Roblox the normal way, through Roblox's own `roblox-player:` launcher (the same one the Play button on roblox.com uses), so Roblox updates itself as usual. Venise only asks Windows to start it and doesn't touch the running app. If nothing happens, install Roblox from roblox.com first.

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

## Multiplayer

Games can play together through a small Venise server. One person runs the server, and every player's Venise connects to it. The server puts players in rooms, passes their messages to each other, and keeps shared state for each room, such as a high score.

**Start the server.** It needs [Node.js](https://nodejs.org) 18 or newer and nothing else. From the Venise folder:

```
node Server\venise-server.js
```

From the source, run `npm run server`. It listens on port 7777 and prints the addresses other players can use, such as `ws://192.168.1.5:7777`. Add `--port 9000` to use another port. If Windows asks whether to allow Node.js through the firewall, allow it on private networks so people on your network can join.

**Play.** Everyone presses **Inject**, opens the **Multiplayer.lua** example, changes `"localhost"` to the server's address if the server runs on another computer, and presses **Execute**. Each player sees the others move in Coin Run, and the room shares one high score.

**In your own game**, use the `net` table:

- `net.connect(address, name, room)`, `net.disconnect()`
- `net.send(channel, data, to)` sends a Lua value to the other players, or only to player `to`
- `net.set(key, value)` and `net.get(key)` change and read the room's shared state
- `net.peers()`, `net.id()` and `net.status()`
- Callbacks: `_connected(id, name, room)`, `_joined(id, name)`, `_left(id, name, reason)`, `_message(from, channel, data, private)`, `_state(key, value, from)`, `_disconnected(reason)` and `_neterror(code, text)`

The **Network** section of Runtime info (F1) shows the connection, room, players and ping. To watch the traffic, start the server with `--log-frames` (add a file name to record to a file); it prints every message in and out as plain JSON. The full protocol, including every message and limit, is in [docs/PROTOCOL.md](docs/PROTOCOL.md). The server has no passwords or encryption, so use it on your own computer or local network.

## Working on the source

```
src/                    the app: index.html, styles.css, app.js, js/native.js, js/net.js, vendor/fengari-web.js
server/                 the multiplayer server (venise-server.js) and its tests
docs/PROTOCOL.md        the network protocol between Venise and the server
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
npm run server   # starts the multiplayer server on port 7777
npm test         # tests the multiplayer server
```

The exe's icon comes from `src/icon.png`.

To support a game written for another engine, add that engine's functions in `registerApi()` in `src/app.js`.
