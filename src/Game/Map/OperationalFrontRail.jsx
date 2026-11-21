/*! Open Historia — operational front command rail © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useMemo } from "react";
import { useWorldState } from "./useWorldState.js";

const TYPE_GLYPH = {
  infantry: "✚",
  armor: "◇",
  artillery: "⊕",
  air: "✈",
  naval: "⚓",
  garrison: "▦",
};

const TYPE_LABEL = {
  infantry: "INF",
  armor: "ARM",
  artillery: "ART",
  air: "AIR",
  naval: "NAV",
  garrison: "GAR",
};

const unitAccent = (unit, sector) => (
  String(unit?.ownerCode || "").toLowerCase() === String(sector?.ownerCode || "").toLowerCase()
    ? "#58d7c2"
    : "#ff7868"
);

const statusAccent = (status) => {
  const value = String(status || "").toLowerCase();
  if (value === "engaged" || value === "assault") return "#ff7868";
  if (value === "moving") return "#ffd166";
  if (value === "pending") return "#93c5fd";
  return "#a7b5c8";
};

const displayOwner = (value) => String(value || "Unknown force").replace(/\s+/g, " ").trim();

const cellControls = (sector) => (Array.isArray(sector?.cells) ? sector.cells : [])
  .map((cell) => Number(cell?.control))
  .filter(Number.isFinite)
  .map((value) => Math.round(value));

const RailUnit = ({ unit, sector }) => {
  const accent = unitAccent(unit, sector);
  const status = String(unit?.status || "ready").toUpperCase();
  const strength = Number.isFinite(Number(unit?.strength)) ? Math.round(Number(unit.strength)) : "—";
  const type = String(unit?.type || "infantry").toLowerCase();
  return (
    <div
      style={{
        alignItems: "center",
        background: "rgba(255,255,255,0.045)",
        border: "1px solid rgba(204, 220, 244, 0.12)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "3px",
        display: "flex",
        gap: "8px",
        minWidth: 0,
        padding: "6px 8px",
      }}
    >
      <span
        style={{
          alignItems: "center",
          background: "rgba(6, 14, 27, 0.86)",
          border: `1px solid ${accent}`,
          borderRadius: "2px",
          color: "#f8fafc",
          display: "inline-flex",
          flex: "0 0 29px",
          fontSize: "12px",
          fontWeight: 900,
          height: "23px",
          justifyContent: "center",
        }}
      >
        {TYPE_GLYPH[type] || "I"}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            color: "#f8fafc",
            display: "block",
            fontSize: "11px",
            fontWeight: 800,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {unit?.name || `${TYPE_LABEL[type] || "UNIT"} formation`}
        </span>
        <span
          style={{
            color: "rgba(226, 232, 240, 0.58)",
            display: "block",
            fontSize: "9px",
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {displayOwner(unit?.ownerCode)} · {TYPE_LABEL[type] || "UNIT"}
        </span>
      </span>
      <span style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "right" }}>
        <strong style={{ color: "#f8fafc", fontSize: "13px", lineHeight: 1 }}>{strength}</strong>
        <small style={{ color: statusAccent(unit?.status), fontSize: "8px", fontWeight: 800, letterSpacing: "0.06em", marginTop: "3px" }}>
          {status}
        </small>
      </span>
    </div>
  );
};

const SectorRail = ({ sector, units }) => {
  const controls = cellControls(sector);
  const sectorUnits = units
    .filter((unit) => String(unit?.sectorId || "") === String(sector?.id || ""))
    .filter((unit) => Number(unit?.strength) > 0)
    .sort((left, right) => Number(right?.strength || 0) - Number(left?.strength || 0));
  const control = Number.isFinite(Number(sector?.control)) ? Math.round(Number(sector.control)) : "—";
  return (
    <section style={{ borderTop: "1px solid rgba(204, 220, 244, 0.14)", marginTop: "8px", paddingTop: "8px" }}>
      <div style={{ alignItems: "baseline", display: "flex", gap: "7px", justifyContent: "space-between" }}>
        <strong style={{ color: "#f8fafc", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sector?.name || "Active sector"}
        </strong>
        <span style={{ color: "#ffb4a9", fontSize: "9px", fontWeight: 800, letterSpacing: "0.08em" }}>
          {String(sector?.status || "contested").toUpperCase()}
        </span>
      </div>
      <div style={{ color: "rgba(226, 232, 240, 0.62)", display: "flex", fontSize: "9px", justifyContent: "space-between", margin: "4px 0 6px", textTransform: "uppercase" }}>
        <span>{controls.length || sector?.cells?.length || 0} cells · control {control}%</span>
        <span>{sectorUnits.length} formations</span>
      </div>
      <div style={{ color: "rgba(159, 223, 255, 0.72)", display: "flex", fontSize: "8px", gap: "9px", letterSpacing: "0.08em", margin: "-1px 0 6px", textTransform: "uppercase" }}>
        <span>front {Number.isFinite(Number(sector?.frontWidthKm)) ? `${Math.round(Number(sector.frontWidthKm))} km` : "—"}</span>
        <span>depth {Number.isFinite(Number(sector?.advanceDepthKm)) ? `${Math.round(Number(sector.advanceDepthKm))} km` : "—"}</span>
      </div>
      <div style={{ alignItems: "center", color: "rgba(226, 232, 240, 0.62)", display: "flex", fontSize: "8px", justifyContent: "space-between", letterSpacing: "0.08em", margin: "-1px 0 7px", textTransform: "uppercase" }}>
        <span>Supply axis</span>
        <strong style={{ color: String(sector?.status || "").toLowerCase() === "encircled" ? "#ff7868" : "#55c6e8", fontSize: "8px" }}>
          {String(sector?.status || "").toLowerCase() === "encircled" ? "CUT" : "OPEN"}
        </strong>
      </div>
      <div style={{ display: "grid", gap: "4px" }}>
        {sectorUnits.length > 0
          ? sectorUnits.map((unit) => <RailUnit key={unit.id} unit={unit} sector={sector} />)
          : <span style={{ color: "rgba(226, 232, 240, 0.46)", fontSize: "10px" }}>No committed formations</span>}
      </div>
      {controls.length > 0 && (
        <div style={{ alignItems: "center", display: "flex", gap: "4px", marginTop: "7px" }}>
          <span style={{ color: "rgba(226, 232, 240, 0.5)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.08em" }}>CONTACT</span>
          {controls.map((value, index) => (
            <span key={`${sector.id}-control-${index}`} style={{ background: "rgba(157, 37, 38, 0.82)", border: "1px solid rgba(255, 184, 169, 0.48)", borderRadius: "3px", color: "#fff4f0", fontSize: "9px", fontWeight: 800, padding: "2px 4px" }}>
              {value}%
            </span>
          ))}
        </div>
      )}
      <div style={{ borderTop: "1px solid rgba(204, 220, 244, 0.1)", display: "flex", flexWrap: "wrap", gap: "5px 9px", marginTop: "8px", paddingTop: "7px" }}>
        {[
          ["#ff7868", "contact"],
          ["#38d8ff", "assault / supply"],
          ["#ffd166", "fire support"],
          ["#ff8e7d", "reserve"],
        ].map(([color, label]) => (
          <span key={label} style={{ alignItems: "center", color: "rgba(226, 232, 240, 0.58)", display: "inline-flex", fontSize: "8px", gap: "4px", textTransform: "uppercase" }}>
            <span style={{ background: color, borderRadius: "999px", display: "inline-block", height: "4px", width: "12px" }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
};

const OperationalFrontRail = () => {
  const { controlSectors, worldState } = useWorldState();
  const units = Array.isArray(worldState?.units) ? worldState.units : [];
  const activeSectors = useMemo(
    () => controlSectors.filter((sector) => {
      const status = String(sector?.status || "").toLowerCase();
      const contestedBy = Array.isArray(sector?.contestedBy)
        ? sector.contestedBy.length > 0
        : String(sector?.contestedBy || "").trim().length > 0;
      return status === "contested" || status === "assault" || contestedBy;
    }),
    [controlSectors],
  );
  if (activeSectors.length === 0) return null;
  const activeIds = new Set(activeSectors.map((sector) => String(sector.id)));
  const theaterUnits = units.filter((unit) => activeIds.has(String(unit?.sectorId || "")));
  const leadSector = activeSectors[0];
  const opponent = Array.isArray(leadSector?.contestedBy)
    ? leadSector.contestedBy[0]
    : leadSector?.contestedBy;

  return (
    <aside
      aria-label="Operational front command"
      style={{
        background: "linear-gradient(155deg, rgba(7, 15, 28, 0.94), rgba(5, 11, 22, 0.88))",
        border: "1px solid rgba(170, 198, 232, 0.22)",
        borderLeft: "3px solid #ff7868",
        borderRadius: "5px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.36)",
        color: "#f8fafc",
        left: "14px",
        maxHeight: "calc(100vh - 118px)",
        overflow: "hidden auto",
        padding: "11px 10px 10px",
        pointerEvents: "none",
        position: "absolute",
        top: "104px",
        width: "248px",
        zIndex: 6,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: "7px", justifyContent: "space-between" }}>
        <span style={{ color: "#9ed7ff", fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em" }}>THEATER COMMAND</span>
        <span style={{ color: "#ffb4a9", fontSize: "9px", fontWeight: 900 }}>LIVE</span>
      </div>
      <div style={{ color: "#f8fafc", fontSize: "15px", fontWeight: 900, letterSpacing: "-0.02em", marginTop: "5px" }}>
        ACTIVE FRONT
      </div>
      <div style={{ color: "rgba(226, 232, 240, 0.64)", fontSize: "9px", letterSpacing: "0.08em", marginTop: "2px", textTransform: "uppercase" }}>
        {displayOwner(leadSector?.ownerCode)}{opponent ? ` vs ${displayOwner(opponent)}` : ""} · {activeSectors.length} sector{activeSectors.length === 1 ? "" : "s"} · {theaterUnits.length} formations
      </div>
      {activeSectors.map((sector) => <SectorRail key={sector.id} sector={sector} units={units} />)}
    </aside>
  );
};

export default OperationalFrontRail;
