/*! Open Historia — the person-and-workshop update: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the workshop banners are dressed (Workshop.jsx): an inventor's study at
// night, walnut and parchment, brass fittings, red sealing wax, a draughtsman's
// serif hand.

export const WORKSHOP_WALNUT = "#17130e";
export const WORKSHOP_BOARD = "#201a12";
export const WORKSHOP_PARCHMENT = "#efe3c8";
export const WORKSHOP_BRASS = "#d2a54a";
export const WORKSHOP_WAX = "#b8463a";
export const WORKSHOP_LEAF = "#86b06a";
export const WORKSHOP_SERIF = "Georgia, \"Times New Roman\", serif";

export const WORKSHOP_CHROME = Object.freeze({
  button: {
    background: WORKSHOP_BRASS,
    border: `1px solid ${WORKSHOP_BRASS}`,
    borderRadius: "6px",
    color: WORKSHOP_WALNUT,
    fontFamily: WORKSHOP_SERIF,
    fontWeight: 700,
    letterSpacing: "0.04em",
  },
  arrow: {
    background: "rgba(210,165,74,0.08)",
    border: `1px solid ${WORKSHOP_BRASS}`,
    color: WORKSHOP_BRASS,
  },
  dot: { on: WORKSHOP_WAX, off: "rgba(239,227,200,0.28)", radius: "2px" },
  skip: { color: WORKSHOP_PARCHMENT, fontFamily: WORKSHOP_SERIF, fontStyle: "italic" },
});
