/*! Open Historia — the Actions panel's character card: playing one person rather than a government © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The player's character (runtime/playerCharacter.js): who the player is when
// they play one person in the world rather than their polity's government. The
// time skip, the advisor and the leaders they write to are all told. Locked
// while a turn runs, because the turn writes the world it lives in.
//
// Kept beside the standing goal and styled like it, so the two read as one
// family: who you are, then where you are going.
import React from "react";
import {
    CHARACTER_ABOUT_MAX,
    CHARACTER_ANSWERS_TO_MAX,
    CHARACTER_NAME_MAX,
    CHARACTER_STANDING_MAX,
    describeCharacterBrief,
    playerCharacterOf,
    withPlayerCharacter,
} from "../../runtime/playerCharacter.js";
import { mutateWorldState } from "../../runtime/gameState.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { isSimulationBusy } from "../AI/simulationStatus.js";
import { useTurnRunning } from "./useTurnRunning.js";

const LOCKED_NOTE = "A turn is running. Your character can be changed once it ends.";
const EMPTY = { name: "", standing: "", answersTo: "", about: "" };

const buttonStyle = (enabled, primary = false) => ({
    background: primary ? (enabled ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.07)") : "none",
    border: primary ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.14)",
    borderRadius: "8px",
    color: enabled ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "sans-serif",
    fontSize: "0.74rem",
    fontWeight: 600,
    padding: "0.3rem 0.7rem",
});

const fieldStyle = {
    background: "var(--oh-ui-bg, rgba(0,0,0,0.25))",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px",
    boxSizing: "border-box",
    color: "white",
    fontFamily: "sans-serif",
    fontSize: "0.8rem",
    lineHeight: "1.45",
    outline: "none",
    padding: "0.45rem 0.65rem",
    width: "100%",
};

const labelStyle = { color: "rgba(255,255,255,0.62)", display: "flex", flexDirection: "column", fontSize: "0.7rem", gap: "0.2rem" };

const titleStyle = { color: "rgba(255,255,255,0.9)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" };

// The polities a character can answer to: every one this world knows, for the
// field's suggestions. Joined into one string so the selector re-renders only
// when the list changes.
const selectPolities = (world) => {
    const names = new Set([
        ...(Array.isArray(world?.ownerCodes) ? world.ownerCodes : []),
        ...Object.values(world?.polityOverrides ?? {}).map((polity) => polity?.name),
    ].map((name) => String(name ?? "").trim()).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b)).join("\n");
};

export const PlayerCharacterCard = ({ country, isOpen }) => {
    const stored = useRuntimeState("world", (world) => JSON.stringify(playerCharacterOf(world, country)), country);
    const character = React.useMemo(() => JSON.parse(stored || "null"), [stored]);
    const polities = useRuntimeState("world", selectPolities);
    const turnRunning = useTurnRunning(isOpen);
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(EMPTY);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const nameRef = React.useRef(null);
    const listId = React.useId();

    React.useEffect(() => {
        if (!isOpen) {
            setEditing(false);
            setError("");
        }
    }, [isOpen]);

    React.useEffect(() => {
        if (editing) nameRef.current?.focus();
    }, [editing]);

    if (!country) return null;

    const startEditing = () => {
        if (turnRunning) return;
        setDraft({ ...EMPTY, ...(character ?? {}) });
        setError("");
        setEditing(true);
    };

    const save = async (next) => {
        if (saving) return;
        if (isSimulationBusy()) {
            setError(LOCKED_NOTE);
            return;
        }
        setSaving(true);
        setError("");
        try {
            // Read and written inside the world's queue, so a write in flight
            // elsewhere is never overwritten by the copy read here.
            await mutateWorldState((current) => withPlayerCharacter(current, country, next));
            logDebugEvent("action", next?.name?.trim() ? `Character set: ${next.name.trim()}` : "Character cleared: playing the government again");
            setEditing(false);
        } catch (saveError) {
            console.error("Failed to save the character:", saveError);
            setError("Your character could not be saved. Try again.");
        } finally {
            setSaving(false);
        }
    };

    const set = (field) => (event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }));
    const canSave = !saving && !turnRunning && draft.name.trim() !== "";

    if (editing) {
        return (
            <div style={{ background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.08))", border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.18))", borderRadius: "10px", display: "flex", flexDirection: "column", flexShrink: 0, gap: "0.5rem", padding: "0.6rem 0.75rem" }}>
            <span style={titleStyle}>Who you play</span>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.72rem", lineHeight: 1.45 }}>
            Play one person instead of the government. The world, your advisor and every leader will treat you as this person: your orders are what you do yourself, and state business goes to those who rule.
            </span>
            <label style={labelStyle}>
            Their name
            <input ref={nameRef} data-no-translate value={draft.name} maxLength={CHARACTER_NAME_MAX} onChange={set("name")} placeholder="e.g. Elianna" style={fieldStyle} />
            </label>
            <label style={labelStyle}>
            Who they are
            <input data-no-translate value={draft.standing} maxLength={CHARACTER_STANDING_MAX} onChange={set("standing")} placeholder="e.g. the regent's younger daughter, sixteen" style={fieldStyle} />
            </label>
            <label style={labelStyle}>
            Answers to
            <input data-no-translate value={draft.answersTo} maxLength={CHARACTER_ANSWERS_TO_MAX} onChange={set("answersTo")} list={listId} placeholder="The country or power above them" style={fieldStyle} />
            <datalist id={listId}>
            {String(polities || "").split("\n").filter(Boolean).map((name) => <option key={name} value={name} />)}
            </datalist>
            </label>
            <label style={labelStyle}>
            Background and skills
            <textarea data-no-translate value={draft.about} maxLength={CHARACTER_ABOUT_MAX} onChange={set("about")} rows={4} placeholder="Their past, what they know how to do, what they want, what nobody knows about them" style={{ ...fieldStyle, resize: "vertical" }} />
            </label>
            <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
            {character && (
                <button type="button" className="oh-tap-row" disabled={saving || turnRunning} onClick={() => void save(null)} title="Play the government again" style={{ ...buttonStyle(!saving && !turnRunning), marginRight: "auto" }}>
                Stop playing a person
                </button>
            )}
            <button type="button" className="oh-tap-row" onClick={() => { setEditing(false); setError(""); }} style={buttonStyle(true)}>
            Cancel
            </button>
            <button type="button" className="oh-tap-row" disabled={!canSave} onClick={() => void save(draft)} style={buttonStyle(canSave, true)}>
            {saving ? "Saving…" : "Save"}
            </button>
            </div>
            {(error || turnRunning) && (
                <span style={{ color: "rgba(253,186,116,0.9)", fontSize: "0.72rem" }}>{error || LOCKED_NOTE}</span>
            )}
            </div>
        );
    }

    if (!character) {
        return (
            <button
            type="button"
            className="oh-tap-row"
            disabled={turnRunning}
            onClick={startEditing}
            title={turnRunning ? LOCKED_NOTE : "Play one person in the world instead of the government: a princess, an engineer, a captain."}
            style={{
                background: "none",
                border: "1px dashed rgba(255,255,255,0.2)",
                borderRadius: "10px",
                color: turnRunning ? "rgba(255,255,255,0.45)" : "#e4e4e7",
                cursor: turnRunning ? "not-allowed" : "pointer",
                flexShrink: 0,
                fontFamily: "sans-serif",
                fontSize: "0.78rem",
                padding: "0.5rem 0.9rem",
                textAlign: "left",
                width: "100%",
            }}
            >
            {"\u{1F3AD} Play as one person"}
            </button>
        );
    }

    return (
        <div style={{ alignItems: "center", background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.08))", border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.15))", borderRadius: "10px", display: "flex", flexShrink: 0, gap: "0.5rem", padding: "0.45rem 0.75rem" }}>
        <span aria-hidden="true">{"\u{1F3AD}"}</span>
        <span style={{ ...titleStyle, flexShrink: 0 }}>Playing as</span>
        <span data-no-translate title={character.about || undefined} style={{ color: "rgba(255,255,255,0.78)", flex: 1, fontSize: "0.76rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {describeCharacterBrief(character)}
        </span>
        <button
        type="button"
        className="oh-tap"
        disabled={turnRunning}
        onClick={startEditing}
        title={turnRunning ? LOCKED_NOTE : "Change who you play"}
        style={{ background: "none", border: "none", color: turnRunning ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.4)", cursor: turnRunning ? "not-allowed" : "pointer", flexShrink: 0, fontFamily: "sans-serif", fontSize: "0.74rem", padding: 0 }}
        >
        Edit
        </button>
        </div>
    );
};

export default PlayerCharacterCard;
