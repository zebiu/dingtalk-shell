const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  winCtl: (action) => ipcRenderer.send("win-ctl", action),
  report: (data) => ipcRenderer.send("debug-report", data),
  cacheRead: () => ipcRenderer.invoke("cache-read"),
  cacheWrite: (data) => ipcRenderer.invoke("cache-write", data),
});
