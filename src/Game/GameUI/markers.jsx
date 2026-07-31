/*! Open Historia — player map marker panel © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useState } from "react";
import { subscribeMarkerMode, getMarkerInteractionMode, setMarkerInteractionMode, clearMarkerInteractionMode, placePlayerMarker, removePlayerMarker } from "../Map/markersController.js";
import { useWorldState } from "../Map/useWorldState.js";

const surface = {
  backgroundColor: "rgba(17, 24, 39, 0.94)",
  backdropFilter: "blur(7px)",
  WebkitBackdropFilter: "blur(7px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  color: "white",
  fontFamily: "sans-serif",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(0,0,0,0.28)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "6px",
  padding: "6px 7px",
  fontSize: "12px",
};

const MarkersPanel = ({ mapRef, open = false, onToggle }) => {
  const { markers } = useWorldState();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("point");
  const [mode, setMode] = useState(getMarkerInteractionMode());

  useEffect(() => subscribeMarkerMode(setMode), []);

  const flyTo = useCallback((marker) => {
    const map = mapRef?.current?.getMap?.() ?? mapRef?.current;
    map?.flyTo?.({ center: [marker.lng, marker.lat], zoom: Math.max(map.getZoom?.() ?? 4, 5.5) });
  }, [mapRef]);

  const startPlacement = () => {
    const count = markers.filter((marker) => marker.source === "player").length;
    setMarkerInteractionMode({
      kind: "place",
      params: {
        name: name.trim() || `Point ${count + 1}`,
        kind,
      },
    });
    onToggle?.();
  };

  return (
    <>
      {mode.kind === "place" && (
        <div
          role="status"
          style={{
            ...surface,
            position: "fixed",
            top: "4.5rem",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 13px",
            fontSize: "13px",
          }}
        >
          <span>Click the map to place “{mode.params?.name || "Point"}”</span>
          <button
            type="button"
            onClick={clearMarkerInteractionMode}
            style={{ background: "rgba(220,70,70,0.25)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "white", cursor: "pointer", fontSize: "11px", padding: "3px 9px" }}
          >
            Cancel
          </button>
        </div>
      )}

      {open && (
        <div
          style={{
            ...surface,
            position: "fixed",
            bottom: "calc(4.75rem + env(safe-area-inset-bottom, 0px))",
            left: "0.5rem",
            width: "19rem",
            maxHeight: "68vh",
            display: "flex",
            flexDirection: "column",
            zIndex: 9999,
            padding: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "9px" }}>
            <strong style={{ fontSize: "14px" }}>Map markers</strong>
            <button type="button" aria-label="Close map markers" onClick={onToggle} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "14px" }}>✕</button>
          </div>

          <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "8px", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "6px" }}>Place a point for the AI to identify</div>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Temporary name (optional)" style={{ ...fieldStyle, marginBottom: "6px" }} />
            <div style={{ display: "flex", gap: "6px" }}>
              <select value={kind} onChange={(event) => setKind(event.target.value)} style={{ ...fieldStyle, flex: 1 }}>
                <option value="point" style={{ color: "black" }}>Unknown point</option>
                <option value="objective" style={{ color: "black" }}>Objective</option>
                <option value="front" style={{ color: "black" }}>Front / battle</option>
                <option value="supply" style={{ color: "black" }}>Supply point</option>
                <option value="base" style={{ color: "black" }}>Base / position</option>
              </select>
              <button type="button" onClick={startPlacement} style={{ background: "rgba(59,130,246,0.38)", border: "1px solid rgba(147,197,253,0.4)", borderRadius: "6px", color: "white", cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "0 9px", whiteSpace: "nowrap" }}>
                Place
              </button>
            </div>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "5px" }}>All markers ({markers.length})</div>
            {markers.length === 0 && <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>Nothing placed yet.</div>}
            {markers.map((marker) => (
              <div key={marker.id} style={{ display: "flex", alignItems: "center", gap: "7px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "7px", marginBottom: "5px" }}>
                <button type="button" onClick={() => flyTo(marker)} title="Show on map" style={{ flex: 1, minWidth: 0, background: "none", border: "none", color: "white", cursor: "pointer", textAlign: "left", padding: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{marker.name}</div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.52)" }}>{marker.kind} · {marker.status} · {marker.lat.toFixed(2)}, {marker.lng.toFixed(2)}</div>
                </button>
                {marker.source === "player" && (
                  <button type="button" aria-label={`Remove ${marker.name}`} onClick={() => removePlayerMarker(marker.id)} style={{ background: "rgba(220,70,70,0.18)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "5px", color: "#fca5a5", cursor: "pointer", fontSize: "12px", padding: "3px 5px" }}>×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export { MarkersPanel };
export default MarkersPanel;
