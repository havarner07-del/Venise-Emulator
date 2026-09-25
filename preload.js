const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("venise", {
  listScripts: () => invoke("scripts:list"),
  readFile: p => invoke("file:read", p),
  openFile: () => invoke("file:open"),
  saveFile: data => invoke("file:save", data),
  randomImage: () => invoke("images:random"),
  loadGame: () => invoke("game:load"),
  openFolder: key => invoke("folder:open", key),
  win: {
    min: () => ipcRenderer.send("win:min"),
    max: () => ipcRenderer.send("win:max"),
    close: () => ipcRenderer.send("win:close"),
    onState: cb => ipcRenderer.on("win:state", (_e, maximized) => cb(maximized)),
  },
});
