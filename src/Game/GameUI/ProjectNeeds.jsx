/*! Open Historia — a project card's needs: what it lacks, where it comes from, what holds it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a project needs and does not have (runtime/projectNeeds.js), on its card
// in the Projects board: one chip per need, coloured by how it stands, with
// where it comes from on hover, and a line saying what holds the entry when
// something does. Nothing here is the model's word alone: the hold is the
// engine's, the same one that caps the progress bar above it.
import React from "react";
import { NEED_CAPS, holdingNeed, needsCap, normalizeProjectNeeds } from "../../runtime/projectNeeds.js";

// Red, amber, green: the board's own warning colours (projects.jsx Pill), and
// never a gradient.
const TONES = {
  missing: { color: "#fca5a5", background: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.38)", mark: "✕" },
  partial: { color: "#fcd34d", background: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.36)", mark: "◐" },
  secured: { color: "#86efac", background: "rgba(34,197,94,0.13)", border: "rgba(34,197,94,0.34)", mark: "✓" },
};

const STATUS_LABELS = { missing: "Missing", partial: "Not enough", secured: "Secured" };

export const ProjectNeeds = ({ project }) => {
  const needs = normalizeProjectNeeds(project?.needs);
  if (!needs.length) return null;
  const blocker = project?.status === "complete" ? null : holdingNeed(needs);
  const cap = needsCap(needs);

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "0.25rem", textTransform: "uppercase" }}>
        Needs
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {needs.map((need) => {
          const tone = TONES[need.status] ?? TONES.missing;
          return (
            <span
              key={need.name}
              title={[STATUS_LABELS[need.status], need.source, need.note].filter(Boolean).join(" — ")}
              style={{
                alignItems: "center",
                background: tone.background,
                border: `1px solid ${tone.border}`,
                borderRadius: "999px",
                color: tone.color,
                display: "inline-flex",
                fontSize: "0.66rem",
                gap: "0.3rem",
                maxWidth: "100%",
                padding: "0.12rem 0.5rem",
              }}
            >
              <span aria-hidden="true">{tone.mark}</span>
              <span data-no-translate style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{need.name}</span>
              {need.source && (
                <span data-no-translate style={{ color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  · {need.source}
                </span>
              )}
            </span>
          );
        })}
      </div>
      {blocker && (
        <div style={{ color: TONES[blocker.status]?.color ?? TONES.missing.color, fontSize: "0.68rem", marginTop: "0.35rem" }}>
          <span aria-hidden="true">⛔ </span>
          <span>{cap === NEED_CAPS.missing ? "Held at 70% and cannot be finished without:" : "Held at 90% and cannot be finished without enough:"}</span>
          {" "}
          <span data-no-translate style={{ fontWeight: 700 }}>{blocker.name}</span>
        </div>
      )}
    </div>
  );
};

export default ProjectNeeds;
