/*! Open Historia — in-app update banner © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

import { useEffect, useRef, useState } from "react";
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_REFOCUS_THROTTLE_MS,
  isUpdateAvailable,
  parseUpdateManifest,
} from "./appUpdate.js";

// Stamped into the native app build by the APK workflow (VITE_APP_BUILD / _TRACK).
// Desktop and dev builds have no stamp, so the banner is a no-op there.
const APP_BUILD = Number(import.meta.env.VITE_APP_BUILD);
const APP_TRACK = String(import.meta.env.VITE_APP_TRACK || "stable");
// Stamped into the WEB build by vite.config (WEB_BUILD_ID), which writes the same id
// to version.json beside the bundle. The website has no on-device server and so no
// /api/app-update; it compares its own baked id against that file instead.
const WEB_BUILD = String(import.meta.env.VITE_WEB_BUILD || "");
const VERSION_URL = `${import.meta.env.BASE_URL || "/"}version.json`;
const DISMISS_KEY = "oh-update-dismissed-build";

const bar = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10060,
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.55rem max(0.9rem, env(safe-area-inset-left)) 0.55rem max(0.9rem, env(safe-area-inset-right))",
  paddingTop: "max(0.55rem, env(safe-area-inset-top))",
  background: "linear-gradient(180deg, #12172b, #0d1122)",
  borderBottom: "1px solid rgba(212,175,55,0.35)",
  color: "#f4ead0",
  font: "600 0.85rem/1.3 system-ui, sans-serif",
  boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
};
const text = { flex: 1, minWidth: 0 };
const sub = { display: "block", fontWeight: 400, fontSize: "0.72rem", color: "rgba(244,234,208,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const btn = {
  flex: "0 0 auto",
  background: "linear-gradient(180deg, #d4af37, #b8901f)",
  border: "1px solid rgba(212,175,55,0.6)",
  borderRadius: "9px",
  color: "#1a1206",
  cursor: "pointer",
  font: "700 0.82rem system-ui, sans-serif",
  padding: "0.45rem 0.9rem",
};
const dismissBtn = {
  flex: "0 0 auto",
  background: "transparent",
  border: "none",
  color: "rgba(244,234,208,0.6)",
  cursor: "pointer",
  fontSize: "1.1rem",
  lineHeight: 1,
  padding: "0.2rem 0.35rem",
};

export default function AppUpdateBanner() {
  // Two shapes of "an update exists", one banner. The native app asks its on-device
  // server for the release manifest and updates by downloading an APK; the website
  // compares its baked build id against the deployed version.json and updates by
  // reloading onto the new bundle. Desktop/dev carry neither stamp and no-op.
  // The desktop app announces itself through its preload bridge (electron/
  // gamePreload.cjs) — the page is served from localhost either way, so there is
  // nothing else to detect it by. Its main process does the release check, because
  // a page cannot fetch a GitHub asset (no CORS).
  const isDesktop = typeof window !== "undefined" && window.ohDesktop?.isDesktop === true;
  const isApp = !isDesktop && Number.isFinite(APP_BUILD) && APP_BUILD > 0;
  const isWeb = !isDesktop && !isApp && WEB_BUILD !== "";
  const supported = isDesktop || isApp || isWeb;
  const [latest, setLatest] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      // App builds compare numerically ("is this newer than what I dismissed"); web
      // ids are opaque and compare by equality, so keep the raw string for them.
      return isWeb || isDesktop ? String(stored ?? "") : Number(stored) || 0;
    } catch {
      return isWeb || isDesktop ? "" : 0;
    }
  });
  const [updating, setUpdating] = useState(false);
  const lastRefocusRef = useRef(0);

  useEffect(() => {
    if (!supported) return undefined;
    if (isDesktop) {
      // Main already polls; just listen. It replays the last result on subscribe,
      // so a banner that mounts after the check still hears about it.
      window.ohDesktop.onUpdate((payload) => {
        if (payload?.build && payload?.url) setLatest({ ...payload, desktop: true });
      });
      return undefined;
    }
    let cancelled = false;
    const check = async () => {
      try {
        if (isWeb) {
          // no-store, or the browser hands back the very file we are trying to
          // notice a change in.
          const res = await fetch(VERSION_URL, { cache: "no-store", signal: AbortSignal.timeout(6000) });
          if (!res.ok) return;
          const deployed = String((await res.json())?.build ?? "");
          // Any DIFFERENCE means the deploy moved on. Not a > comparison: the ids are
          // opaque, and a rollback is just as much "not what you are running".
          if (!cancelled && deployed && deployed !== WEB_BUILD) setLatest({ build: deployed, web: true });
          return;
        }
        const res = await fetch(`/api/app-update?track=${encodeURIComponent(APP_TRACK)}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return;
        const manifest = parseUpdateManifest(await res.json());
        if (!cancelled && manifest) setLatest(manifest);
      } catch {
        /* fail-open: a failed check simply shows no banner */
      }
    };
    check();
    const interval = setInterval(check, APP_UPDATE_CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefocusRef.current < APP_UPDATE_REFOCUS_THROTTLE_MS) return;
      lastRefocusRef.current = now;
      check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [supported, isWeb, isDesktop]);

  if (!supported) return null;
  if (isWeb || isDesktop ? !latest : !isUpdateAvailable(APP_BUILD, latest)) return null;
  // Web ids are opaque strings, so dismissal is an equality check rather than "<=".
  if (isWeb || isDesktop ? String(dismissed) === String(latest.build) : latest.build <= dismissed) return null;

  const onUpdate = async () => {
    if (isDesktop) {
      // Hands the installer to the player's browser. Downloading it inside the app
      // would leave them with a file and no idea where it went.
      setUpdating(true);
      window.ohDesktop.download(latest.url);
      return;
    }
    if (isWeb) {
      setUpdating(true);
      // Bundle filenames are content-hashed, so re-fetching the shell is all it takes
      // to land on the new code. Ask the service worker to update first: it caches
      // nothing (it passes every request through), but an old registration can still
      // be the controller for this page.
      //
      // Deliberately NOT clearing Cache Storage. The big map archives live there
      // (open-historia-preload-*, ~160MB of PMTiles); wiping them would turn a code
      // update into a full map re-download, which is exactly what that cache exists to
      // avoid. Nothing in it is version-specific. Best-effort: never block the reload.
      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
        }
      } catch {
        /* ignore — reload anyway */
      }
      window.location.reload();
      return;
    }
    if (!latest.apk) return;
    setUpdating(true);
    // Downloads the new APK; Android then prompts to install it and reopen the app.
    window.location.href = latest.apk;
  };
  const onDismiss = () => {
    setDismissed(latest.build);
    try {
      localStorage.setItem(DISMISS_KEY, String(latest.build));
    } catch {
      /* ignore: dismissal just won't persist across launches */
    }
  };

  return (
    <div style={bar} role="status" aria-live="polite">
      <div style={text}>
        A new version of Open Historia is ready.
        <span style={sub}>
          {isWeb
            ? (updating ? "Reloading…" : "Reload to get the latest fixes. Your games are saved.")
            : updating
              ? "Downloading… open the finished download to install and reopen."
              : latest.notes || `Build ${latest.build} · tap Update to download and install.`}
        </span>
      </div>
      {isWeb || isDesktop || latest.apk ? (
        <button type="button" style={btn} onClick={onUpdate} disabled={updating}>
          {updating ? (isWeb ? "Reloading…" : "Downloading…") : "Update now"}
        </button>
      ) : null}
      <button type="button" style={dismissBtn} onClick={onDismiss} aria-label="Dismiss update notice">
        ×
      </button>
    </div>
  );
}
