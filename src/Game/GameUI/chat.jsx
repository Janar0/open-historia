/*! Open Historia — portions (era diplomacy + mobile panel sizing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import ReactMarkdown from "react-markdown";
import { sendDiplomaticMessage, startDiplomaticChat, loadDiplomaticHistory } from "../AI/main.jsx";
import { chooseNextDiplomaticSpeaker, sendKeyFigureMessage } from "../AI/gameplay.js";
import { evaluateFigureMeeting, isFigureBrainActive, normalizeMeetingMode } from "../AI/figureRules.js";
import { Actions } from "./actions";
import {
    JSON_URLS,
    getNationColors,
    loadCountryNames as loadCachedCountryNames,
    readJson,
} from "../../runtime/assets.js";
import { flagEmojiFromGid } from "../../runtime/countryFlags.js";
import { readChatsState, readWorldState, writeChatsState, writeWorldState } from "../../runtime/gameState.js";
import { GameIcon } from "./Icon.jsx";
import { useDraggablePanel } from "./useDraggablePanel.js";

// ── Storage ───────────────────────────────────────────────────────────────────

const saveAllChats = async (chats) => {
    try {
        await writeChatsState(chats);
    } catch (err) { console.error("Failed to save chats:", err); }
};

const loadAllChats = async ({ force = false } = {}) => {
    try {
        return await readChatsState({ force });
    } catch { return []; }
};

const saveCountryDiplomaticMemory = async (country, memory) => {
    if (!country || !memory) return;
    try {
        const world = await readWorldState({ force: true });
        await writeWorldState({
            ...world,
            diplomaticMemory: {
                ...(world.diplomaticMemory ?? {}),
                [country]: memory,
            },
        });
    } catch (err) {
        console.error("Failed to save diplomatic memory:", err);
    }
};

// ── PMTiles country loader ────────────────────────────────────────────────────

const loadCountryNames = async () => {
    return loadCachedCountryNames();
};

const countryMatchesIdentity = (country, identity) => {
    const normalizedIdentity = String(identity ?? "").trim().toLowerCase();
    if (!normalizedIdentity) return false;
    return [country?.name, country?.code]
        .some(value => String(value ?? "").trim().toLowerCase() === normalizedIdentity);
};

// ── Flags ─────────────────────────────────────────────────────────────────────
// Flag emoji are derived locally from each nation's GID_0 country code. (The
// previous source, restcountries.com, deprecated its public API and no longer
// returns flag data.)

const FALLBACK_FLAG = "🏳";

const getCountryFlag = ({ code } = {}) => flagEmojiFromGid(code) ?? FALLBACK_FLAG;

const useCountryFlag = ({ code } = {}) =>
    useMemo(() => getCountryFlag({ code }), [code]);

const useCountryFlags = (countries) => {
    const depsKey = countries.map(c => `${c.name}:${c.code ?? ""}`).join(",");
    return useMemo(() => {
        const flags = {};
        for (const { name, code } of countries) flags[name] = getCountryFlag({ code });
        return flags;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depsKey]);
};

// ── Nation colors (from colors.json, same source as WorldMap) ─────────────────
const countryAccentColor = (name) => {
    const colors = ["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899"];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
};

// ── Nation colors ─────────────────────────────────────────────────────────────

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const nationColorFromCode = (code, map) => {
    if (!code) return null;
    if (map && map[code]) {
        const [r, g, b] = map[code];
        return `rgb(${r},${g},${b})`;
    }
    if (code.length >= 3) {
        const r = 64 + ALPHA.indexOf(code[0]) * 5;
        const g = 64 + ALPHA.indexOf(code[2]) * 5;
        const b = 64 + ALPHA.indexOf(code[1]) * 5;
        return `rgb(${r},${g},${b})`;
    }
    return null;
};

const useNationColor = (code) => {
    const [color, setColor] = useState(null);
    useEffect(() => {
        if (!code) return;
        let cancelled = false;
        getNationColors().then(map => {
            if (!cancelled) setColor(nationColorFromCode(code, map));
        });
            return () => { cancelled = true; };
    }, [code]);
    return color;
};

// ── Markdown styles ───────────────────────────────────────────────────────────

const markdownStyles = `
.chat-markdown p { margin: 0 0 0.5rem 0; }
.chat-markdown p:last-child { margin-bottom: 0; }
.chat-markdown ul, .chat-markdown ol { margin: 0.25rem 0 0.5rem 1.25rem; padding: 0; }
.chat-markdown li { margin-bottom: 0.2rem; }
.chat-markdown strong { color: rgba(255,255,255,0.95); }
.chat-markdown em { color: rgba(255,255,255,0.75); }
.chat-markdown blockquote { border-left: 2px solid rgba(139,92,246,0.6); margin: 0.5rem 0; padding-left: 0.75rem; color: rgba(255,255,255,0.6); }
`;

const MarkdownStyleInjector = () => {
    useEffect(() => {
        if (!document.getElementById("chat-md-styles")) {
            const style = document.createElement("style");
            style.id = "chat-md-styles";
            style.textContent = markdownStyles;
            document.head.appendChild(style);
        }
    }, []);
    return null;
};

// ── ThinkingDots ──────────────────────────────────────────────────────────────

const ThinkingDots = () => {
    const [dots, setDots] = useState(0);
    useEffect(() => {
        const iv = setInterval(() => setDots(d => (d + 1) % 4), 500);
        return () => clearInterval(iv);
    }, []);
    return <span style={{ opacity: 0.6 }}>Thinking{".".repeat(dots)}&nbsp;</span>;
};

// ── Icons ─────────────────────────────────────────────────────────────────────

const SearchIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
);

const BackIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
);

// Drawn rather than typed, like every other icon here. The list row used the
// U+1F5D1 emoji, which has no colour glyph in Windows' default UI font and falls
// back to a monochrome symbol face; an inline SVG renders the same everywhere and
// matches the stroke weight of its neighbours.
const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    </svg>
);





// ── Message bubble ────────────────────────────────────────────────────────────

const MessageBubble = ({ msg }) => {
    const isPlayer = msg.role === "user";
    const isError  = msg.role === "error";
    const flag     = useCountryFlag(isPlayer || isError ? {} : { code: msg.code, name: msg.speaker });
    const reactions = Object.entries(msg.reactions ?? {});
    const reactionFlags = useCountryFlags(reactions.map(([name, { code }]) => ({ name, code })));
    const nationColor = useNationColor(!isPlayer && !isError ? msg.code : null);
    const accentColor = nationColor ?? ((!isPlayer && !isError) ? countryAccentColor(msg.speaker ?? "") : null);

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: isPlayer ? "flex-end" : "flex-start", overflow: "visible" }}>
        <div style={{ position: "relative", maxWidth: "90%", overflow: "visible" }}>

        {!isPlayer && (
            <span style={{
                display: "block",
                fontSize: "0.7rem",
                color: "rgba(255,255,255,0.4)",
                       marginBottom: "0.25rem",
                       whiteSpace: "nowrap",
            }}>
            {isError ? "⚠️ Error" : `${flag} ${msg.speaker}`}
            </span>
        )}

        {isPlayer && reactions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "row-reverse", gap: "0.15rem", marginBottom: "0.3rem" }}>
            {reactions.map(([country, { emoji, code }]) => (
                <ReactionBubble key={country} country={country} emoji={emoji} flag={reactionFlags[country] ?? "🏳"} code={code} />
            ))}
            </div>
        )}

        {/* Player-typed text stays verbatim under UI translation. */}
        <div data-no-translate={isPlayer ? "" : undefined} style={{
            padding: "0.6rem 0.85rem",
            borderRadius: isPlayer ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
            backgroundColor: isPlayer
            ? "#3b82f6"
            : isError
            ? "rgba(239,68,68,0.2)"
            : `color-mix(in srgb, ${accentColor} 5%, rgba(30,35,50,0.95))`,
            fontSize: "0.85rem", lineHeight: "1.5", whiteSpace: "pre-wrap", wordBreak: "break-word",
            border: isPlayer
            ? "none"
            : isError
            ? "1px solid rgba(239,68,68,0.3)"
            : `1px solid color-mix(in srgb, ${accentColor} 35%, transparent)`,
            borderLeft: (!isPlayer && !isError)
            ? `2px solid ${accentColor}`
            : undefined,
            boxSizing: "border-box",
        }}>
        {isPlayer ? msg.text : <div className="chat-markdown"><ReactMarkdown>{msg.text}</ReactMarkdown></div>}
        {!isPlayer && msg.ledger && (msg.ledger.spent?.length > 0 || msg.ledger.produced?.length > 0) && (
            <div style={{ marginTop: "0.55rem", paddingTop: "0.45rem", borderTop: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.62)", fontSize: "0.72rem", lineHeight: 1.45 }}>
            {msg.ledger.spent?.length > 0 && <div>📉 Spent: {msg.ledger.spent.join(" · ")}</div>}
            {msg.ledger.produced?.length > 0 && <div>📈 Produced: {msg.ledger.produced.join(" · ")}</div>}
            </div>
        )}
        </div>

        {!isPlayer && msg.time && (
            <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "0.25rem", display: "block" }}>
            {new Date(msg.time).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}
            </span>
        )}
        </div>
        </div>
    );
};

// ── Reaction bubble ───────────────────────────────────────────────────────────

const ReactionBubble = ({ country, emoji, flag, code }) => {
    const [hovered, setHovered] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const anchorRef = useRef(null);
    const nationColor = useNationColor(code ?? null);

    const handleMouseEnter = () => {
        if (anchorRef.current) {
            const r = anchorRef.current.getBoundingClientRect();
            setPos({ x: r.left + r.width / 2, y: r.top });
        }
        setHovered(true);
    };

    const tooltip = hovered ? ReactDOM.createPortal(
        <div style={{
            position: "fixed",
            left: pos.x,
            top: pos.y - 2,
            transform: "translate(-50%, -100%)",
                                                    backgroundColor: "rgba(17,24,39,0.95)",
                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                    borderRadius: "6px",
                                                    padding: "0.2rem 0.45rem",
                                                    fontSize: "0.7rem",
                                                    color: "rgba(255,255,255,0.85)",
                                                    whiteSpace: "nowrap",
                                                    pointerEvents: "none",
                                                    zIndex: 99999,
        }}>
        {flag} {country}
        </div>,
        document.body
    ) : null;

    return (
        <div style={{ position: "relative", marginBottom: "-1rem" }}>
        {tooltip}
        <div
        ref={anchorRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
        style={{
            width: "1.6rem", height: "1.6rem", borderRadius: "50%",
            backgroundColor: nationColor
            ? `color-mix(in srgb, ${nationColor} 25%, rgba(20,28,48,0.98))`
            : "rgba(30,40,60,0.95)",
            border: nationColor
            ? `1.5px solid ${nationColor}`
            : "1px solid rgba(255,255,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.85rem", cursor: "default", lineHeight: 1,
        }}
        >
        {emoji}
        </div>
        </div>
    );
};

const TypingBubble = ({ speaker, code }) => {
    const flag = useCountryFlag({ code, name: speaker });
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>{flag} {speaker}</span>
        <div style={{ padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(255,255,255,0.08)", fontSize: "0.85rem" }}>
        <ThinkingDots />
        </div>
        </div>
    );
};

// ── Country selector ──────────────────────────────────────────────────────────

const CountryTile = ({ country, code, flag, isSelected, onToggle }) => {
    const [hovered, setHovered] = React.useState(false);
    const shortName = country.length > 12 ? country.slice(0, 11) + "…" : country;
    return (
        <button
        type="button"
        aria-pressed={isSelected}
        aria-label={`${isSelected ? "Deselect" : "Select"} ${country}`}
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.35rem",
            height: "5.5rem",
            padding: "0 0.4rem",
            borderRadius: "10px",
            border: isSelected
            ? "1px solid rgba(59,130,246,0.6)"
            : hovered
            ? "1px solid rgba(255,255,255,0.15)"
            : "1px solid rgba(255,255,255,0.07)",
            background: isSelected
            ? "rgba(59,130,246,0.18)"
            : hovered
            ? "rgba(255,255,255,0.07)"
            : "rgba(255,255,255,0.04)",
            cursor: "pointer",
            transition: "all 0.12s ease",
            fontFamily: "sans-serif",
            position: "relative",
            width: "100%",
            boxSizing: "border-box",
        }}
        >
        {isSelected && (
            <div style={{ position: "absolute", top: "0.3rem", right: "0.3rem", width: "14px", height: "14px", borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", color: "white", fontWeight: 700 }}>✓</div>
        )}
        <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>{flag}</span>
        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 1.3 }}>{shortName}</span>
        </button>
    );
};

const CountrySelectorModal = ({ countries, loading, onStart, onCancel }) => {
    const [search, setSearch]     = React.useState("");
    const [selected, setSelected] = React.useState([]);
    const filtered      = useMemo(() => countries.filter(c => c.name.toLowerCase().includes(search.toLowerCase())), [countries, search]);
    const filteredFlags = useCountryFlags(filtered);
    const selectedFlags = useCountryFlags(selected);
    const isSelectedName = (name) => selected.some(s => s.name === name);
    const toggle = ({ name, code }) => setSelected(prev => prev.some(s => s.name === name) ? prev.filter(s => s.name !== name) : [...prev, { name, code }]);

    return (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(17,24,39,0.98)", borderRadius: "16px", display: "flex", flexDirection: "column", zIndex: 10 }}>
        <div style={{ padding: "1.1rem 1.25rem 0.6rem", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
        <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "white" }}>Start New Diplomatic Chat</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: "0.2rem" }}>Select countries to invite to the conversation</div>
        </div>
        <button type="button" aria-label="Close new diplomatic chat" onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: "1.1rem", padding: "0.1rem 0.3rem", borderRadius: "6px", lineHeight: 1 }}
        onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
        </div>
        <div style={{ marginTop: "0.85rem", padding: "0.65rem 0.9rem", borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>Selected Countries ({selected.length}):</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", marginTop: "0.2rem" }}>
        {selected.length === 0 ? "No countries selected yet" : selected.map(c => `${selectedFlags[c.name] ?? "🏳"} ${c.name}`).join(", ")}
        </div>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center", marginTop: "0.75rem" }}>
        <span style={{ position: "absolute", left: "0.75rem", color: "rgba(255,255,255,0.35)", display: "flex", pointerEvents: "none" }}><SearchIcon /></span>
        <input type="text" placeholder="Search countries..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ width: "100%", padding: "0.55rem 0.85rem 0.55rem 2.2rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: "0.82rem", outline: "none", boxSizing: "border-box", fontFamily: "sans-serif" }}
        onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"} />
        </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.5rem 1rem", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridAutoRows: "5.5rem", gap: "0.5rem", alignContent: "start" }}>
        {loading && <p style={{ gridColumn: "1/-1", color: "rgba(255,255,255,0.35)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center" }}>Loading countries…</p>}
        {filtered.map(c => (
            <CountryTile key={c.name} country={c.name} code={c.code} flag={filteredFlags[c.name] ?? "🏳"} isSelected={isSelectedName(c.name)} onToggle={() => toggle(c)} />
        ))}
        </div>
        <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: "0.5rem", flexShrink: 0 }}>
        <button type="button" onClick={onCancel} style={{ flex: 1, padding: "0.65rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.8)", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer", fontFamily: "sans-serif" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}>Cancel</button>
        <button type="button" onClick={() => selected.length > 0 && onStart(selected)} disabled={selected.length === 0}
        style={{ flex: 2, padding: "0.65rem", borderRadius: "10px", border: "none", background: selected.length > 0 ? "#3b82f6" : "rgba(59,130,246,0.3)", color: "white", fontSize: "0.85rem", fontWeight: 600, cursor: selected.length > 0 ? "pointer" : "not-allowed", fontFamily: "sans-serif" }}
        onMouseEnter={e => { if (selected.length > 0) e.currentTarget.style.background = "#2563eb"; }}
        onMouseLeave={e => { if (selected.length > 0) e.currentTarget.style.background = "#3b82f6"; }}>
        Chat with {selected.length} {selected.length === 1 ? "country" : "countries"}
        </button>
        </div>
        </div>
    );
};

const FigureSelectorModal = ({ figures, loading, playerCountry, gameDate, onStart, onCancel }) => {
    const [search, setSearch] = React.useState("");
    const [selected, setSelected] = React.useState([]);
    const [meetingMode, setMeetingMode] = React.useState("cabinet");
    const [error, setError] = React.useState("");
    const filtered = useMemo(
        () => figures
            .filter((figure) => isFigureBrainActive(figure))
            .filter((figure) => evaluateFigureMeeting({ figure, playerPolity: playerCountry, gameDate, meetingMode }).allowed)
            .filter((figure) => `${figure.name} ${figure.role} ${figure.polity}`.toLowerCase().includes(search.toLowerCase())),
        [figures, playerCountry, gameDate, meetingMode, search],
    );
    const toggle = (figure) => {
        setError("");
        setSelected((prev) => prev.some((item) => item.id === figure.id)
            ? prev.filter((item) => item.id !== figure.id)
            : [...prev, figure]);
    };
    const submit = () => {
        const check = evaluateFigureMeeting({ figures: selected, playerPolity: playerCountry, gameDate, meetingMode });
        if (!check.allowed) { setError(check.reason); return; }
        onStart(selected, normalizeMeetingMode(meetingMode));
    };

    return (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(17,24,39,0.98)", borderRadius: "16px", display: "flex", flexDirection: "column", zIndex: 10 }}>
        <div style={{ padding: "1.1rem 1.25rem 0.6rem", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
        <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "white" }}>Convene a council</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: "0.2rem" }}>Only explicitly activated full brains can join</div>
        </div>
        <button type="button" aria-label="Close council selector" onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: "1.1rem", padding: "0.1rem 0.3rem", borderRadius: "6px", lineHeight: 1 }}>✕</button>
        </div>
        <input type="text" placeholder="Search people, roles, countries…" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: "100%", marginTop: "0.85rem", padding: "0.55rem 0.85rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: "0.82rem", outline: "none", boxSizing: "border-box", fontFamily: "sans-serif" }} />
        <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.6rem" }}>
        {[{ id: "cabinet", label: "Cabinet", hint: "same room" }, { id: "secure-channel", label: "Secure channel", hint: "remote" }].map((option) => (
            <button key={option.id} type="button" onClick={() => { setMeetingMode(option.id); setSelected([]); setError(""); }} style={{ flex: 1, padding: "0.45rem 0.5rem", borderRadius: "8px", border: meetingMode === option.id ? "1px solid rgba(139,92,246,0.7)" : "1px solid rgba(255,255,255,0.1)", background: meetingMode === option.id ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.04)", color: "white", cursor: "pointer", fontSize: "0.72rem", fontFamily: "sans-serif" }}>
            {option.label}<span style={{ display: "block", color: "rgba(255,255,255,0.4)", fontSize: "0.62rem", marginTop: "0.1rem" }}>{option.hint}</span>
            </button>
        ))}
        </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem 1rem", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem", alignContent: "start" }}>
        {loading && <p style={{ gridColumn: "1/-1", color: "rgba(255,255,255,0.35)", fontSize: "0.82rem", textAlign: "center" }}>Loading key figures…</p>}
        {!loading && filtered.length === 0 && <p style={{ gridColumn: "1/-1", color: "rgba(255,255,255,0.35)", fontSize: "0.82rem", textAlign: "center" }}>No eligible full-brain figures for this channel. The orchestrator can activate one through brainMode/full.</p>}
        {filtered.map((figure) => {
            const isSelected = selected.some((item) => item.id === figure.id);
            return <button key={figure.id} type="button" aria-pressed={isSelected} onClick={() => toggle(figure)} style={{ textAlign: "left", minHeight: "5.5rem", padding: "0.7rem", borderRadius: "10px", border: isSelected ? "1px solid rgba(139,92,246,0.7)" : "1px solid rgba(255,255,255,0.08)", background: isSelected ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.04)", color: "white", cursor: "pointer", fontFamily: "sans-serif" }}>
            <div style={{ fontWeight: 700, fontSize: "0.82rem" }}>{isSelected ? "✓ " : "🧠 "}{figure.name}</div>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.7rem", marginTop: "0.25rem" }}>{figure.role || "Key figure"}</div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.68rem", marginTop: "0.15rem" }}>{figure.polity || "Independent"} · full brain</div>
            </button>;
        })}
        </div>
        {error && <div role="alert" style={{ padding: "0 1rem 0.55rem", color: "#fca5a5", fontSize: "0.7rem" }}>{error}</div>}
        <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: "0.5rem", flexShrink: 0 }}>
        <button type="button" onClick={onCancel} style={{ flex: 1, padding: "0.65rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.8)", fontSize: "0.85rem", cursor: "pointer", fontFamily: "sans-serif" }}>Cancel</button>
        <button type="button" disabled={selected.length === 0} onClick={submit} style={{ flex: 2, padding: "0.65rem", borderRadius: "10px", border: "none", background: selected.length > 0 ? "#8b5cf6" : "rgba(139,92,246,0.3)", color: "white", fontSize: "0.85rem", fontWeight: 600, cursor: selected.length > 0 ? "pointer" : "not-allowed", fontFamily: "sans-serif" }}>Open council ({selected.length})</button>
        </div>
        </div>
    );
};

// ── Conversation view ─────────────────────────────────────────────────────────

const ConversationView = ({ chat, playerCountry, gameDate, onDelete, onBack, onMessagesUpdate, dragHandleProps }) => {
    // Two-step delete, matching the list row. Disarms on blur so a half-pressed
    // delete never sits waiting to catch a later click.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const countries = useMemo(
        () => Array.isArray(chat?.countries)
            ? chat.countries.filter((country) => country && (country.name || country.code))
            : [],
        [chat?.countries],
    );
    const figures = useMemo(
        () => Array.isArray(chat?.figures)
            ? chat.figures.filter((figure) => figure && (figure.id || figure.name)).map((figure) => ({
                ...figure,
                code: figure.polity || figure.code || "",
                name: figure.name || figure.id,
                figureId: figure.id || figure.figureId,
            }))
            : [],
        [chat?.figures],
    );
    const participants = useMemo(() => [...countries, ...figures], [countries, figures]);
    const isFigureChat = figures.length > 0;
    const isGroup = participants.length > 1;

    const [messages, setMessages]               = useState(chat.messages ?? []);
    const [phase, setPhase]                     = useState("player");
    const [isLoading, setIsLoading]             = useState(false);
    const [playerInput, setPlayerInput]         = useState("");
    const [pendingCountry, setPendingCountry]   = useState(null);
    const [remainingQueue, setRemainingQueue]   = useState([]);
    const [speakingCountry, setSpeakingCountry] = useState(null);

    const nextSpeakerIdx    = useRef(0);
    const lastPlayerMessage = useRef("");
    const messagesEndRef    = useRef(null);
    const messagesRef       = useRef(chat.messages ?? []);
    const memoriesRef       = useRef(chat.memories ?? {});

    useEffect(() => {
        participants.forEach(({ name, code }) => getCountryFlag({ code, name }));
    }, [participants]);

    useEffect(() => {
        const saved = chat.messages ?? [];
        memoriesRef.current = chat.memories ?? {};
        if (saved.length > 0) loadDiplomaticHistory(saved);
        else startDiplomaticChat();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chat.id]);

        useEffect(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, [messages, isLoading, phase]);

        const pushMessages = (updated, memoryUpdate = null) => {
            const nextMemories = memoryUpdate
                ? { ...memoriesRef.current, ...memoryUpdate }
                : memoriesRef.current;
            messagesRef.current = updated;
            memoriesRef.current = nextMemories;
            setMessages(updated);
            onMessagesUpdate(chat.id, updated, nextMemories);
        };

        const isPlayerCountry = (country) => !country?.figureId && countryMatchesIdentity(country, playerCountry);

        const fetchLeaderResponse = async (country, playerMessage, queueAfter) => {
            if (isPlayerCountry(country)) {
                setPendingCountry(null);
                setRemainingQueue([]);
                setPhase("player");
                return;
            }
            setIsLoading(true);
            setSpeakingCountry(country);
            try {
                const result = country.figureId
                    ? await sendKeyFigureMessage(country.figureId, playerMessage, { ...chat, messages: messagesRef.current }, { playerCountry, gameDate })
                    : await sendDiplomaticMessage(playerMessage, country.name, countries, {
                        chatId: chat.id,
                        chat: { ...chat, messages: messagesRef.current, memories: memoriesRef.current },
                    });
                const { reply, reaction } = result;
                const memoryUpdate = result.memory ? { [country.name]: result.memory } : null;
                if (result.memory) await saveCountryDiplomaticMemory(country.name, result.memory);

                if (reaction) {
                    const msgs = [...messagesRef.current];
                    const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
                    if (lastUserIdx !== -1) {
                        msgs[lastUserIdx] = {
                            ...msgs[lastUserIdx],
                            reactions: { ...(msgs[lastUserIdx].reactions ?? {}), [country.name]: { emoji: reaction, code: country.code } },
                        };
                        pushMessages([...msgs, { role: country.figureId ? "figure" : "leader", figureId: country.figureId, speaker: country.name, code: country.code, text: reply, time: gameDate, ...(result.ledger ? { ledger: result.ledger } : {}) }], memoryUpdate);
                    } else {
                        pushMessages([...msgs, { role: country.figureId ? "figure" : "leader", figureId: country.figureId, speaker: country.name, code: country.code, text: reply, time: gameDate, ...(result.ledger ? { ledger: result.ledger } : {}) }], memoryUpdate);
                    }
                } else {
                    pushMessages([...messagesRef.current, { role: country.figureId ? "figure" : "leader", figureId: country.figureId, speaker: country.name, code: country.code, text: reply, time: gameDate, ...(result.ledger ? { ledger: result.ledger } : {}) }], memoryUpdate);
                }
            } catch (err) {
                pushMessages([...messagesRef.current, { role: "error", speaker: country.name, code: country.code, text: err.message, time: gameDate }]);
            } finally {
                setIsLoading(false);
                setSpeakingCountry(null);
            }
            if (queueAfter.length > 0) {
                offerNextCountry(queueAfter);
            } else {
                setPhase("player");
            }
        };

        const buildRoundQueue = () => {
            const n = participants.length;
            if (n === 0) return [];
            const s = nextSpeakerIdx.current % n;
            return [...participants.slice(s), ...participants.slice(0, s)];
        };

        const buildResponsiveQueue = async (updatedMessages) => {
            const rotatedQueue = buildRoundQueue();
            const suggestedSpeaker = await chooseNextDiplomaticSpeaker({
                chat: {
                    ...chat,
                    messages: updatedMessages,
                },
                excludeSpeaker: updatedMessages.at(-1)?.speaker || updatedMessages.at(-1)?.role || "",
            }).catch(() => "");

            if (!suggestedSpeaker) {
                return rotatedQueue;
            }

            const suggestedCountry = rotatedQueue.find((country) => country.name.toLowerCase() === suggestedSpeaker.toLowerCase());
            if (!suggestedCountry) {
                return rotatedQueue;
            }

            return [
                suggestedCountry,
                ...rotatedQueue.filter((country) => country.name !== suggestedCountry.name),
            ];
        };

        const offerNextCountry = (queue) => {
            const [next, ...rest] = queue;
            if (!next || participants.length === 0) {
                setPhase("player");
                return;
            }
            nextSpeakerIdx.current = (nextSpeakerIdx.current + 1) % participants.length;
            if (isPlayerCountry(next)) {
                setPendingCountry(null);
                setRemainingQueue([]);
                setPhase("player");
                return;
            }
            setPendingCountry(next);
            setRemainingQueue(rest);
            setPhase("pending");
        };

        const handlePlayerSubmit = async () => {
            const text = playerInput.trim();
            if (!text || isLoading) return;
            lastPlayerMessage.current = text;
            const nextMessages = [...messagesRef.current, { role: "user", speaker: playerCountry, text, time: gameDate }];
            pushMessages(nextMessages);
            setPlayerInput("");
            const queue = await buildResponsiveQueue(nextMessages);
            if (queue.length === 0) {
                pushMessages([...nextMessages, { role: "error", speaker: "System", text: "This chat has no valid participants.", time: gameDate }]);
                return;
            }
            if (isGroup) {
                offerNextCountry(queue);
            } else {
                await fetchLeaderResponse(queue[0], text, []);
            }
        };

        const handleSpeakInstead = () => {
            setPendingCountry(null);
            setRemainingQueue([]);
            setPhase("player");
        };

        const handleLetSpeak = async () => {
            const country = pendingCountry;
            const rest    = remainingQueue;
            setPendingCountry(null);
            setRemainingQueue([]);
            await fetchLeaderResponse(country, lastPlayerMessage.current, rest);
        };

        const typingSpeaker = speakingCountry ?? participants[0];

        return (
            <>
            <div {...dragHandleProps} style={{ ...dragHandleProps?.style, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.85rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            <button type="button" aria-label="Back to diplomatic chats" onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", display: "flex", padding: "0.2rem", borderRadius: "6px" }}
            onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; e.currentTarget.style.background = "none"; }}>
            <BackIcon />
            </button>
            <span style={{ flex: 1, fontWeight: 700, fontSize: "0.95rem", color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isFigureChat ? `Council (${chat.meetingMode === "secure-channel" ? "secure channel" : "cabinet"}): ` : "Chat with "}{participants.map(c => c.name).join(", ") || "unknown participant"}
            </span>
            {/* Two-step, same as the list row: one click arms, the next confirms. */}
            <button type="button" title={confirmingDelete ? "Click again to delete this chat" : "Delete chat"}
            aria-label={confirmingDelete ? "Confirm deleting this chat" : "Delete chat"}
            onClick={() => { if (confirmingDelete) { onDelete?.(); } else { setConfirmingDelete(true); } }}
            onBlur={() => setConfirmingDelete(false)}
            style={{ display: "flex", alignItems: "center", gap: "0.3rem", background: confirmingDelete ? "rgba(239,68,68,0.18)" : "none", border: `1px solid ${confirmingDelete ? "rgba(239,68,68,0.55)" : "transparent"}`, cursor: "pointer", color: confirmingDelete ? "#fca5a5" : "rgba(239,68,68,0.65)", fontSize: "0.72rem", fontWeight: 600, fontFamily: "sans-serif", padding: confirmingDelete ? "0.25rem 0.5rem" : "0.25rem", borderRadius: "6px", lineHeight: 1 }}
            onMouseEnter={e => { if (!confirmingDelete) { e.currentTarget.style.color = "rgba(239,68,68,1)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; } }}
            onMouseLeave={e => { if (!confirmingDelete) { e.currentTarget.style.color = "rgba(239,68,68,0.65)"; e.currentTarget.style.background = "none"; } }}>
            {confirmingDelete ? "Delete?" : <TrashIcon />}
            </button>
            <button type="button" aria-label="Close diplomatic conversation" onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.45)", fontSize: "1rem", lineHeight: 1, padding: "0.25rem 0.3rem", borderRadius: "6px" }}
            onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.45)"; e.currentTarget.style.background = "none"; }}>✕</button>
            </div>

            {isFigureChat && (
                <div style={{ padding: "0.55rem 0.8rem", borderBottom: "1px solid rgba(139,92,246,0.18)", background: "rgba(139,92,246,0.06)", display: "flex", flexDirection: "column", gap: "0.35rem", flexShrink: 0 }}>
                {figures.map((figure) => (
                    <div key={figure.figureId || figure.id} style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "0.95rem" }}>🧠</span>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.78)", fontWeight: 600 }}>{figure.name}{figure.role ? ` · ${figure.role}` : ""}</div>
                            {figure.thought && <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.48)", marginTop: "0.12rem" }}>Thought: {figure.thought}</div>}
                            {figure.achievements?.length > 0 && <div style={{ fontSize: "0.66rem", color: "rgba(167,139,250,0.75)", marginTop: "0.1rem" }}>Achievement: {typeof figure.achievements.at(-1) === "string" ? figure.achievements.at(-1) : figure.achievements.at(-1)?.title}</div>}
                        </div>
                    </div>
                ))}
            </div>
            )}

            <div style={{ flex: 1, overflowY: "auto", overflowX: "visible", scrollbarWidth: "none", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {messages.length === 0 && !isLoading && (
                <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.35)", fontStyle: "italic", textAlign: "center", marginTop: "2rem" }}>
                Begin the diplomatic conversation.
                </p>
            )}
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} chatCountries={participants} />)}
            {isLoading && typingSpeaker && <TypingBubble speaker={typingSpeaker.name} code={typingSpeaker.code} />}
            <div ref={messagesEndRef} />
            </div>

            {phase === "pending" && !isLoading && pendingCountry ? (
                <div style={{ padding: "0.75rem 1rem 0.9rem", borderTop: "1px solid rgba(255,255,255,0.07)", backgroundColor: "rgba(0,0,0,0.15)", flexShrink: 0 }}>
                <p style={{ margin: "0 0 0.55rem 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
                <CountryTurnLabel country={pendingCountry} remaining={remainingQueue.length} />
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                type="button"
                aria-label="Speak now"
                onClick={handleSpeakInstead}
                style={{ flex: 1, padding: "0.58rem 0.7rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.8)", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.12s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.11)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
                >Speak</button>
                <button
                type="button"
                aria-label={`Let ${pendingCountry.name} speak`}
                onClick={handleLetSpeak}
                style={{ flex: 2, padding: "0.58rem 0.7rem", borderRadius: "10px", border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.12)", color: "rgba(255,255,255,0.88)", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.12s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,0.24)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.55)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(139,92,246,0.12)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.3)"; }}
                >Let {pendingCountry.name} speak →</button>
                </div>
                </div>
            ) : phase === "player" && !isLoading ? (
                <div style={{ padding: "1rem", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                <textarea
                placeholder="Send a diplomatic message…"
                rows={1} value={playerInput}
                onChange={e => setPlayerInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePlayerSubmit(); } }}
                onInput={e => { e.target.style.height = "auto"; }}
                style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", color: "white", fontSize: "0.875rem", padding: "0.6rem 0.75rem", resize: "none", outline: "none", fontFamily: "sans-serif", lineHeight: "1.5", overflowY: "hidden", transition: "border-color 0.2s" }}
                onFocus={e => e.target.style.borderColor = "rgba(59,130,246,0.6)"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"}
                />
                <button type="button" aria-label="Send diplomatic message" onClick={handlePlayerSubmit} disabled={!playerInput.trim()}
                style={{ backgroundColor: playerInput.trim() ? "#3b82f6" : "rgba(59,130,246,0.3)", border: "none", borderRadius: "10px", width: "2.5rem", height: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center", cursor: playerInput.trim() ? "pointer" : "not-allowed", flexShrink: 0, fontSize: "1rem", transition: "background-color 0.2s" }}
                onMouseEnter={e => { if (playerInput.trim()) e.currentTarget.style.backgroundColor = "#2563eb"; }}
                onMouseLeave={e => { if (playerInput.trim()) e.currentTarget.style.backgroundColor = "#3b82f6"; }}
                >🚀</button>
                </div>
            ) : null}
            </>
        );
};

const CountryTurnLabel = ({ country, remaining }) => {
    const flag = useCountryFlag({ code: country.code, name: country.name });
    return (
        <>
        {flag} <strong style={{ color: "rgba(255,255,255,0.65)", fontWeight: 600 }}>{country.name}</strong> would like to respond
        {remaining > 0 && <span style={{ color: "rgba(255,255,255,0.22)" }}> · {remaining} more after</span>}
        </>
    );
};

// ── Unread tracking ───────────────────────────────────────────────────────────

// Message totals per chat as of the last time the panel was open. Module-level
// AND persisted because two separate components need the SAME baseline: the
// toolbar's unread badge and the panel's chat list. It used to be a useRef
// inside the toolbar button, so the list could not read it and every remount
// silently reset it.
const SEEN_KEY = "oh:chat-seen";

// null (not {}) when nothing has ever been recorded — the two cases differ: no
// baseline at all means "first run, don't shout about chats that were already
// there", while an empty baseline means every chat really is new.
const readSeen = () => {
    try {
        const raw = localStorage.getItem(SEEN_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
};

const writeSeen = (totals) => {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(totals)); } catch { /* private mode / quota */ }
};

const chatMessageCount = (chat) => chat?.messages?.length ?? 0;
const seenTotals = (list) => Object.fromEntries(list.map((c) => [String(c.id), chatMessageCount(c)]));

// Unread = more messages than when the panel was last open. A chat with no entry
// is unread (that is how a brand-new conversation surfaces) — but only once a
// baseline exists, so a first run doesn't light up every existing chat.
const isChatUnread = (chat, seen) => {
    if (!seen) return false;
    const prev = seen[String(chat.id)];
    return prev === undefined || chatMessageCount(chat) > prev;
};

// ── Chat list item ────────────────────────────────────────────────────────────

const ChatListItem = ({ chat, onClick, onDelete, unread = false }) => {
    const [hovered, setHovered] = React.useState(false);
    // Deleting a chat is not undoable, so the bin arms first and deletes on the
    // second click. Resets whenever the pointer leaves the row, so a half-pressed
    // delete never sits waiting to catch a later click.
    const [confirming, setConfirming] = React.useState(false);
    const previewCountries = Array.isArray(chat.countries) ? chat.countries.slice(0, 4) : [];
    const flagMap  = useCountryFlags(previewCountries);
    const flags    = previewCountries.map(c => flagMap[c.name] ?? "🏳").join(" ");
    const figureNames = Array.isArray(chat.figures) ? chat.figures.map((figure) => figure.name).filter(Boolean) : [];
    const names    = [...(Array.isArray(chat.countries) ? chat.countries.map(c => c.name) : []), ...figureNames].join(", ");
    const lastMsg  = chat.messages?.at(-1);
    const preview  = lastMsg ? lastMsg.text.replace(/\*\*/g, "").slice(0, 60) + (lastMsg.text.length > 60 ? "…" : "") : "No messages yet";

    return (
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setConfirming(false); }} style={{ position: "relative" }}>
        <button type="button" aria-label={`Open chat with ${names}`} onClick={onClick} style={{ width: "100%", padding: "0.7rem 0.9rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)", background: hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", transition: "background 0.15s", fontFamily: "sans-serif", textAlign: "left" }}>
        {/* Fixed-width slot, always rendered, so read and unread rows stay aligned. */}
        <div style={{ width: "0.5rem", flexShrink: 0, display: "flex", justifyContent: "center" }} aria-hidden="true">
        {unread && <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "#60a5fa" }} />}
        </div>
        <div style={{ fontSize: "1.3rem", flexShrink: 0, lineHeight: 1 }}>{flags || (figureNames.length ? "🧠" : "🏳")}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.82rem", fontWeight: unread ? 700 : 600, color: unread ? "#fff" : "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{names}{unread && <span style={{ fontWeight: 400, fontSize: "0.7rem", color: "#60a5fa", marginLeft: "0.4rem" }}>new</span>}</div>
        <div style={{ fontSize: "0.75rem", color: unread ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)", marginTop: "0.15rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</div>
        </div>
        </button>
        {hovered && (
            <button type="button" onClick={e => { e.stopPropagation(); if (confirming) { onDelete(); } else { setConfirming(true); } }}
            title={confirming ? "Click again to delete this chat" : "Delete chat"}
            aria-label={confirming ? "Confirm deleting this chat" : "Delete chat"}
            style={{ position: "absolute", top: "50%", right: "0.6rem", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "0.3rem", background: confirming ? "rgba(239,68,68,0.18)" : "none", border: `1px solid ${confirming ? "rgba(239,68,68,0.55)" : "transparent"}`, cursor: "pointer", color: confirming ? "#fca5a5" : "rgba(239,68,68,0.7)", fontSize: "0.72rem", fontWeight: 600, fontFamily: "sans-serif", padding: confirming ? "0.25rem 0.5rem" : "0.25rem", borderRadius: "6px", lineHeight: 1 }}
            onMouseEnter={e => { if (!confirming) { e.currentTarget.style.color = "rgba(239,68,68,1)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; } }}
            onMouseLeave={e => { if (!confirming) { e.currentTarget.style.color = "rgba(239,68,68,0.7)"; e.currentTarget.style.background = "none"; } }}>
            {confirming ? "Delete?" : <TrashIcon />}</button>
        )}
        </div>
    );
};

// ── Main ChatPanel ────────────────────────────────────────────────────────────

// Bridge so the map region popup can request a diplomatic chat with a country.
const _chatOpenSubs = new Set();
export const requestDiplomaticChat = (country) => {
    if (!country || !country.name) return;
    _chatOpenSubs.forEach((fn) => { try { fn(country); } catch { /* noop */ } });
};

const ChatPanel = ({ isOpen, onClose, requestedCountry, onConsumeRequest }) => {
    const draggable = useDraggablePanel("oh-panel-position-chat");
    const [countries, setCountries]               = useState([]);
    const [figures, setFigures]                   = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(true);
    const [loadingFigures, setLoadingFigures]     = useState(true);
    const [playerCountry, setPlayerCountry]       = useState("your nation");
    const [gameDate, setGameDate]                 = useState("");
    const [chats, setChats]                       = useState([]);
    const [activeChat, setActiveChat]             = useState(null);
    const [showSelector, setShowSelector]         = useState(false);
    const [showCouncil, setShowCouncil]           = useState(false);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    const openChats = chats.filter((chat) => chat.status !== "closed" && ((Array.isArray(chat.countries) && chat.countries.length > 0) || (Array.isArray(chat.figures) && chat.figures.length > 0)));

    // Which chats to flag as unread, snapshotted when the panel OPENS and held
    // until it closes — rows must not reshuffle under the cursor while the player
    // is reading them. Reopening the panel is what re-sorts.
    const [unreadIds, setUnreadIds] = useState(() => new Set());
    const snapshotTakenRef = useRef(false);

    useEffect(() => {
        if (!isOpen) { snapshotTakenRef.current = false; return; }
        if (snapshotTakenRef.current || !hasLoadedInitialData) return;
        snapshotTakenRef.current = true;
        setUnreadIds(new Set(openChats.filter((chat) => isChatUnread(chat, readSeen())).map((chat) => String(chat.id))));
        // Everything on screen now counts as seen: the toolbar badge clears, and the
        // next open only flags what arrived in between.
        writeSeen(seenTotals(openChats));
    }, [isOpen, hasLoadedInitialData, openChats]);

    // Unread first, everything else in the order it already had — a stable
    // partition, so chats the player has read don't jump around too.
    const orderedChats = [
        ...openChats.filter((chat) => unreadIds.has(String(chat.id))),
        ...openChats.filter((chat) => !unreadIds.has(String(chat.id))),
    ];

    // Opening a chat marks it read, so messages that landed while the panel was
    // already open don't come back flagged on the next open.
    const openChatFromList = (chat) => {
        setActiveChat(chat);
        writeSeen({ ...(readSeen() || {}), [String(chat.id)]: chatMessageCount(chat) });
    };

    useEffect(() => {
        if (!isOpen || hasLoadedInitialData) return;

        let cancelled = false;
        Promise.all([loadCountryNames(), loadAllChats(), readWorldState({ force: true })])
        .then(([countryList, savedChats, world]) => {
            if (cancelled) return;
            setCountries(countryList);
            setFigures(Array.isArray(world?.keyFigures) ? world.keyFigures.filter((figure) => isFigureBrainActive(figure)) : []);
            setLoadingCountries(false);
            setLoadingFigures(false);
            if (savedChats.length > 0) setChats(savedChats);
            setHasLoadedInitialData(true);
        })
        .catch(() => {
            if (!cancelled) {
                setLoadingCountries(false);
                setLoadingFigures(false);
                setHasLoadedInitialData(true);
            }
        });

        return () => { cancelled = true; };
    }, [hasLoadedInitialData, isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        const go = () => readJson(JSON_URLS.game, { defaultValue: {}, force: true })
        .then((data) => {
            if (cancelled) return;
            if (data.country) setPlayerCountry(data.country);
            if (data.gameDate) setGameDate(data.gameDate);
        })
        .catch(() => {});

        go();
        const iv = setInterval(go, 5000);
        return () => {
            cancelled = true;
            clearInterval(iv);
        };
    }, [isOpen]);

    // Chats created OUTSIDE this panel — a jump's diplomatic invitations, the
    // idle outreach drip — used to be invisible until a full page reload (the
    // list loaded exactly once). Poll the stored list while the panel is open
    // and merge additions/updates in; the active conversation object is left
    // alone so an in-flight exchange is never clobbered mid-reply.
    useEffect(() => {
        if (!isOpen || !hasLoadedInitialData) return;

        let cancelled = false;
        const sync = () => loadAllChats({ force: true })
        .then((saved) => {
            if (cancelled || !Array.isArray(saved)) return;
            setChats((prev) => {
                const signature = (list) => list.map((c) => `${c.id}:${c.status}:${c.messages?.length ?? 0}`).join("|");
                if (signature(saved) === signature(prev)) return prev;
                setActiveChat((ac) => {
                    if (!ac) return ac;
                    const updated = saved.find((c) => c.id === ac.id);
                    // Only adopt storage's copy when it has MORE messages (an
                    // outreach note landed); otherwise the in-panel state wins.
                    return updated && (updated.messages?.length ?? 0) > (ac.messages?.length ?? 0) ? updated : ac;
                });
                return saved;
            });
        })
        .catch(() => {});

        const iv = setInterval(sync, 5000);
        return () => {
            cancelled = true;
            clearInterval(iv);
        };
    }, [isOpen, hasLoadedInitialData]);

    const availableCountries = useMemo(
        () => countries.filter(country => !countryMatchesIdentity(country, playerCountry)),
                                       [countries, playerCountry]
    );

    const handleMessagesUpdate = (chatId, newMessages, newMemories = null) => {
        setChats(prev => {
            const updated = prev.map(c => c.id === chatId
                ? { ...c, messages: newMessages, ...(newMemories ? { memories: newMemories } : {}) }
                : c);
            saveAllChats(updated);
            setActiveChat(ac => ac?.id === chatId
                ? { ...ac, messages: newMessages, ...(newMemories ? { memories: newMemories } : {}) }
                : ac);
            return updated;
        });
    };

    const handleStartChat = (selected) => {
        const newChat = { id: Date.now(), countries: selected, messages: [], status: "open" };
        setChats(prev => { const u = [newChat, ...prev]; saveAllChats(u); return u; });
        setShowSelector(false);
        setActiveChat(newChat);
    };

    const handleStartCouncil = (selected, meetingMode = "cabinet") => {
        const newChat = {
            id: Date.now(),
            mode: "council",
            meetingMode: normalizeMeetingMode(meetingMode),
            title: `Council: ${selected.map((figure) => figure.name).join(", ")}`,
            countries: [],
            figures: selected.map((figure) => ({
                id: figure.id,
                name: figure.name,
                role: figure.role,
                polity: figure.polity,
                brainMode: figure.brainMode || "full",
                brainEnabled: figure.brainEnabled !== false,
                brainStatus: figure.brainStatus || "active",
                meetingModes: figure.meetingModes || [],
                meetingAccess: figure.meetingAccess || "normal",
                thought: figure.thought || figure.currentThought || "",
                achievements: figure.achievements || [],
                projects: figure.projects || [],
            })),
            messages: [],
            status: "open",
        };
        setChats((prev) => { const updated = [newChat, ...prev]; saveAllChats(updated); return updated; });
        setShowCouncil(false);
        setActiveChat(newChat);
    };

    // Deleting hides the thread from the player; it does NOT erase it. gameplay.js
    // feeds closed chats back to the model as concluded-negotiation history, so
    // dropping the record outright would make the AI act as though the talks never
    // happened. Closing also means the next approach from that country opens a
    // FRESH chat instead of reviving this one — closed chats are excluded from the
    // "already talking to them" lookup.
    //
    // This is what the old Archive button did, so there is no separate archive
    // control any more: two buttons that both close a chat only invited the
    // question of which one really deleted it.
    const handleDeleteChat = (id) => {
        setChats(prev => {
            const updated = prev.map(chat => chat.id === id ? { ...chat, status: "closed" } : chat);
            saveAllChats(updated);
            return updated;
        });
        if (activeChat?.id === id) setActiveChat(null);
    };

    // Open (or reuse) a 1-on-1 chat with a country requested from the region popup.
    const consumePending = (country) => {
        setShowSelector(false);
        setChats(prev => {
            const existing = prev.find(
                c => c.status !== "closed" && Array.isArray(c.countries) && c.countries.length === 1 &&
                     (c.countries[0]?.name || "").toLowerCase() === country.name.toLowerCase(),
            );
            if (existing) { setActiveChat(existing); return prev; }
            const newChat = { id: Date.now(), countries: [{ name: country.name, code: country.code || "" }], messages: [], status: "open" };
            const u = [newChat, ...prev];
            saveAllChats(u);
            setActiveChat(newChat);
            return u;
        });
    };

    useEffect(() => {
        if (!isOpen || !requestedCountry) return;
        consumePending(requestedCountry);
        onConsumeRequest?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, requestedCountry]);

        return (
            <>
            <MarkdownStyleInjector />
            <div className="oh-panel" ref={draggable.panelRef} role="dialog" aria-label="Diplomatic chats" aria-hidden={!isOpen} style={{ position: "fixed", bottom: isOpen ? "calc(5.25rem + env(safe-area-inset-bottom, 0px))" : "calc(-40rem - env(safe-area-inset-bottom, 0px))", left: "0rem", width: "26.25rem", maxWidth: "calc(100vw - 1rem)", height: "min(calc(100dvh - 9rem - env(safe-area-inset-bottom, 0px)), max(calc(100dvh - 33rem), 30rem))", minHeight: "10rem", backgroundColor: "rgba(17,24,39,0.95)", backdropFilter: "blur(8px)", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "-4px 0 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)", zIndex: 10001, overflow: "hidden", transition: "bottom 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.35s ease", opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", fontFamily: "sans-serif", color: "white", display: "flex", flexDirection: "column", ...(draggable.positionStyle || {}) }}>

            {showSelector && <CountrySelectorModal countries={availableCountries} loading={loadingCountries} onStart={handleStartChat} onCancel={() => setShowSelector(false)} />}
            {showCouncil && <FigureSelectorModal figures={figures} loading={loadingFigures} playerCountry={playerCountry} gameDate={gameDate} onStart={handleStartCouncil} onCancel={() => setShowCouncil(false)} />}

            {activeChat && ((Array.isArray(activeChat.countries) && activeChat.countries.length > 0) || (Array.isArray(activeChat.figures) && activeChat.figures.length > 0)) ? (
                <ConversationView chat={activeChat} playerCountry={playerCountry} gameDate={gameDate} onDelete={() => handleDeleteChat(activeChat.id)} onBack={() => setActiveChat(null)} onMessagesUpdate={handleMessagesUpdate} dragHandleProps={draggable.dragHandleProps} />
            ) : (
                <>
                <div {...draggable.dragHandleProps} style={{ ...draggable.dragHandleProps.style, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontSize: "1rem" }}>Diplomatic Chats</span>
                <button type="button" aria-label="Close diplomatic chats" onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.15rem 0.3rem", borderRadius: "6px" }}
                onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {openChats.length === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
                    No diplomatic conversations yet.<br />Start one below.
                    </div>
                ) : orderedChats.map(chat => <ChatListItem key={chat.id} chat={chat} unread={unreadIds.has(String(chat.id))} onClick={() => openChatFromList(chat)} onDelete={() => handleDeleteChat(chat.id)} />)}
                </div>
                <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" aria-label="Start a new diplomatic chat" onClick={() => setShowSelector(true)} style={{ flex: 1, padding: "0.7rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)", fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", fontFamily: "sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.12)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}>Diplomacy</button>
                <button type="button" aria-label="Convene a council with key figures" onClick={() => setShowCouncil(true)} style={{ flex: 1, padding: "0.7rem", borderRadius: "10px", border: "1px solid rgba(139,92,246,0.35)", background: "rgba(139,92,246,0.12)", color: "rgba(255,255,255,0.9)", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(139,92,246,0.2)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(139,92,246,0.12)"}>Council</button>
                </div>
                </div>
                </>
            )}
            </div>
            </>
        );
};

// ── Chat toolbar button ───────────────────────────────────────────────────────

const Chat = ({ hovered, setHovered, isOpen, onToggle }) => {
    const [hasOpened, setHasOpened] = useState(false);
    const [pendingCountry, setPendingCountry] = useState(null);
    const [unseenCount, setUnseenCount] = useState(0);
    const setChatOpen = () => { onToggle(); };

    useEffect(() => {
        if (isOpen) setHasOpened(true);
    }, [isOpen]);

    // Unread badge: countries now message the player unprompted (jump
    // invitations, the idle outreach drip), so the toolbar button must say so.
    // A cheap poll of the stored chat list counts open chats that gained
    // messages (or appeared) since the panel was last open.
    useEffect(() => {
        let cancelled = false;
        const check = () => loadAllChats({ force: true })
        .then((saved) => {
            if (cancelled || !Array.isArray(saved)) return;
            const open = saved.filter((c) => c.status !== "closed" && ((Array.isArray(c.countries) && c.countries.length > 0) || (Array.isArray(c.figures) && c.figures.length > 0)));
            // The badge only READS the baseline. The panel writes it when it opens,
            // and it must be the only writer: if this poll also wrote on isOpen it
            // could clear the baseline first and the list would find nothing unread.
            if (isOpen) { setUnseenCount(0); return; }
            const seen = readSeen();
            if (seen === null) {
                // First look ever — seed the baseline instead of declaring every
                // chat that already existed unread.
                writeSeen(seenTotals(open));
                setUnseenCount(0);
                return;
            }
            setUnseenCount(open.filter((c) => isChatUnread(c, seen)).length);
        })
        .catch(() => {});

        check();
        const iv = setInterval(check, 15000);
        return () => {
            cancelled = true;
            clearInterval(iv);
        };
    }, [isOpen]);

    useEffect(() => {
        const handler = (country) => {
            setPendingCountry(country);
            if (!isOpen) onToggle();
        };
        _chatOpenSubs.add(handler);
        return () => _chatOpenSubs.delete(handler);
    }, [isOpen, onToggle]);
        return (
            <>
            {hasOpened && ReactDOM.createPortal(
                <ChatPanel isOpen={isOpen} onClose={onToggle} requestedCountry={pendingCountry} onConsumeRequest={() => setPendingCountry(null)} />,
                document.body,
            )}
            <button type="button" title={isOpen ? "Close diplomatic chats" : "Open diplomatic chats"} aria-label={isOpen ? "Close diplomatic chats" : unseenCount > 0 ? `Open diplomatic chats, ${unseenCount} unread` : "Open diplomatic chats"} aria-pressed={isOpen} aria-expanded={isOpen} style={{ width: "3.3rem", height: "3.3rem", borderRadius: "10px", border: hovered ? "1px solid rgba(255,255,255,0.2)" : isOpen ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.1)", background: isOpen ? "linear-gradient(145deg,rgba(109,40,217,0.4),rgba(76,29,149,0.4))" : hovered ? "linear-gradient(145deg,rgba(40,55,80,0.95),rgba(20,30,50,0.95))" : "linear-gradient(145deg,rgba(30,42,65,0.95),rgba(15,22,40,0.95))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.12s ease", boxShadow: hovered ? "inset 0 1px 0 rgba(255,255,255,0.1),0 2px 8px rgba(0,0,0,0.4)" : "inset 0 1px 0 rgba(255,255,255,0.06),inset 0 -1px 0 rgba(0,0,0,0.3),0 2px 6px rgba(0,0,0,0.35)", fontSize: "1.2rem", outline: "none", transform: hovered ? "translateY(-1px)" : "translateY(0)", color: "white", fontFamily: "sans-serif", flexShrink: 0 }}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onClick={() => setChatOpen(o => !o)}>
            <span style={{ position: "relative", display: "inline-flex" }}>
                <GameIcon name="message" size={20} />
                {unseenCount > 0 && !isOpen && (
                    <span aria-hidden="true" style={{ position: "absolute", top: "-0.55rem", right: "-0.8rem", minWidth: "1.05rem", height: "1.05rem", padding: "0 0.2rem", borderRadius: "999px", background: "#dc2626", border: "1px solid rgba(255,255,255,0.35)", color: "white", fontSize: "0.62rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
                        {unseenCount > 9 ? "9+" : unseenCount}
                    </span>
                )}
            </span>
            </button>
            </>
        );
};

// ── Toolbar ───────────────────────────────────────────────────────────────────

const PanelButton = ({ icon, label, hovered, setHovered, isOpen, onClick, accent = "blue" }) => (
    <button
        type="button"
        title={isOpen ? `Close ${label}` : label}
        aria-label={isOpen ? `Close ${label}` : `Open ${label}`}
        aria-pressed={isOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        style={{
            width: "3.3rem", height: "3.3rem", borderRadius: "10px",
            border: isOpen ? `1px solid ${accent === "violet" ? "rgba(167,139,250,0.7)" : "rgba(96,165,250,0.7)"}` : hovered ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(255,255,255,0.1)",
            background: isOpen ? (accent === "violet" ? "linear-gradient(145deg,rgba(109,40,217,0.55),rgba(76,29,149,0.48))" : "linear-gradient(145deg,rgba(30,96,170,0.5),rgba(23,63,112,0.5))") : hovered ? "linear-gradient(145deg,rgba(40,55,80,0.95),rgba(20,30,50,0.95))" : "linear-gradient(145deg,rgba(30,42,65,0.95),rgba(15,22,40,0.95))",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.12s ease",
            boxShadow: hovered ? "inset 0 1px 0 rgba(255,255,255,0.1),0 2px 8px rgba(0,0,0,0.4)" : "inset 0 1px 0 rgba(255,255,255,0.06),inset 0 -1px 0 rgba(0,0,0,0.3),0 2px 6px rgba(0,0,0,0.35)",
            fontSize: "1.15rem", outline: "none", transform: hovered ? "translateY(-1px)" : "translateY(0)", color: "rgba(235,244,255,0.92)", fontFamily: "sans-serif", flexShrink: 0,
        }}
    >
        <GameIcon name={icon} size={19} />
    </button>
);

const Toolbar = memo(({ onOpenAdvisor, onOpenCheats, isCheatsOpen, activePanel, onTogglePanel }) => {
    const [hoveredChat, setHoveredChat]       = useState(false);
    const [hoveredActions, setHoveredActions] = useState(false);
    const [hoveredForces, setHoveredForces] = useState(false);
    const [hoveredMarkers, setHoveredMarkers] = useState(false);
    const [hoveredReserves, setHoveredReserves] = useState(false);
    const [hoveredCommand, setHoveredCommand] = useState(false);
    return (
        <div className="oh-toolbar" role="toolbar" aria-label="Game panels toolbar">
        <Chat hovered={hoveredChat} setHovered={setHoveredChat} isOpen={activePanel === "chat"} onToggle={() => onTogglePanel("chat")} />
        <Actions onOpenAdvisor={onOpenAdvisor} hovered={hoveredActions} setHovered={setHoveredActions} isOpen={activePanel === "actions"} onToggle={() => onTogglePanel("actions")} />
        <PanelButton icon="forces" label="Forces" hovered={hoveredForces} setHovered={setHoveredForces} isOpen={activePanel === "forces"} onClick={() => onTogglePanel("forces")} />
        <PanelButton icon="markers" label="Map markers" hovered={hoveredMarkers} setHovered={setHoveredMarkers} isOpen={activePanel === "markers"} onClick={() => onTogglePanel("markers")} />
        <PanelButton icon="reserves" label="Military reserves" hovered={hoveredReserves} setHovered={setHoveredReserves} isOpen={activePanel === "reserves"} onClick={() => onTogglePanel("reserves")} />
        <PanelButton icon="command" label="Command center and cheats" hovered={hoveredCommand} setHovered={setHoveredCommand} isOpen={isCheatsOpen} accent="violet" onClick={onOpenCheats} />
        </div>
    );
});

export { Toolbar, Chat, ChatPanel };
