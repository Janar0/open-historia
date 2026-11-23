/*! Open Historia — the person-and-workshop update: its banners behind the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Two pages for one update: playing one person instead of a government, and
// inventions that wait on what they are made of. An inventor's study at night:
// walnut, parchment, brass, red wax and a draughtsman's serif hand.
//
//   scene "portrait"   a cameo of the one you play, a quill signing the name
//                      beneath it, a wax seal pressed on the corner. Touch the
//                      seal and it is pressed again.
//   scene "blueprint"  a cart drawn on the board line by line, a gear turning in
//                      the corner, and three tags hung from a string: what the
//                      cart needs. The rubber is missing and the wheels stand
//                      still; touch its tag to secure it, and they turn.
//
// Flat shapes only: nothing is a gradient, nothing purple. With Reduce motion
// everything is drawn where it ends, and the tags still answer a touch.

import React, { useState } from "react";

import { Brackets, FeatureCards, ICONS, Plate, Reveal, Rule, forever, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import {
  WORKSHOP_BOARD,
  WORKSHOP_BRASS,
  WORKSHOP_LEAF,
  WORKSHOP_PARCHMENT,
  WORKSHOP_SERIF,
  WORKSHOP_WALNUT,
  WORKSHOP_WAX,
} from "./workshopChrome.js";

const PARCHMENT_SOFT = "rgba(239,227,200,0.74)";
const LINE = "rgba(239,227,200,0.82)";
const GRID = "rgba(239,227,200,0.07)";

// A line that draws itself, `length` long, after `delay` ms.
const drawn = (still, length, ms, delay) => (still
  ? {}
  : { strokeDasharray: length, "--oh-upd-length": length, ...motion(still, "ohUpdDraw", ms, delay, "cubic-bezier(0.4, 0, 0.2, 1)") });

// The faint squares of a drafting board.
const Grid = () => (
  <g aria-hidden="true">
    {Array.from({ length: 21 }, (_, i) => <line key={`v${i}`} stroke={GRID} strokeWidth="1" x1={i * 40} x2={i * 40} y1="0" y2="240" />)}
    {Array.from({ length: 7 }, (_, i) => <line key={`h${i}`} stroke={GRID} strokeWidth="1" x1="0" x2="800" y1={i * 40} y2={i * 40} />)}
  </g>
);

// A brass gear's outline, teeth and all, as one path: the kit turns every part
// of a theme's svg about its own middle (.oh-upd-svg), so a tooth placed with a
// transform of its own would be thrown off the wheel.
const gearPath = (cx, cy, r, teeth = 12) => {
  const outer = r * 1.18;
  const points = [];
  for (let i = 0; i < teeth; i += 1) {
    const step = (Math.PI * 2) / teeth;
    const at = i * step;
    for (const [angle, radius] of [[at, r], [at + step * 0.15, outer], [at + step * 0.45, outer], [at + step * 0.6, r]]) {
      points.push(`${(cx + Math.cos(angle) * radius).toFixed(1)} ${(cy + Math.sin(angle) * radius).toFixed(1)}`);
    }
  }
  return `M${points.join(" L")} Z`;
};

// A brass gear, turning slowly.
const Gear = ({ cx, cy, r, still, ms = 14000, reverse = false }) => (
  <g style={still ? null : { ...forever(still, "ohUpdSpin", ms, 0), animationDirection: reverse ? "reverse" : "normal" }}>
    <path d={gearPath(cx, cy, r)} fill={WORKSHOP_BRASS} />
    <circle cx={cx} cy={cy} fill={WORKSHOP_BOARD} r={r * 0.42} />
    <circle cx={cx} cy={cy} fill={WORKSHOP_BRASS} r={r * 0.14} />
  </g>
);

// A wheel of the cart: rim, hub and spokes; turning once the cart can roll.
const Wheel = ({ cx, cy, rolling, still }) => (
  <g style={rolling && !still ? { ...forever(still, "ohUpdSpin", 1600, 0), transformBox: "fill-box", transformOrigin: "center" } : null}>
    <circle cx={cx} cy={cy} fill="none" r="34" stroke={rolling ? WORKSHOP_PARCHMENT : LINE} strokeWidth={rolling ? 6 : 2.5} />
    <circle cx={cx} cy={cy} fill={LINE} r="5" />
    {/* Each spoke by its own ends: a transform of its own would be turned about its middle by the kit. */}
    {[0, 45, 90, 135].map((angle) => {
      const dx = Math.cos((angle * Math.PI) / 180) * 30;
      const dy = Math.sin((angle * Math.PI) / 180) * 30;
      return <line key={angle} stroke={LINE} strokeWidth="2" x1={cx - dx} x2={cx + dx} y1={cy - dy} y2={cy + dy} />;
    })}
  </g>
);

// What the cart needs, hung from a string. Rubber starts missing.
const TAGS = [
  { id: "rubber", label: "Rubber", startsSecured: false },
  { id: "steel", label: "Steel", startsSecured: true },
  { id: "smith", label: "Smith", startsSecured: true },
];

const Tag = ({ tag, secured, onSecure, still, at }) => {
  const colour = secured ? WORKSHOP_LEAF : WORKSHOP_WAX;
  const press = () => { if (!secured) onSecure(); };
  return (
    <div style={{ "--oh-upd-tilt": "-4deg", transformOrigin: "top center", ...(still ? null : forever(still, "ohUpdSway", 3600 + at * 500, at * -900, "cubic-bezier(0.45, 0, 0.55, 1)")) }}>
      <div aria-hidden="true" style={{ background: LINE, height: "0.9rem", margin: "0 auto", width: "1px" }} />
      <button
        aria-label={secured ? `${tag.label} is secured` : `Secure the ${tag.label.toLowerCase()}`}
        className="oh-tap"
        onClick={press}
        style={{
          alignItems: "center",
          background: WORKSHOP_PARCHMENT,
          border: `2px solid ${colour}`,
          borderRadius: "4px 4px 10px 10px",
          color: WORKSHOP_WALNUT,
          cursor: secured ? "default" : "pointer",
          display: "flex",
          flexDirection: "column",
          fontFamily: WORKSHOP_SERIF,
          fontSize: "0.78rem",
          gap: "0.1rem",
          minWidth: "4.6rem",
          padding: "0.35rem 0.55rem 0.45rem",
          touchAction: "manipulation",
        }}
        type="button"
      >
        <span aria-hidden="true" style={{ background: WORKSHOP_BOARD, borderRadius: "50%", height: "0.4rem", width: "0.4rem" }} />
        <span style={{ fontWeight: 700 }}>{tag.label}</span>
        <span key={secured ? "y" : "n"} style={{ color: colour, fontSize: "0.95rem", fontWeight: 900, ...motion(still, "ohUpdStamp", 420, 0) }}>{secured ? "✓" : "✕"}</span>
      </button>
    </div>
  );
};

const Blueprint = ({ still, narrow }) => {
  const [secured, setSecured] = useState(() => new Set(TAGS.filter((tag) => tag.startsSecured).map((tag) => tag.id)));
  const rolling = secured.size === TAGS.length;
  return (
    <div style={{ background: WORKSHOP_BOARD, borderBottom: "1px solid rgba(210,165,74,0.3)", height: narrow ? "12.5rem" : "clamp(13rem, 28vw, 17rem)", overflow: "hidden", position: "relative" }}>
      <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ height: "100%", inset: 0, position: "absolute", width: "100%" }} viewBox="0 0 800 240">
        <Grid />
        {/* The cart, drawn on the board line by line. */}
        <g fill="none" stroke={LINE} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5">
          <path d="M150 150 L150 108 L250 108 L282 80 L392 80 L410 108 L470 108 L470 150 Z" style={drawn(still, 900, 1600, 250)} />
          <path d="M262 108 L286 86 L330 86 L330 108" style={drawn(still, 200, 700, 1200)} />
          <path d="M340 86 L386 86 L398 108 L340 108 Z" style={drawn(still, 200, 700, 1400)} />
          <path d="M470 128 L494 128 L494 116" style={drawn(still, 80, 500, 1700)} />
          <path d="M120 186 L500 186" strokeDasharray="6 7" strokeWidth="1.5" opacity="0.5" />
          <path d="M150 196 L150 210 M470 196 L470 210 M150 204 L470 204" strokeWidth="1.2" opacity="0.6" />
        </g>
        <text fill={PARCHMENT_SOFT} fontFamily={WORKSHOP_SERIF} fontSize="12" fontStyle="italic" textAnchor="middle" x="310" y="226">3.2 m</text>
        <Wheel cx={200} cy={152} rolling={rolling} still={still} />
        <Wheel cx={420} cy={152} rolling={rolling} still={still} />
        {/* The workings in the corner. */}
        {/* Below the hanging tags, clear of them at any width. */}
        <Gear cx={728} cy={150} r={26} still={still} />
        <Gear cx={684} cy={194} r={15} still={still} ms={9000} reverse />
        <text fill={WORKSHOP_BRASS} fontFamily={WORKSHOP_SERIF} fontSize="14" fontStyle="italic" x="512" y="222">Self-propelled cart, sheet 1</text>
      </svg>
      <div style={{ display: "flex", gap: narrow ? "0.35rem" : "0.6rem", position: "absolute", right: narrow ? "0.6rem" : "1.2rem", top: "0.4rem" }}>
        {TAGS.map((tag, at) => (
          <Tag
            at={at}
            key={tag.id}
            onSecure={() => setSecured((previous) => new Set([...previous, tag.id]))}
            secured={secured.has(tag.id)}
            still={still}
            tag={tag}
          />
        ))}
      </div>
      <div style={{ bottom: "0.55rem", color: PARCHMENT_SOFT, fontFamily: WORKSHOP_SERIF, fontSize: "0.76rem", fontStyle: "italic", left: "0.9rem", pointerEvents: "none", position: "absolute" }}>
        {rolling ? "Secured. Now it rolls." : "Touch the rubber"}
      </div>
    </div>
  );
};

// The cameo of the one you play, signed and sealed.
const Portrait = ({ still, narrow }) => {
  const [pressed, setPressed] = useState(0);
  return (
    <div style={{ background: WORKSHOP_BOARD, borderBottom: "1px solid rgba(210,165,74,0.3)", height: narrow ? "12.5rem" : "clamp(13rem, 28vw, 17rem)", overflow: "hidden", position: "relative" }}>
      <svg aria-hidden="true" className="oh-upd-svg" preserveAspectRatio="xMidYMid slice" style={{ height: "100%", inset: 0, position: "absolute", width: "100%" }} viewBox="0 0 800 240">
        <Grid />
        {/* The oval frame and its brass rim. */}
        <ellipse cx="400" cy="112" fill="none" rx="78" ry="96" stroke={WORKSHOP_BRASS} strokeWidth="5" style={drawn(still, 560, 1400, 200)} />
        <ellipse cx="400" cy="112" fill={WORKSHOP_WALNUT} rx="70" ry="88" style={motion(still, "ohUpdFade", 900, 500)} />
        {/* A girl's head and shoulders, in profile, with a small crown. */}
        <g fill={WORKSHOP_PARCHMENT} style={motion(still, "ohUpdRise", 900, 800)}>
          <path d="M352 196 C356 160 372 148 392 144 C380 136 372 120 374 102 C376 80 394 66 414 68 C436 70 448 88 446 108 C452 112 452 118 446 120 C446 132 438 142 426 146 C444 152 452 170 452 196 Z" />
          <path d="M376 72 L384 52 L396 66 L404 46 L412 66 L424 52 L428 74 Z" fill={WORKSHOP_BRASS} />
        </g>
        {/* Laurel around the frame. */}
        <g fill="none" stroke={WORKSHOP_LEAF} strokeLinecap="round" strokeWidth="2.5" style={motion(still, "ohUpdFade", 900, 1300)}>
          {[0, 1, 2, 3, 4].map((leaf) => (
            <path d={`M${300 - leaf * 2} ${190 - leaf * 26} q-18 -6 -14 -22`} key={`l${leaf}`} />
          ))}
          {[0, 1, 2, 3, 4].map((leaf) => (
            <path d={`M${500 + leaf * 2} ${190 - leaf * 26} q18 -6 14 -22`} key={`r${leaf}`} />
          ))}
        </g>
        {/* The quill signing beneath it. */}
        <path d="M250 222 C280 206 300 232 330 214 C352 202 360 226 392 212 C420 200 432 226 470 210 C500 198 512 220 548 208" fill="none" stroke={LINE} strokeLinecap="round" strokeWidth="2.2" style={drawn(still, 400, 1800, 1500)} />
        <g style={still ? null : forever(still, "ohUpdBob", 2600, 0, "cubic-bezier(0.45, 0, 0.55, 1)")}>
          <path d="M560 206 L640 120 C652 108 668 112 662 126 L578 214 Z" fill={WORKSHOP_PARCHMENT} opacity="0.9" />
          <path d="M560 206 L574 194" stroke={WORKSHOP_WALNUT} strokeWidth="3" />
        </g>
      </svg>
      <button
        aria-label="Press the seal"
        className="oh-tap"
        key={pressed}
        onClick={() => setPressed((count) => count + 1)}
        style={{
          alignItems: "center",
          background: WORKSHOP_WAX,
          border: "3px solid rgba(23,19,14,0.35)",
          borderRadius: "50%",
          bottom: narrow ? "0.8rem" : "1.2rem",
          color: WORKSHOP_PARCHMENT,
          cursor: "pointer",
          display: "flex",
          fontFamily: WORKSHOP_SERIF,
          fontSize: narrow ? "1.3rem" : "1.6rem",
          fontWeight: 900,
          height: narrow ? "3.2rem" : "4rem",
          justifyContent: "center",
          left: narrow ? "0.9rem" : "2rem",
          position: "absolute",
          touchAction: "manipulation",
          width: narrow ? "3.2rem" : "4rem",
          ...motion(still, "ohUpdStamp", 520, pressed ? 0 : 2100),
        }}
        type="button"
      >
        {"\u{1F3AD}"}
      </button>
    </div>
  );
};

const Workshop = ({ banner, update }) => {
  const still = useStill();
  const narrow = useNarrow();
  const blueprint = banner.scene === "blueprint";
  return (
    <Plate surface={{ background: WORKSHOP_WALNUT, border: "1px solid rgba(210,165,74,0.35)", borderRadius: "10px" }}>
      <Brackets colour={WORKSHOP_BRASS} inset="0.7rem" length="1.6rem" thickness={1.5} />
      <Reveal delay={100}>
        {blueprint ? <Blueprint narrow={narrow} still={still} /> : <Portrait narrow={narrow} still={still} />}
      </Reveal>
      <div style={{ padding: narrow ? "1.2rem 1.1rem 1.3rem" : "1.5rem 2rem 1.7rem" }}>
        <Reveal delay={300}>
          <div style={{ color: WORKSHOP_BRASS, fontFamily: WORKSHOP_SERIF, fontSize: "0.78rem", fontVariant: "small-caps", letterSpacing: "0.16em" }}>
            Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
          </div>
          <div style={{ color: WORKSHOP_PARCHMENT, fontFamily: WORKSHOP_SERIF, fontSize: narrow ? "2.1rem" : "clamp(2.3rem, 6vw, 3.2rem)", fontWeight: 700, lineHeight: 1.05, marginTop: "0.2rem" }}>{banner.title}</div>
          {banner.subtitle && <div style={{ color: WORKSHOP_BRASS, fontFamily: WORKSHOP_SERIF, fontSize: "1.05rem", fontStyle: "italic", marginTop: "0.25rem" }}>{banner.subtitle}</div>}
        </Reveal>
        {banner.lead && (
          <Reveal delay={420}>
            <p style={{ color: PARCHMENT_SOFT, fontFamily: WORKSHOP_SERIF, fontSize: "1rem", lineHeight: 1.6, margin: "0.9rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={WORKSHOP_BRASS}>
          <span style={{ color: WORKSHOP_WAX, display: "inline-flex" }}>{(blueprint ? ICONS.gear : ICONS.people)(18)}</span>
        </Rule>
        <FeatureCards
          accent={WORKSHOP_BRASS}
          caps={false}
          card={{ background: "rgba(239,227,200,0.04)", border: "1px solid rgba(210,165,74,0.22)", borderRadius: "8px" }}
          delay={520}
          font={WORKSHOP_SERIF}
          sections={banner.sections ?? []}
          soft={PARCHMENT_SOFT}
        />
      </div>
    </Plate>
  );
};

export default Workshop;
