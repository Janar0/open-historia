/*! Open Historia — desktop bridge for the game page © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The game runs at http://localhost:3000, so it is an ordinary web page with no way
// to know it is inside the desktop app — and no way to check for a new release
// itself (GitHub sends no CORS headers on release assets). This exposes just enough
// for the existing update banner to work here: a signal that we ARE the desktop app,
// a subscription to what the main process found, and a way to open the download.
//
// Deliberately tiny. The page never sees ipcRenderer, and there is nothing here that
// can act on the machine beyond opening a download in the normal browser.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ohDesktop", {
  isDesktop: true,
  // Fires with { build, notes, url } when a newer release exists, and is also
  // replayed on subscribe so a late-mounting banner still hears about it.
  onUpdate: (fn) => {
    ipcRenderer.on("desktop:update", (_event, payload) => fn(payload));
    ipcRenderer.invoke("desktop:update-state").then((state) => { if (state) fn(state); });
  },
  // Opens the installer in the player's browser. Downloading it inside the app
  // would leave them with a file and no idea where it went.
  download: (url) => ipcRenderer.invoke("desktop:download", url),
});
