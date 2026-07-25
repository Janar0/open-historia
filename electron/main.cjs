/*! Open Historia — desktop app shell © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The desktop app used to be a .bat file: it made the player install Node, ran
// `npm install`, built the client with Vite ON THEIR MACHINE, and left a console
// window open for the whole session. This replaces all of that. The client is
// already built when it ships, the server runs inside this process, and the game
// gets a real window — no terminal, nothing to keep open.
//
// CommonJS on purpose: package.json is `"type": "module"`, so a .js file here
// would be ESM, and Electron's main process is most predictable as CJS. The
// server is ESM and is pulled in with a dynamic import().

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

// Everything the app writes lives under Electron's per-user data directory.
// Program Files is read-only for a normal user and the app bundle is read-only
// full stop, so nothing may be written next to the code (see server/dataDir.js).
const USER_ROOT = app.getPath("userData");
const DATA_DIR = path.join(USER_ROOT, "server", "data");
const ASSETS_DIR = path.join(USER_ROOT, "public", "assets");

// The map manifest lists paths relative to a project root ("public/assets/...",
// "server/data/scenarios/..."), so pointing the fetcher's cwd at USER_ROOT lands
// every file exactly where DATA_DIR and ASSETS_DIR already expect it — no
// changes to the fetcher, and one place that decides the layout.
process.env.OH_DATA_DIR = DATA_DIR;
process.env.OH_ASSETS_DIR = ASSETS_DIR;

const APP_ROOT = path.join(__dirname, "..");
// asarUnpack keeps scripts/ outside the archive so a child process can run it.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const FETCH_SCRIPT = unpacked(path.join(APP_ROOT, "scripts", "fetch-map-assets.mjs"));
const MANIFEST = path.join(APP_ROOT, "scripts", "map-assets.json");

let mainWindow = null;
let setupWindow = null;

// --- map data ---------------------------------------------------------------

// Which manifest entries are still missing or the wrong size. Cheap (a stat per
// file) and it is what decides whether the setup screen is shown at all, so a
// second launch goes straight into the game.
const missingAssets = () => {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return []; // no manifest is not a reason to block the player
  }
  return (manifest.assets ?? []).filter((asset) => {
    try {
      return fs.statSync(path.join(USER_ROOT, asset.path)).size !== asset.bytes;
    } catch {
      return true;
    }
  });
};

// Runs the existing fetcher as a child process and turns its --progress lines
// into window progress. ELECTRON_RUN_AS_NODE makes our own binary behave as
// plain Node, so the player never needs Node installed.
const downloadMapData = (onProgress) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [FETCH_SCRIPT, "--ensure", "--progress"], {
      cwd: USER_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("@progress ")) continue;
        try {
          onProgress(JSON.parse(line.slice("@progress ".length)));
        } catch {
          /* a malformed progress line is not worth failing a download over */
        }
      }
    });
    // Never rejects: a failed download must still let the player into the game
    // (the fetcher leaves any existing file in place and warns).
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });

// --- windows ----------------------------------------------------------------

const createSetupWindow = () =>
  new BrowserWindow({
    width: 560,
    height: 320,
    resizable: false,
    // No menu bar, no dev chrome — this is a setup dialog, not a browser.
    autoHideMenuBar: true,
    backgroundColor: "#0d1122",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });

const createMainWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#0d1122",
    show: false,
    title: "Open Historia",
  });
  // Links to GitHub/Discord open in the real browser rather than replacing the
  // game with a page the player cannot navigate back from.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.once("ready-to-show", () => win.show());
  return win;
};

// --- boot -------------------------------------------------------------------

// Starting the server is importing it: server.js calls app.listen() at module
// scope. It reads OH_DATA_DIR / OH_ASSETS_DIR, both already set above.
const startServer = async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  await import(`file://${path.join(APP_ROOT, "server", "server.js").replace(/\\/g, "/")}`);
};

const boot = async () => {
  const pending = missingAssets();
  if (pending.length) {
    setupWindow = createSetupWindow();
    await setupWindow.loadFile(path.join(__dirname, "setup.html"));
    setupWindow.show();
    const totalBytes = pending.reduce((sum, asset) => sum + asset.bytes, 0);
    let doneBytes = 0;
    let currentAsset = "";
    await downloadMapData(({ asset, received, total }) => {
      if (asset !== currentAsset) {
        if (currentAsset) doneBytes += pending.find((a) => a.asset === currentAsset)?.bytes ?? 0;
        currentAsset = asset;
      }
      setupWindow?.webContents.send("setup:progress", {
        asset,
        received: doneBytes + received,
        total: totalBytes,
        assetTotal: total,
      });
    });
    setupWindow?.webContents.send("setup:done");
  }

  await startServer();
  mainWindow = createMainWindow();
  const port = process.env.PORT || 3000;
  await mainWindow.loadURL(`http://localhost:${port}`);
  setupWindow?.close();
  setupWindow = null;
};

// One instance only: a second launch would hit EADDRINUSE on the server port and
// die, which reads to the player as "the app is broken".
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot);
  app.on("window-all-closed", () => app.quit());
  ipcMain.handle("setup:cancel", () => app.quit());
}
