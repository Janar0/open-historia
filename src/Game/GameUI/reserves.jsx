/*! Open Historia — military reserves panel © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { readGameData } from "../../runtime/gameState.js";
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

const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";

const ReserveGroup = ({ title, values }) => {
  const entries = Object.entries(values || {});
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.48)", marginBottom: "5px" }}>{title}</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.38)" }}>No data reported</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 10px" }}>
          {entries.map(([key, value]) => (
            <React.Fragment key={key}>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.72)" }}>{key}</span>
              <strong style={{ fontSize: "11px", color: "#e5e7eb" }}>{number(value)}</strong>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

const IndustrySection = ({ title, records, valueField = "quantity", limit = 8 }) => {
  const visible = (records || []).slice(-limit).reverse();
  if (visible.length === 0) return null;
  return (
    <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.48)", marginBottom: "5px" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {visible.map((record) => (
          <div key={record.id || `${record.name}-${record.date || ""}`} style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "11px" }}>
            <span style={{ color: "rgba(255,255,255,0.72)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.name || record.item || record.id}</span>
            <strong style={{ color: "#e5e7eb", flexShrink: 0 }}>{record[valueField] ?? record.delta ?? record.progress ?? "—"}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReservesPanel = ({ open = false, onToggle }) => {
  const { worldState, militaryReserves, militaryIndustry } = useWorldState();
  const [playerCode, setPlayerCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    readGameData({ force: true }).then((game) => {
      if (!cancelled) setPlayerCode(game.country || "");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  const sheet = playerCode ? militaryReserves[playerCode] : null;
  const deployed = useMemo(() => {
    const groups = {};
    for (const unit of worldState?.units || []) groups[unit.type] = (groups[unit.type] || 0) + Number(unit.strength || 0);
    return groups;
  }, [worldState?.units]);
  const playerIndustry = useMemo(() => {
    const matches = (record) => !record?.ownerCode || !playerCode || String(record.ownerCode).toLowerCase() === String(playerCode).toLowerCase();
    return {
      arsenal: (militaryIndustry?.arsenal || []).filter(matches),
      research: (militaryIndustry?.research || []).filter(matches),
      production: (militaryIndustry?.production || []).filter(matches),
      ledger: (militaryIndustry?.ledger || []).filter(matches),
    };
  }, [militaryIndustry, playerCode]);

  if (!open) return null;

  return (
    <div style={{ ...surface, position: "fixed", bottom: "calc(4.75rem + env(safe-area-inset-bottom, 0px))", left: "0.5rem", width: "20rem", maxHeight: "68vh", overflowY: "auto", zIndex: 9999, padding: "13px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
        <strong style={{ fontSize: "14px" }}>Military reserves</strong>
        <button type="button" aria-label="Close military reserves" onClick={onToggle} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "14px" }}>✕</button>
      </div>
      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.48)", marginBottom: "11px" }}>{playerCode || "Player polity"}</div>

      {!sheet ? (
        <div style={{ padding: "12px 10px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.18)", color: "rgba(255,255,255,0.7)", fontSize: "12px", lineHeight: 1.45 }}>
          No reserve report has been generated yet. The AI will populate this panel after mobilisation, production, resupply, or a logistics event.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "12px" }}>
            {[['Manpower reserve', sheet.manpower], ['Committed', sheet.manpowerCommitted], ['Fuel', sheet.fuel], ['Supplies', sheet.supplies], ['Maintenance', sheet.maintenance], ['Deployed strength', Object.values(deployed).reduce((sum, value) => sum + value, 0)]].map(([label, value]) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.05)", borderRadius: "7px", padding: "7px" }}>
                <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.48)" }}>{label}</div>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "3px" }}>{number(value)}</strong>
              </div>
            ))}
          </div>
          <ReserveGroup title="Reserve equipment" values={sheet.equipment} />
          <ReserveGroup title="Munitions" values={sheet.munitions} />
          {sheet.note && <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.58)", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "8px" }}>{sheet.note}</div>}
          {sheet.updatedAt && <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", marginTop: "7px" }}>Updated {sheet.updatedAt}</div>}
        </>
      )}
      <IndustrySection title="Arsenal / unlocked systems" records={playerIndustry.arsenal} />
      <IndustrySection title="Research projects" records={playerIndustry.research} valueField="progress" />
      <IndustrySection title="Production lines" records={playerIndustry.production} valueField="rate" />
      <IndustrySection title="Recent industrial ledger" records={playerIndustry.ledger} valueField="delta" limit={6} />
    </div>
  );
};

export { ReservesPanel };
export default ReservesPanel;
