/*! Open Historia — portions (mobile HUD wiring + advisor/forces launchers) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { SettingsButton, SettingsMenu } from "./settings";
import { LibraryTopBar, TOP_BAR_OFFSET } from "./libraryBar";
import { useLibraryState } from "../../runtime/library.js";
import { DateWidget } from "./time";
import { Other } from "./other";
import { Toolbar } from "./chat";
import { Search } from "./search";
import { ForcesPanel } from "./forces";
import { MarkersPanel } from "./markers";
import { ReservesPanel } from "./reserves";
import {
  getStoredProvider,
  loadProviderSettingsFormState,
  normalizeProvider,
  persistProviderSetting,
} from "../AI/providerConfig.js";

// The advisor drawer is user-resizable — drag its left edge (see advisor.jsx).
// Width is kept in px so the drag maps 1:1 to the pointer, persisted in
// localStorage, and clamped to a readable min and the current viewport.
const ADVISOR_MIN_WIDTH = 280;
const ADVISOR_DEFAULT_WIDTH = 320; // 20rem, the old fixed width
const clampAdvisorWidth = (px) => {
  const max = (typeof window !== "undefined" ? window.innerWidth : 1280) - 16;
  return Math.round(Math.min(Math.max(px, Math.min(ADVISOR_MIN_WIDTH, max)), max));
};
const readAdvisorWidth = () => {
  try {
    const saved = Number(localStorage.getItem("oh-advisor-width"));
    if (Number.isFinite(saved) && saved > 0) return clampAdvisorWidth(saved);
  } catch { /* private-mode storage — fall through to default */ }
  return clampAdvisorWidth(ADVISOR_DEFAULT_WIDTH);
};
const baseStyle = {
  position: "fixed",
  backgroundColor: "rgba(8, 15, 27, 0.94)",
  backdropFilter: "blur(10px) saturate(1.15)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "white",
  fontFamily: "sans-serif",
  borderRadius: "12px",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  boxShadow: "0 10px 28px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const hudChromeStyle = {
  position: "fixed",
  left: 0,
  right: 0,
  pointerEvents: "none",
  zIndex: 9990,
};

const HudChrome = () => (
  <>
    <div
      aria-hidden="true"
      style={{
        ...hudChromeStyle,
        top: 0,
        height: "5.75rem",
        background: "linear-gradient(180deg, rgba(2, 6, 14, 0.78), rgba(2, 6, 14, 0.18) 72%, transparent)",
        borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
      }}
    />
    <div
      aria-hidden="true"
      style={{
        ...hudChromeStyle,
        bottom: 0,
        height: "5.5rem",
        background: "linear-gradient(0deg, rgba(2, 6, 14, 0.64), transparent 76%)",
      }}
    />
  </>
);
const LazyAdvisorPanel = lazy(() =>
  import("./advisor").then((module) => ({ default: module.AdvisorPanel })),
);
const LazyCheatsPanel = lazy(() =>
  import("./cheats").then((module) => ({ default: module.CheatsPanel })),
);

const checkWebGL = () => {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
};

const WebGLWarningPopup = () => (
  <div
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="webgl-warning-title"
    style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    }}
  >
    <div
      style={{
        backgroundColor: "#1a1a2e",
        border: "1px solid #e94560",
        borderRadius: "12px",
        padding: "2rem",
        maxWidth: "420px",
        width: "90%",
        color: "#eaeaea",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "3rem",
          marginBottom: "0.75rem",
          color: "#e94560",
          display: "flex",
          justifyContent: "center",
        }}
      >
        ⚠️
      </div>
      <h2 id="webgl-warning-title" style={{ margin: "0 0 0.75rem", fontSize: "1.3rem", color: "#e94560" }}>
        WebGL Not Available
      </h2>
      <p style={{ margin: "0 0 0.5rem", lineHeight: 1.6, color: "#ccc", fontSize: "0.95rem" }}>
        This application requires <strong style={{ color: "#eaeaea" }}>WebGL</strong> to render
        the map, but it doesn't appear to be supported or enabled in your browser.
      </p>
      <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6, color: "#999", fontSize: "0.85rem" }}>
        Try enabling hardware acceleration in your browser settings, updating your graphics
        drivers, or switching to a WebGL-supported browser such as Chrome or Firefox.
      </p>
    </div>
  </div>
);

const AdvisorButton = ({ isAdvisorOpen, rightShift, onToggle }) => (
  <button
    type="button"
    aria-label={isAdvisorOpen ? "Close strategic advisor" : "Open strategic advisor"}
    aria-pressed={isAdvisorOpen}
    title={isAdvisorOpen ? "Close strategic advisor" : "Open strategic advisor"}
    onClick={onToggle}
    style={{
    ...baseStyle,
    bottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))", right: rightShift,
    height: "4rem", width: "4rem",
    cursor: "pointer", fontSize: "1.5rem",
    transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
  }}
  >
    <span aria-hidden="true">🧭</span>
  </button>
);

const Main = ({
  mapRef,
  isGlobeEnabled,
  isTerrainEnabled,
  setIsGlobeEnabled,
  setIsTerrainEnabled,
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCheatsOpen, setIsCheatsOpen] = useState(false);
  const [shouldLoadCheats, setShouldLoadCheats] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [advisorWidth, setAdvisorWidth] = useState(readAdvisorWidth);
  const [activeBottomPanel, setActiveBottomPanel] = useState(null);
  const [shouldLoadAdvisor, setShouldLoadAdvisor] = useState(false);
  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(false);
  const [showWebGLWarning, setShowWebGLWarning] = useState(false);

  const [apiProvider, setApiProvider] = useState(() => getStoredProvider());
  const [providerSettings, setProviderSettings] = useState(() => loadProviderSettingsFormState());
  const { games, loaded } = useLibraryState();
  // No games -> nothing to simulate (the main menu covers the empty world).
  const hasNoGames = loaded && (games?.length ?? 0) === 0;

  useEffect(() => {
    if (!checkWebGL()) setShowWebGLWarning(true);
  }, []);

  // Idle diplomacy drip: each real-world minute the game is open (and has a
  // running game), there is a small chance a polity messages the player's
  // inbox unprompted. Everything that could break it is guarded inside
  // maybeSendIdleDiplomacy — it skips entirely while a time skip, game-master
  // command, or catalyst stage is in flight, never overlaps itself, and stays
  // silent on any failure. Hidden tabs don't roll the dice.
  useEffect(() => {
    if (hasNoGames) return undefined;
    const iv = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      import("../AI/gameplay.js")
        .then(({ maybeSendIdleDiplomacy }) => maybeSendIdleDiplomacy())
        .catch(() => {});
    }, 60000);
    return () => clearInterval(iv);
  }, [hasNoGames]);

  useEffect(() => {
    if (isAdvisorOpen) setShouldLoadAdvisor(true);
  }, [isAdvisorOpen]);

  useEffect(() => {
    localStorage.setItem("Fullscreen", JSON.stringify(isFullscreenEnabled));
  }, [isFullscreenEnabled]);

  useEffect(() => {
    localStorage.setItem("api_provider", normalizeProvider(apiProvider));
  }, [apiProvider]);

  useEffect(() => {
    if (isSettingsOpen) {
      setApiProvider(getStoredProvider());
      setProviderSettings(loadProviderSettingsFormState());
    }
  }, [isSettingsOpen]);

  const handleProviderSettingChange = (key, value) => {
    setProviderSettings((prev) => ({ ...prev, [key]: value }));
    persistProviderSetting(key, value);
  };

  const toggleFullscreen = (shouldBeFull) => {
    // Mobile Safari (iOS/iPad) exposes the Fullscreen API webkit-prefixed, and
    // iPhone Safari doesn't support element fullscreen at all — so probe for the
    // right methods and never call an undefined one (which threw before, so the
    // button silently failed on mobile).
    const el = document.documentElement;
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      if (shouldBeFull) {
        if (!fsElement && request) {
          const result = request.call(el);
          if (result && typeof result.catch === "function") {
            result.catch((error) => console.error("Error with fullscreen", error));
          }
        }
      } else if (fsElement && exit) {
        exit.call(document);
      }
    } catch (error) {
      console.error("Error with fullscreen", error);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreenEnabled(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const openAdvisor = useCallback(() => {
    setIsAdvisorOpen(true);
  }, []);

  // Called on every pointermove while the user drags the advisor's edge.
  const handleAdvisorResize = useCallback((px) => {
    setAdvisorWidth(() => {
      const w = clampAdvisorWidth(px);
      try { localStorage.setItem("oh-advisor-width", String(w)); } catch { /* ignore */ }
      return w;
    });
  }, []);

  // Keep the saved width valid if the window shrinks below it.
  useEffect(() => {
    const onResize = () => setAdvisorWidth((w) => clampAdvisorWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const rightShift = isAdvisorOpen ? `calc(${advisorWidth}px + 0.5rem)` : "0.5rem";
  const toggleBottomPanel = useCallback((panelName) => {
    setActiveBottomPanel((currentPanel) => (
      currentPanel === panelName ? null : panelName
    ));
  }, []);

  return (
    <>
      <HudChrome />
      {showWebGLWarning && <WebGLWarningPopup />}
      <div role="group" aria-label="Game navigation and timeline" style={{ display: "contents" }}>
        <LibraryTopBar />
        <DateWidget
          activePanel={activeBottomPanel}
          mapRef={mapRef}
          onSetPanel={setActiveBottomPanel}
          onTogglePanel={toggleBottomPanel}
          rightShift={rightShift}
          topOffset={TOP_BAR_OFFSET}
        />
      </div>
      <div role="group" aria-label="Game actions" style={{ display: "contents" }}>
        <Toolbar
          onOpenAdvisor={openAdvisor}
          activePanel={activeBottomPanel}
          onTogglePanel={toggleBottomPanel}
        />
      </div>
      <Other rightShift={rightShift} />
      <Search mapRef={mapRef} />
      <ForcesPanel
        mapRef={mapRef}
        topOffset={TOP_BAR_OFFSET}
        open={activeBottomPanel === "forces"}
        onToggle={() => toggleBottomPanel("forces")}
      />
      <MarkersPanel
        mapRef={mapRef}
        open={activeBottomPanel === "markers"}
        onToggle={() => toggleBottomPanel("markers")}
      />
      <ReservesPanel
        open={activeBottomPanel === "reserves"}
        onToggle={() => toggleBottomPanel("reserves")}
      />
      <AdvisorButton
        isAdvisorOpen={isAdvisorOpen}
        rightShift={rightShift}
        onToggle={() => setIsAdvisorOpen(!isAdvisorOpen)}
      />
      <Suspense fallback={null}>
        {shouldLoadAdvisor && (
          <LazyAdvisorPanel isAdvisorOpen={isAdvisorOpen} onClose={() => setIsAdvisorOpen(false)} width={advisorWidth} onResize={handleAdvisorResize} />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {shouldLoadCheats && (
          <LazyCheatsPanel open={isCheatsOpen} onClose={() => setIsCheatsOpen(false)} onOpenForces={() => { setIsCheatsOpen(false); setActiveBottomPanel("forces"); }} />
        )}
      </Suspense>
      <SettingsButton
        topOffset={TOP_BAR_OFFSET}
        isOpen={isSettingsOpen}
        onToggle={() => setIsSettingsOpen(!isSettingsOpen)}
      />
      {isSettingsOpen && (
        <SettingsMenu
          discordUrl="https://discord.gg/C3AVwHacZ4"
          redditUrl="https://www.reddit.com/r/OpenHistoria"
          githubUrl="https://github.com/Open-Historia/open-historia"
          onOpenCheats={() => {
            setShouldLoadCheats(true);
            setIsCheatsOpen(true);
            setIsSettingsOpen(false);
          }}
          topOffset={TOP_BAR_OFFSET}
          isFullscreenEnabled={isFullscreenEnabled}
          isGlobeEnabled={isGlobeEnabled}
          isTerrainEnabled={isTerrainEnabled}
          onToggleFullscreen={() => {
            const newState = !isFullscreenEnabled;
            setIsFullscreenEnabled(newState);
            toggleFullscreen(newState);
          }}
          onToggleGlobe={() => setIsGlobeEnabled(!isGlobeEnabled)}
          onToggleTerrain={() => setIsTerrainEnabled(!isTerrainEnabled)}
          apiProvider={apiProvider}
          onApiProviderChange={setApiProvider}
          providerSettings={providerSettings}
          onProviderSettingChange={handleProviderSettingChange}
        />
      )}
    </>
  );
};

export default Main;
