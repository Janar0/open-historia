/*! Open Historia — what a project needs and does not have: materials, tools and skills that hold it back © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/projectNeeds.test.js
//
// A project on the board used to move only as far as the model's goodwill: an
// engineer princess ordering an off-road cart got a prototype by spring,
// rubber or no rubber, because nothing in the game knew what the cart was
// made of. The board pass was told to stall an effort for "the shortage", but
// a shortage the model did not think of never happened.
//
// Needs make the shortage a thing the engine holds. A project lists what it
// requires that its owner does not already have in hand (rubber for the
// tyres, a smith who can draw wire, iron the forges cannot spare), each
// marked as it stands and with where in this world it comes from:
//
//   missing  nothing in hand: the work can get no further than
//            NEED_CAPS.missing (70%), and it can never be completed;
//   partial  some, not enough: no further than NEED_CAPS.partial (90%),
//            and not completed either;
//   secured  in hand, by a purchase, a mine, a treaty, a find: no limit.
//
// The engine applies the cap whatever the model writes (gameState.js
// normalizeProjectEntry), and turns a completion that comes with a need still
// open into a stall (holdUnmetCompletion), so the only way past the blocker is
// a story that secures it: trade with whoever holds the land it comes from,
// a substitute somebody invents, an expedition. That is the game.
//
// Import-free: the rules on plain data, tested under bare node.

export const NEED_STATUSES = Object.freeze(["missing", "partial", "secured"]);
const NEED_STATUS_SET = new Set(NEED_STATUSES);

// How far a project can get while one of its needs stands so.
export const NEED_CAPS = Object.freeze({ missing: 70, partial: 90 });

export const MAX_PROJECT_NEEDS = 6;
const NAME_MAX = 60;
const SOURCE_MAX = 160;
const NOTE_MAX = 200;

const asLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => asLine(value).toLowerCase();

// The model's words for a need's state, mapped onto the three.
const STATUS_ALIASES = {
  missing: "missing", none: "missing", lacking: "missing", unavailable: "missing", needed: "missing", blocked: "missing",
  partial: "partial", partly: "partial", some: "partial", short: "partial", scarce: "partial", insufficient: "partial",
  secured: "secured", have: "secured", available: "secured", obtained: "secured", acquired: "secured", ok: "secured", met: "secured", done: "secured",
};

const resolveStatus = (value) => {
  const key = fold(value);
  if (NEED_STATUS_SET.has(key)) return key;
  return STATUS_ALIASES[key] ?? "missing";
};

const normalizeNeed = (entry) => {
  const raw = typeof entry === "string" ? { name: entry } : entry;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name = asLine(raw.name ?? raw.material ?? raw.item ?? raw.resource).slice(0, NAME_MAX);
  if (!name) return null;
  // A need marked dropped is no need (mergeProjectNeeds takes it off the list).
  if (DROPPED.has(fold(raw.status ?? raw.state))) return null;
  const source = asLine(raw.source ?? raw.from ?? raw.where).slice(0, SOURCE_MAX);
  const note = asLine(raw.note).slice(0, NOTE_MAX);
  return {
    name,
    status: resolveStatus(raw.status ?? raw.state),
    ...(source ? { source } : {}),
    ...(note ? { note } : {}),
  };
};

// A project's needs, cleaned: one per name (the last word on a name wins, so a
// restated need replaces the old one in place), at most MAX_PROJECT_NEEDS.
export const normalizeProjectNeeds = (value) => {
  const list = Array.isArray(value) ? value : (value && typeof value === "object" ? [value] : []);
  const byName = new Map();
  for (const entry of list) {
    const need = normalizeNeed(entry);
    if (!need) continue;
    const key = fold(need.name);
    if (byName.has(key)) byName.set(key, { ...byName.get(key), ...need });
    else byName.set(key, need);
  }
  return [...byName.values()].slice(0, MAX_PROJECT_NEEDS);
};

// Words that take a need off the list: the project turned out not to need it.
const DROPPED = new Set(["dropped", "removed", "remove", "drop", "not needed", "unneeded", "none needed"]);

// A changed list laid over the one on the board: a need named again replaces
// its line in place, a new one is added, one marked dropped is taken off, and
// the rest stay. An op that restates one need must not erase the others it did
// not mention, which is what a plain replace would do.
export const mergeProjectNeeds = (current, incoming) => {
  const changes = Array.isArray(incoming) ? incoming : (incoming && typeof incoming === "object" ? [incoming] : []);
  const dropped = new Set(changes
    .filter((entry) => entry && typeof entry === "object" && DROPPED.has(fold(entry.status ?? entry.state)))
    .map((entry) => fold(entry.name ?? entry.material ?? entry.item ?? entry.resource)));
  const kept = normalizeProjectNeeds(current).filter((need) => !dropped.has(fold(need.name)));
  const added = normalizeProjectNeeds(changes.filter((entry) => !(entry && typeof entry === "object" && DROPPED.has(fold(entry.status ?? entry.state)))));
  const byName = new Map(kept.map((need) => [fold(need.name), need]));
  for (const need of added) byName.set(fold(need.name), { ...byName.get(fold(need.name)), ...need });
  return [...byName.values()].slice(0, MAX_PROJECT_NEEDS);
};

export const unmetNeeds = (needs) => normalizeProjectNeeds(needs).filter((need) => need.status !== "secured");

// The highest progress these needs allow (100 with none open).
export const needsCap = (needs) => unmetNeeds(needs).reduce((cap, need) => Math.min(cap, NEED_CAPS[need.status] ?? 100), 100);

// The need that holds the project back the most, or null: a missing one before
// a partial one, the first written among equals.
export const holdingNeed = (needs) => {
  const open = unmetNeeds(needs);
  return open.find((need) => need.status === "missing") ?? open[0] ?? null;
};

// Whether a project with these needs can be completed.
export const needsAllowCompletion = (needs) => unmetNeeds(needs).length === 0;

// Progress as the needs allow it. A finished project keeps its 100: the cap
// holds work back, it does not take back what was done.
export const progressWithinNeeds = (progress, needs, status = "") => {
  const value = Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Math.round(Number(progress)))) : 0;
  if (status === "complete") return value;
  return Math.min(value, needsCap(needs));
};

// `after` as it may land, given `before` (null for a new entry): a completion
// with a need still open is a stall instead, at the cap, with the blocker named
// on the entry. Anything else passes through untouched.
export const holdUnmetCompletion = (before, after) => {
  if (!after || after.status !== "complete") return after;
  if (before?.status === "complete") return after;
  const blocker = holdingNeed(after.needs);
  if (!blocker) return after;
  return {
    ...after,
    status: "stalled",
    progress: progressWithinNeeds(after.progress, after.needs),
  };
};

const STATUS_WORDS = { missing: "MISSING", partial: "only partly in hand", secured: "secured" };

// The board as the model reads it: what each need is, how it stands, where it
// comes from, and what that does to the entry.
export const describeNeedsForPrompt = (project) => {
  const needs = normalizeProjectNeeds(project?.needs);
  if (!needs.length) return "";
  const items = needs.map((need) => {
    const details = [STATUS_WORDS[need.status], need.source ? `from ${need.source}` : "", need.note].filter(Boolean).join("; ");
    return `${need.name} (${details})`;
  });
  const blocker = holdingNeed(needs);
  const held = blocker
    ? ` HELD: it cannot pass ${needsCap(needs)}% or be completed until ${blocker.name} is secured.`
    : "";
  return `Needs: ${items.join(", ")}.${held}`;
};

// How needs are kept, said wherever the board is kept: the folded time skip,
// the Game Master and the advisor's board block. One paragraph, so every copy
// says the same thing.
export const PROJECT_NEEDS_RULE = [
  "[What Projects Need]",
  "An effort that builds, makes or researches something physical lists in `needs` what it requires that its owner does not already have in hand: "
    + "materials, tools, skilled hands, knowledge. Each need has a name, a status (missing, partial or secured) and a source: where in THIS world it really comes from "
    + "(a named land, a polity that holds it, a trade, a craft guild). Think like an engineer: a vehicle needs metal, fuel or a power source, tyres or wheels, and the people to make them; "
    + "name what this era and this world would make hard to get, and never what the owner plainly has.",
  "The engine holds a project with a missing need at 70% at most, with a partial one at 90%, and never lets it complete while either is open: "
    + "write the story that secures a need (a purchase, a treaty, a mine, an expedition, a substitute someone invents) and mark it secured in the same op, "
    + "or the effort waits. A need is never secured by wishing, by the project's own progress or by the player asking. "
    + "In an op, send only the needs that changed: one you name again replaces its old line, a new one is added, one with status dropped comes off the list, and the rest stay as they are.",
].join("\n");
