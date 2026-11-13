/* 某些 IDE / CLI 会话会注入 NODE_OPTIONS=--require <shim>。
   打包后的 Electron 不支持这类选项，会让 renderer 直接崩溃；
   主进程清掉，后续派生的 renderer / webview 就不会继承。 */
if (process.env.NODE_OPTIONS) delete process.env.NODE_OPTIONS;

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#EFF1F5",
    title: "钉钉",
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // webview 内的外链一律交给系统浏览器，避免在 App 里跳飞
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.on("win-ctl", (_evt, action) => {
  if (!win || win.isDestroyed()) return;
  if (action === "min") win.minimize();
  else if (action === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === "close") win.close();
});

/* 打包成 asar / 放到只读安装目录后 __dirname 不可写，
   缓存和状态一律落到用户数据目录；首次启动把旧位置的缓存迁过来。 */
function storeFile(name) {
  const dir = app.getPath("userData");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const target = path.join(dir, name);
  if (!fs.existsSync(target)) {
    try {
      const legacy = path.join(__dirname, name);
      if (fs.existsSync(legacy)) fs.copyFileSync(legacy, target);
    } catch (_) {}
  }
  return target;
}

ipcMain.on("debug-report", (_evt, data) => {
  try {
    fs.writeFileSync(
      storeFile("runtime-status.json"),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  } catch (_) {}
});

/* 抓到的真实内容落盘缓存，下次启动立刻有内容，不用等重新登录/抓取 */
ipcMain.handle("cache-read", async () => {
  try {
    return JSON.parse(fs.readFileSync(storeFile("data-cache.json"), "utf-8"));
  } catch (_) {
    return {};
  }
});
ipcMain.handle("cache-write", async (_evt, data) => {
  try {
    fs.writeFileSync(storeFile("data-cache.json"), JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (_) {
    return false;
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
