/*! Open Historia — bring an older install's games across © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The old desktop release was a zip you extracted and ran a launcher from, and it
// kept everything in <extracted folder>/server/data. The installed app writes to
// its own per-user data directory instead, so a player who upgrades opens the new
// app and finds an empty library while their saves sit in the old folder. Nothing
// carried them across; this does.
//
// It only ever runs when the new data directory has no games yet, so it cannot
// overwrite anything, and it copies rather than moves — the old folder is left
// exactly as it was in case anything goes wrong.

const fs = require("node:fs");
const path = require("node:path");

// A folder is an old install if it has the manifest the server writes.
const MARKER = path.join("server", "data", "game-manifest.json");
// Caches and telemetry markers rebuild themselves; hub-cache alone can be >100MB,
// and copying it would make the import look broken for no benefit.
const SKIP = new Set(["hub-cache", "import-pings"]);

const looksLikeInstall = (dir) => {
  try {
    return fs.existsSync(path.join(dir, MARKER));
  } catch {
    return false;
  }
};

// Where an extracted zip usually ends up. Deliberately shallow: this runs on the
// UI thread at startup, so it checks a handful of likely folders one level deep
// rather than walking the disk.
const findLegacyInstall = (home) => {
  const roots = ["Downloads", "Desktop", "Documents", ""].map((d) => path.join(home, d));
  for (const root of roots) {
    if (looksLikeInstall(root)) return root;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Cheap name filter first — readdir on every folder in Documents is slow.
      if (!/open[-\s]?historia|pax[-\s]?historia/i.test(entry.name)) continue;
      const candidate = path.join(root, entry.name);
      if (looksLikeInstall(candidate)) return candidate;
      // Zips are often extracted into a wrapper folder of the same name.
      try {
        for (const inner of fs.readdirSync(candidate, { withFileTypes: true })) {
          if (!inner.isDirectory()) continue;
          const nested = path.join(candidate, inner.name);
          if (looksLikeInstall(nested)) return nested;
        }
      } catch { /* unreadable — skip */ }
    }
  }
  return null;
};

// True when this profile has never held a library, which is the only time an
// import is safe to offer.
const isFreshProfile = (dataDir) => {
  try {
    return !fs.existsSync(path.join(dataDir, "game-manifest.json"));
  } catch {
    return true;
  }
};

const importFrom = (installDir, dataDir) => {
  const source = path.join(installDir, "server", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    fs.cpSync(path.join(source, entry.name), path.join(dataDir, entry.name), {
      recursive: true,
      force: true,
    });
    copied += 1;
  }
  return copied;
};

// How many games are in there, so the prompt can say something concrete rather
// than asking the player to trust a path.
const countGames = (installDir) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(installDir, MARKER), "utf8"));
    return Array.isArray(manifest?.order) ? manifest.order.length : 0;
  } catch {
    return 0;
  }
};

module.exports = { findLegacyInstall, isFreshProfile, importFrom, countGames, looksLikeInstall };
