/*! Open Historia — portions (troop deployments + era troop types) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { JSON_URLS, readJson, writeJson } from "./assets.js";
import { enqueueContentStrings } from "./translator.js";
import { normalizeTagList } from "./countryTags.js";
import { dedupeEventLog } from "./eventDedup.js";
import { toCountryName } from "./ownerNames.js";

export const GAME_DEFAULTS = {
  country: "",
  difficulty: "standard",
  gameDate: "",
  language: "English",
  round: 1,
  startDate: "",
};

export const WORLD_DEFAULTS = {
  actionSuggestions: [],
  activeCatalyst: null,
  consolidatedHistory: [],
  // Durable per-country diplomatic memory. Unlike a chat-local transcript this
  // survives closing or deleting a thread and follows the country into new talks.
  diplomaticMemory: {},
  // Persistent named actors in the campaign. This is intentionally a small
  // factual layer; interpretation and prose stay in the event history.
  keyFigures: [],
  // Per-polity international reputation (0-100), evolved by the AI each turn via
  // polityChanges and fed back into prompts. Authoritative, unlike the on-demand
  // stat sheet it was first read from.
  internationalReputation: {},
  // Persisted per-country stat sheets (code -> the full sheet), seeded on first view
  // and thereafter changed ONLY by the AI (polityChanges.stats), so a country's stats
  // stop regenerating/drifting every date change.
  countryStats: {},
  // Per-country tags the AI has changed: owner code -> string[]. The scenario's
  // tags.json holds the map-maker's STARTING tags; this holds every change since,
  // and wins where present (see resolveCountryTags).
  countryTags: {},
  // AI renames of STOCK map cities (which live in PMTiles, not world.markers):
  // lowercased original city name -> new display name. world.markers cities are
  // renamed in place by applyMarkerOps; this is the override layer for the rest.
  cityRenames: {},
  // Tactical control patches inside a region. These are deliberately separate
  // from regionOwnershipOverrides: the base PMTiles geometry remains the
  // administrative layer, while this list can represent a moving/contested
  // front without pretending that a whole province changed hands.
  controlSectors: [],
  // Country-label styling, set in the scenario settings. Empty = the defaults
  // (Impact, white letters, half-black outline). The font renders from the
  // PLAYER's local fonts — the style has no glyphs endpoint, so MapLibre v5
  // rasterizes every glyph client-side using the stack as a CSS font-family.
  labelFont: "",
  labelHaloColor: "",
  labelTextColor: "",
  language: "English",
  lastJumpMode: "",
  lastJumpSummary: "",
  lastJumpTargetDate: "",
  // Structures built during play (world.markers[]): free-form kinds — a city, a
  // military base, a bunker, a missile silo, an embassy — placed at coordinates
  // and rendered as map markers beside the stock cities. Stored here so they
  // share every existing read/write/poll/normalize path, exactly like units.
  markers: [],
  // Fundamental military-industrial state. Each collection is an append/update
  // surface for AI impacts; an empty collection means "not reported", not zero.
  militaryIndustry: {
    arsenal: [],
    research: [],
    production: [],
    ledger: [],
  },
  // Named subregions/secession fragments cut out of a parent administrative region.
  // Geometry is cell-backed: a fragment is only as precise as its referenced leaf
  // tactical cells, never an arbitrary AI-drawn polygon.
  territoryFragments: [],
  // Player/AI military reserve sheets keyed by full polity name. Empty means the
  // scenario has not supplied logistics data yet; it must not be mistaken for
  // a country having zero ammunition.
  militaryReserves: {},
  // Append-only accounting entries for deterministic resource consumption and
  // production. An empty list means no machine-readable transaction has been
  // recorded yet; it is not proof that nothing was spent.
  resourceLedger: [],
  notes: "",
  polityOverrides: {},
  // Region id -> claimant polity names: the world-data way to mark a region
  // DISPUTED (striped in the administrator's + claimants' colors). Same effect
  // as a claimants list on the region's geojson feature, but declarable by a
  // scenario whose geometry ships as an immutable seed (the modern world), and
  // overridable per-world without touching geometry. Wins over feature props.
  regionClaimants: {},
  regionOwnershipOverrides: {},
  simulationHistory: [],
  simulationRules: "",
  startingTimelineText: "",
  units: [],
};

// Military units that ride along inside world state (world.units[]). Stored here
// so they share every existing read/write/poll/normalize path with no server change.
export const UNIT_TYPES = ["infantry", "armor", "air", "naval", "artillery", "garrison"];
const UNIT_TYPE_SET = new Set(UNIT_TYPES);
// "pending" = a player deployment awaiting AI resolution (rendered translucent).
const UNIT_STATUS_SET = new Set(["idle", "moving", "engaged", "defeated", "pending"]);
const UNIT_SOURCE_SET = new Set(["player", "ai", "scenario"]);
const MARKER_SOURCE_SET = new Set(["player", "ai", "scenario", "system"]);
const MARKER_STATUS_SET = new Set(["pending", "identified", "active", "destroyed"]);
// A sector is the administrative battle area; depth 1 is its tactical grid and
// depth 2 is the optional micro-grid. A third split would be too noisy for the
// map and too hard for an AI to reference reliably.
export const CONTROL_CELL_MAX_DEPTH = 2;
const TERRITORY_FRAGMENT_STATUS_SET = new Set(["proposed", "active", "dissolved"]);

// Every caller of this parses a COORDINATE (lng/lat/toLng/toLat), which is why it
// can afford to be lenient in ways a general number parser could not.
//
// It used to be a bare Number(), and a model writing in a language that uses the
// decimal COMMA answers "37,06" — Number() returns NaN, the unit is discarded, and
// the player sees an event describing a deployment with no troops on the map. The
// same went for a coordinate carrying its unit ("37.06°N"). Recover both instead of
// throwing the deployment away.
//
// A comma is only read as a decimal point when it is the ONLY separator: "1,234.5"
// keeps its usual meaning, so a thousands separator can never silently divide a
// value by a thousand.
const finiteOrNull = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  let text = value.trim();
  if (!text) return null;

  // A trailing or leading hemisphere letter carries the sign: 37.06 S is -37.06.
  let sign = 1;
  const hemisphere = /^([NSEW])\s*|\s*([NSEW])$/i.exec(text);
  if (hemisphere) {
    const letter = (hemisphere[1] || hemisphere[2]).toUpperCase();
    if (letter === "S" || letter === "W") sign = -1;
    text = text.replace(/^[NSEW]\s*/i, "").replace(/\s*[NSEW]$/i, "");
  }

  if (text.includes(",") && !text.includes(".")) text = text.replace(",", ".");
  // Degree signs, stray spaces, anything else that is not part of a number.
  text = text.replace(/[^\d+\-.eE]/g, "");
  if (!text || !/\d/.test(text)) return null;

  const num = Number(text);
  return Number.isFinite(num) ? sign * num : null;
};

export const clampUnitStrength = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 100;
  return Math.max(0, Math.min(1000, Math.round(num)));
};

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value) => String(value ?? "").trim();

const normalizeOptionalString = (value) => {
  const nextValue = normalizeString(value);
  return nextValue || "";
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeTextLike = (value) => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return normalizeOptionalString(value);
  }

  if (value && typeof value === "object") {
    return normalizeOptionalString(
      value.text ??
        value.title ??
        value.label ??
        value.name ??
        value.summary ??
        value.description ??
        value.content ??
        value.result,
    );
  }

  return "";
};

const generateId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const normalizeActionParticipants = (value) =>
  normalizeArray(value)
    .map((entry) => normalizeString(entry))
    .filter(Boolean);

// How to undo a queued manual troop order if its action is deleted before the
// next jump (see unitsController): a deploy is removed again, a move snaps the
// unit back, a long-range order restores the prior status (#368).
const normalizeUnitRevert = (value) => {
  if (!value || typeof value !== "object") return null;
  const unitId = normalizeOptionalString(value.unitId);
  if (!unitId) return null;
  const lng = finiteOrNull(value.lng);
  const lat = finiteOrNull(value.lat);
  return {
    unitId,
    ...(lng !== null && lat !== null ? { lng, lat } : {}),
    ...(value.remove === true ? { remove: true } : {}),
    ...(normalizeOptionalString(value.status) ? { status: normalizeOptionalString(value.status) } : {}),
  };
};

export const normalizeActionEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const text = normalizeString(entry);
    if (!text) return null;

    return {
      createdAt: new Date().toISOString(),
      id: generateId(`action-${index}`),
      kind: "action",
      participants: [],
      rawInput: text,
      source: "manual",
      status: "planned",
      text,
      title: text.length > 64 ? `${text.slice(0, 61)}...` : text,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const rawInput = normalizeTextLike(entry.rawInput || entry.input || entry.text || entry.content);
  const text = normalizeTextLike(entry.text || entry.content || entry.body || rawInput);
  const title =
    normalizeTextLike(entry.title || entry.name) ||
    (text.length > 64 ? `${text.slice(0, 61)}...` : text);

  if (!title && !text && !rawInput) {
    return null;
  }

  const kind =
    normalizeString(entry.kind || entry.type).toLowerCase() === "chat"
      ? "chat"
      : "action";

  const unitRevert = normalizeUnitRevert(entry.unitRevert);

  return {
    chatStarter: normalizeOptionalString(entry.chatStarter || entry.openingMessage),
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
    id: normalizeOptionalString(entry.id) || generateId(`action-${index}`),
    invitees: normalizeActionParticipants(entry.invitees),
    kind,
    participants: normalizeActionParticipants(entry.participants),
    rawInput: rawInput || text || title,
    source: normalizeOptionalString(entry.source) || "manual",
    status: normalizeOptionalString(entry.status) || "planned",
    suggestionTopic: normalizeOptionalString(entry.suggestionTopic || entry.topic),
    text: text || rawInput || title,
    title: title || rawInput || text,
    ...(unitRevert ? { unitRevert } : {}),
  };
};

export const normalizeActions = (actions) =>
  normalizeArray(actions)
    .map((entry, index) => normalizeActionEntry(entry, index))
    .filter(Boolean);

const normalizeCatalystChoice = (entry, index = 0) => {
  if (typeof entry === "string") {
    const text = normalizeString(entry);
    if (!text) {
      return null;
    }

    return {
      id: generateId(`catalyst-choice-${index}`),
      result: "",
      text,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const text = normalizeTextLike(entry.text || entry.title || entry.label || entry.name);
  if (!text) {
    return null;
  }

  return {
    ...cloneValue(entry),
    id: normalizeOptionalString(entry.id) || generateId(`catalyst-choice-${index}`),
    result: normalizeTextLike(entry.result || entry.summary || entry.outcome || entry.effect || entry.description),
    text,
  };
};

const normalizeCatalystHistoryEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const summary = normalizeString(entry);
    if (!summary) {
      return null;
    }

    return {
      choice: `Step ${index + 1}`,
      summary,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const choice = normalizeTextLike(entry.choice || entry.text || entry.title || entry.name);
  const summary = normalizeTextLike(entry.summary || entry.result || entry.outcome || entry.description);

  if (!choice && !summary) {
    return null;
  }

  return {
    ...cloneValue(entry),
    choice: choice || `Step ${index + 1}`,
    summary,
  };
};

const normalizeCatalyst = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const title = normalizeTextLike(value.title || value.name);
  const premise = normalizeTextLike(value.premise || value.summary || value.description);
  const opening = normalizeTextLike(value.opening || value.text || premise);
  const choices = normalizeArray(value.choices)
    .map((entry, index) => normalizeCatalystChoice(entry, index))
    .filter(Boolean);
  const history = normalizeArray(value.history)
    .map((entry, index) => normalizeCatalystHistoryEntry(entry, index))
    .filter(Boolean);

  if (!title && !premise && !opening && choices.length === 0 && history.length === 0) {
    return null;
  }

  return {
    ...cloneValue(value),
    choices,
    history,
    opening,
    premise,
    title,
  };
};

const normalizeReactionMap = (value) => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([name, reaction]) => {
        if (!reaction || typeof reaction !== "object") {
          return [name, null];
        }

        const emoji = normalizeOptionalString(reaction.emoji);
        const code = normalizeOptionalString(reaction.code);

        if (!emoji && !code) {
          return [name, null];
        }

        return [
          name,
          {
            ...(code ? { code } : {}),
            ...(emoji ? { emoji } : {}),
          },
        ];
      })
      .filter(([, reaction]) => reaction),
  );
};

const normalizeChatMessage = (message, index = 0) => {
  if (typeof message === "string") {
    const text = normalizeString(message);
    if (!text) return null;

    return {
      code: "",
      id: generateId(`message-${index}`),
      reactions: {},
      role: "system",
      speaker: "",
      text,
      time: "",
    };
  }

  if (!message || typeof message !== "object") {
    return null;
  }

  const text = normalizeOptionalString(message.text || message.message || message.content);
  if (!text) {
    return null;
  }

  return {
    code: normalizeOptionalString(message.code),
    figureId: normalizeOptionalString(message.figureId || message.personId),
    id: normalizeOptionalString(message.id) || generateId(`message-${index}`),
    ...(message.ledger && typeof message.ledger === "object" ? { ledger: cloneValue(message.ledger) } : {}),
    reactions: normalizeReactionMap(message.reactions),
    role: normalizeOptionalString(message.role || message.sender) || "system",
    speaker: normalizeOptionalString(message.speaker || message.senderName),
    text,
    time: normalizeOptionalString(message.time || message.date),
  };
};

const normalizeChatCountry = (entry) => {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    const name = normalizeString(entry);
    if (!name) return null;

    return {
      code: "",
      name,
    };
  }

  if (typeof entry !== "object") {
    return null;
  }

  const name = normalizeOptionalString(entry.name || entry.label || entry.country);
  const code = normalizeOptionalString(entry.code || entry.id);

  if (!name && !code) {
    return null;
  }

  return {
    code,
    name: name || code,
  };
};

const normalizeChatFigure = (entry) => {
  if (!entry) return null;
  if (typeof entry === "string") {
    const name = normalizeString(entry);
    return name ? { id: name, name, polity: "", role: "" } : null;
  }
  if (typeof entry !== "object") return null;
  const id = normalizeOptionalString(entry.id || entry.figureId || entry.personId);
  const name = normalizeOptionalString(entry.name || entry.fullName || entry.person);
  if (!id && !name) return null;
  return {
    ...(entry.thought || entry.currentThought ? { thought: normalizeOptionalString(entry.thought || entry.currentThought) } : {}),
    ...(Array.isArray(entry.achievements) ? { achievements: cloneValue(entry.achievements).slice(-8) } : {}),
    ...(Array.isArray(entry.projects) ? { projects: cloneValue(entry.projects).slice(-8) } : {}),
    ...(entry.brainEnabled !== undefined ? { brainEnabled: entry.brainEnabled !== false } : {}),
    ...(entry.brainMode ? { brainMode: normalizeOptionalString(entry.brainMode).toLowerCase() } : {}),
    ...(entry.brainStatus ? { brainStatus: normalizeOptionalString(entry.brainStatus) } : {}),
    ...(Array.isArray(entry.meetingModes) ? { meetingModes: cloneValue(entry.meetingModes).slice(0, 4) } : {}),
    ...(entry.meetingAccess ? { meetingAccess: normalizeOptionalString(entry.meetingAccess) } : {}),
    id: id || name,
    name: name || id,
    polity: toCountryName(normalizeOptionalString(entry.polity || entry.ownerCode || entry.country)),
    role: normalizeOptionalString(entry.role || entry.title || entry.position),
  };
};

const normalizeChatMemories = (value) => Object.fromEntries(
  Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})
    .map(([country, memory]) => {
      const identity = normalizeOptionalString(country);
      if (!identity || !memory || typeof memory !== "object") return null;
      const summary = normalizeOptionalString(memory.summary).slice(0, 3000);
      const commitments = normalizeArray(memory.commitments)
        .map((entry) => normalizeOptionalString(entry).slice(0, 500))
        .filter(Boolean)
        .slice(0, 12);
      const stance = normalizeOptionalString(memory.stance).slice(0, 800);
      if (!summary && commitments.length === 0 && !stance) return null;
      return [identity, {
        commitments,
        stance,
        summary,
        throughMessageCount: Math.max(0, Number(memory.throughMessageCount) || 0),
        updatedAt: normalizeOptionalString(memory.updatedAt),
      }];
    })
    .filter(Boolean),
);

export const normalizeChatEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const countries = normalizeArray(entry.countries || entry.participants)
    .map((country) => normalizeChatCountry(country))
    .filter(Boolean);
  const figures = normalizeArray(entry.figures || entry.people || entry.keyFigures)
    .map((figure) => normalizeChatFigure(figure))
    .filter(Boolean);
  if (countries.length === 0 && figures.length === 0) return null;

  return {
    countries,
    figures,
    id: normalizeOptionalString(entry.id) || generateId(`chat-${index}`),
    linkedEventId: normalizeOptionalString(entry.linkedEventId || entry.eventId),
    memories: normalizeChatMemories(entry.memories || entry.countryMemories),
    messages: normalizeArray(entry.messages)
      .map((message, messageIndex) => normalizeChatMessage(message, messageIndex))
      .filter(Boolean),
    source: normalizeOptionalString(entry.source) || "manual",
    status: normalizeOptionalString(entry.status) || "open",
    title: normalizeOptionalString(entry.title),
    mode: normalizeOptionalString(entry.mode) || (figures.length > 0 ? "council" : "diplomatic"),
    meetingMode: normalizeOptionalString(entry.meetingMode || entry.contactMode).toLowerCase() || (figures.length > 0 ? "cabinet" : ""),
    agenda: normalizeOptionalString(entry.agenda || entry.topic),
  };
};

export const normalizeChats = (chats) =>
  normalizeArray(chats)
    .map((entry, index) => normalizeChatEntry(entry, index))
    .filter(Boolean);

const normalizeRegionTransfer = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const regionId = normalizeOptionalString(entry.regionId || entry.id || entry.gid || entry.GID_1);
  // Owners are stored as the FULL COUNTRY NAME. This value is written straight into
  // world.regionOwnershipOverrides, so a model that answered "ESP" out of habit would
  // otherwise mint a phantom country that paints and labels itself beside the real
  // Spain. Canonicalise on the way in, once, rather than papering over it at render.
  const toCode = toCountryName(normalizeOptionalString(entry.toCode || entry.toPolity || entry.ownerCode || entry.owner));
  const fromCode = toCountryName(normalizeOptionalString(entry.fromCode || entry.fromPolity));

  if (!regionId || !toCode) {
    return null;
  }

  return {
    fromCode,
    note: normalizeOptionalString(entry.note || entry.reason),
    regionId,
    regionName: normalizeOptionalString(entry.regionName || entry.name),
    toCode,
  };
};

const normalizePolityChange = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const code = toCountryName(normalizeOptionalString(entry.code || entry.id || entry.polityCode));
  if (!code) {
    return null;
  }

  const rawReputation = Number(entry.reputation ?? entry.internationalReputation);
  const reputation = Number.isFinite(rawReputation)
    ? Math.max(0, Math.min(100, Math.round(rawReputation)))
    : null;

  // The AI sends the complete new list, so an empty array is meaningful ("this
  // country no longer has defining tags") while undefined means "unchanged" —
  // null keeps those distinguishable for the apply step below.
  const tags = Array.isArray(entry.tags || entry.countryTags)
    ? normalizeTagList(entry.tags || entry.countryTags)
    : null;

  // Persistent stat-sheet update: keep the partial object as-is (the merge + the Stats
  // pane tolerate missing/extra fields); null means "no stat change this period".
  const stats = entry.stats && typeof entry.stats === "object" && !Array.isArray(entry.stats)
    ? entry.stats
    : null;

  return {
    aliases: normalizeActionParticipants(entry.aliases || entry.additionalNames),
    code,
    color: normalizeOptionalString(entry.color),
    name: normalizeOptionalString(entry.name || entry.newName),
    note: normalizeOptionalString(entry.note || entry.reason),
    reputation,
    stats,
    tags,
  };
};

export const normalizeUnitEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
  const lat = finiteOrNull(entry.lat ?? entry.latitude);
  // Full country name, never a code — same identity everywhere (see ownerNames.js).
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code));
  if (lng === null || lat === null || (lng === 0 && lat === 0) || !ownerCode) {
    return null;
  }

  const type = normalizeOptionalString(entry.type).toLowerCase();
  const status = normalizeOptionalString(entry.status).toLowerCase();
  const source = normalizeOptionalString(entry.source).toLowerCase();
  const timestamp = new Date().toISOString();

  return {
    id: normalizeOptionalString(entry.id) || generateId(`unit-${index}`),
    name: normalizeOptionalString(entry.name) || "Unit",
    type: UNIT_TYPE_SET.has(type) ? type : "infantry",
    ownerCode,
    strength: clampUnitStrength(entry.strength ?? 100),
    lng,
    lat,
    regionId: normalizeOptionalString(entry.regionId),
    sectorId: normalizeOptionalString(entry.sectorId || entry.frontId),
    status: UNIT_STATUS_SET.has(status) ? status : "idle",
    note: normalizeOptionalString(entry.note),
    source: UNIT_SOURCE_SET.has(source) ? source : "scenario",
    orderId: normalizeOptionalString(entry.orderId),
    createdAt: normalizeOptionalString(entry.createdAt) || timestamp,
    updatedAt: normalizeOptionalString(entry.updatedAt) || timestamp,
  };
};

export const normalizeUnits = (units) =>
  normalizeArray(units)
    .map((entry, index) => normalizeUnitEntry(entry, index))
    .filter(Boolean);

const normalizeForceTargetList = (value) => normalizeArray(value)
  .map((entry) => normalizeOptionalString(entry))
  .filter(Boolean)
  .filter((entry, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === entry.toLowerCase()) === index);

const normalizeForceDestination = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lng = finiteOrNull(value.lng ?? value.lon ?? value.longitude);
  const lat = finiteOrNull(value.lat ?? value.latitude);
  if (lng === null || lat === null || (lng === 0 && lat === 0)) return null;
  return {
    lat,
    lng,
    regionId: normalizeOptionalString(value.regionId || value.region || value.regionName),
    sectorId: normalizeOptionalString(value.sectorId || value.frontId),
  };
};

// A forceOp is a quantified order, not another piece of prose. It lets the AI
// say "withdraw every German unit from these regions" once; the engine expands
// that scope against the complete order of battle, so omitting the fourth unit
// from a hand-written unitOps list cannot create a half-executed withdrawal.
export const normalizeForceOp = (entry, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const op = normalizeOptionalString(entry.op || entry.action).toLowerCase();
  if (!["withdraw", "redeploy"].includes(op)) return null;
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.polity));
  const unitIds = normalizeForceTargetList(entry.unitIds || entry.units);
  const regionIds = normalizeForceTargetList(entry.regionIds || entry.regions || entry.fromRegions);
  const sectorIds = normalizeForceTargetList(entry.sectorIds || entry.sectors || entry.fromSectors);
  const all = entry.all === true;
  // Normalized operations carry `destination: null` when no destination was
  // supplied. Treat that canonical null as omission so applying the normalizer
  // twice remains safe; reject only a destination that was actually provided
  // and could not be parsed.
  const hasDestination = (entry.destination !== undefined && entry.destination !== null)
    || (entry.to !== undefined && entry.to !== null);
  const destination = normalizeForceDestination(entry.destination || entry.to);
  if (hasDestination && !destination) return null;
  if (!ownerCode || (!all && unitIds.length === 0 && regionIds.length === 0 && sectorIds.length === 0)) return null;
  return {
    all,
    destination,
    id: normalizeOptionalString(entry.id || entry.orderId) || generateId(`force-${index}`),
    note: normalizeOptionalString(entry.note || entry.reason),
    op,
    ownerCode,
    regionIds,
    sectorIds,
    unitIds,
  };
};

export const normalizeForceOps = (ops) =>
  normalizeArray(ops).map((entry, index) => normalizeForceOp(entry, index)).filter(Boolean);

export const applyForceOps = (units, ops) => {
  let next = normalizeUnits(units);
  for (const operation of normalizeForceOps(ops)) {
    const unitIds = new Set(operation.unitIds);
    const regionIds = new Set(operation.regionIds.map((value) => value.toLowerCase()));
    const sectorIds = new Set(operation.sectorIds.map((value) => value.toLowerCase()));
    next = next.map((unit) => {
      if (unit.ownerCode.toLowerCase() !== operation.ownerCode.toLowerCase()) return unit;
      const inScope = operation.all
        || unitIds.has(unit.id)
        || regionIds.has(unit.regionId.toLowerCase())
        || sectorIds.has(unit.sectorId.toLowerCase());
      if (!inScope) return unit;
      const destination = operation.destination;
      return {
        ...unit,
        ...(destination ? {
          lat: destination.lat,
          lng: destination.lng,
          ...(destination.regionId ? { regionId: destination.regionId } : {}),
          ...(destination.sectorId ? { sectorId: destination.sectorId } : {}),
        } : {}),
        note: operation.note || `${operation.op === "withdraw" ? "Withdrawal" : "Redeployment"} order ${operation.id}`,
        orderId: operation.id,
        status: "moving",
        updatedAt: new Date().toISOString(),
      };
    });
  }
  return next;
};

const CONTROL_SECTOR_STATUS_SET = new Set([
  "assault",
  "contested",
  "encircled",
  "held",
  "withdrawn",
  "destroyed",
]);

const TACTICAL_CELL_LAYOUT = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [0, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const normalizeContestedBy = (value, ownerCode) => normalizeArray(
  Array.isArray(value) ? value : [value],
)
  .map((candidate) => toCountryName(normalizeOptionalString(candidate)))
  .filter(Boolean)
  .filter((candidate, candidateIndex, values) => values.findIndex((value) => value.toLowerCase() === candidate.toLowerCase()) === candidateIndex)
  .filter((candidate) => candidate.toLowerCase() !== ownerCode.toLowerCase());

const roundCoordinate = (value) => Math.round(value * 1000000) / 1000000;

const buildGeneratedControlCells = (sector) => {
  const safeLat = Math.max(-84, Math.min(84, sector.center.lat));
  // Leave enough separation for the 3x3 grid to read as local ground instead
  // of nine heavily-overlapping discs merging into one long capsule.
  const offsetKm = Math.max(0.25, sector.radiusKm * 0.5);
  const cellRadiusKm = Math.max(0.5, Math.min(20, sector.radiusKm * 0.3));
  const latStep = offsetKm / 111.32;
  const lngStep = offsetKm / (111.32 * Math.max(0.08, Math.cos((safeLat * Math.PI) / 180)));
  return TACTICAL_CELL_LAYOUT.map(([x, y], cellIndex) => ({
    id: `${sector.id}-cell-${String(cellIndex + 1).padStart(2, "0")}`,
    depth: 1,
    ownerCode: sector.ownerCode,
    ...(sector.contestedBy ? { contestedBy: sector.contestedBy } : {}),
    control: sector.control,
    center: {
      lng: roundCoordinate(Math.max(-180, Math.min(180, sector.center.lng + x * lngStep))),
      lat: roundCoordinate(Math.max(-84, Math.min(84, safeLat + y * latStep))),
    },
    radiusKm: Math.round(cellRadiusKm * 10) / 10,
    status: sector.status,
    ...(sector.note ? { note: sector.note } : {}),
  }));
};

const normalizeControlSectorCellEntry = (entry, parent, index = 0) => {
  if (!entry || typeof entry !== "object") return null;
  const center = entry.center && typeof entry.center === "object" ? entry.center : entry;
  const lng = finiteOrNull(center.lng ?? center.lon ?? center.longitude);
  const lat = finiteOrNull(center.lat ?? center.latitude);
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.controller)) || parent.ownerCode;
  if (
    lng === null ||
    lat === null ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90 ||
    (lng === 0 && lat === 0) ||
    !ownerCode
  ) return null;

  const rawControl = Number(entry.control ?? entry.controlPercent ?? entry.percent ?? parent.control);
  const rawRadius = Number(entry.radiusKm ?? entry.radius ?? Math.max(0.5, parent.radiusKm * 0.42));
  const control = Number.isFinite(rawControl) ? Math.max(0, Math.min(100, Math.round(rawControl))) : parent.control;
  const radiusKm = Number.isFinite(rawRadius) ? Math.max(0.5, Math.min(20, rawRadius)) : Math.max(0.5, parent.radiusKm * 0.42);
  const contestedBy = normalizeContestedBy(entry.contestedBy ?? entry.opponent ?? entry.attacker ?? parent.contestedBy, ownerCode);
  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();

  return {
    id: normalizeOptionalString(entry.id) || `${parent.id}-cell-${String(index + 1).padStart(2, "0")}`,
    depth: Number.isFinite(Number(entry.depth)) ? Math.max(1, Math.trunc(Number(entry.depth))) : undefined,
    name: normalizeOptionalString(entry.name || entry.title || entry.label),
    parentCellId: normalizeOptionalString(entry.parentCellId || entry.parentId),
    ownerCode,
    ...(contestedBy.length > 0 ? { contestedBy: contestedBy.length === 1 ? contestedBy[0] : contestedBy } : {}),
    control,
    center: { lng, lat },
    radiusKm: Math.round(radiusKm * 10) / 10,
    status: CONTROL_SECTOR_STATUS_SET.has(rawStatus)
      ? rawStatus
      : contestedBy.length > 0 || control < 100
        ? "contested"
        : parent.status,
    note: normalizeOptionalString(entry.note || entry.description),
  };
};

const normalizeCellHierarchy = (cells, sectorId) => {
  const unique = [];
  const seen = new Set();
  for (const cell of normalizeArray(cells)) {
    if (!cell?.id || seen.has(cell.id)) continue;
    seen.add(cell.id);
    unique.push(cell);
  }
  const byId = new Map(unique.map((cell) => [cell.id, cell]));
  const depthCache = new Map();
  const visiting = new Set();
  const depthOf = (cell) => {
    if (depthCache.has(cell.id)) return depthCache.get(cell.id);
    if (visiting.has(cell.id)) return null;
    visiting.add(cell.id);
    const parentId = normalizeOptionalString(cell.parentCellId);
    const depth = parentId
      ? byId.has(parentId)
        ? depthOf(byId.get(parentId))
        : null
      : 1;
    visiting.delete(cell.id);
    if (depth === null || depth > CONTROL_CELL_MAX_DEPTH) return null;
    const nextDepth = parentId ? depth + 1 : 1;
    if (nextDepth > CONTROL_CELL_MAX_DEPTH) return null;
    depthCache.set(cell.id, nextDepth);
    return nextDepth;
  };

  return unique
    .map((cell) => {
      const depth = depthOf(cell);
      if (!depth) return null;
      return {
        ...cell,
        depth,
        cellRef: `${sectorId}:${cell.id}`,
        ...(cell.parentCellId ? { parentCellId: cell.parentCellId } : {}),
      };
    })
    .filter(Boolean);
};

const normalizeControlSectorCellOp = (entry, parent, index = 0) => {
  if (!entry || typeof entry !== "object") return null;
  const op = normalizeOptionalString(entry.op).toLowerCase();
  if (["upsert", "update", "set"].includes(op)) {
    const rawCell = entry.cell ?? entry;
    const id = normalizeOptionalString(rawCell.id || entry.id || entry.cellId);
    if (!id) return null;
    const cell = normalizeControlSectorCellEntry({ ...rawCell, id }, parent, index);
    return cell ? { op: "upsert", cell } : null;
  }
  if (op === "remove" || op === "clear") {
    const id = normalizeOptionalString(entry.id || entry.cellId);
    return id ? { op: "remove", id } : null;
  }
  return null;
};

const normalizeControlSectorEntry = (entry, index = 0, { generateCells = true } = {}) => {
  if (!entry || typeof entry !== "object") return null;

  const center = entry.center && typeof entry.center === "object" ? entry.center : entry;
  const lng = finiteOrNull(center.lng ?? center.lon ?? center.longitude);
  const lat = finiteOrNull(center.lat ?? center.latitude);
  const regionId = normalizeOptionalString(entry.regionId || entry.region || entry.regionName);
  const name = normalizeOptionalString(entry.name || entry.title || entry.label);
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.controller));
  if (
    !regionId ||
    !name ||
    !ownerCode ||
    lng === null ||
    lat === null ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90 ||
    (lng === 0 && lat === 0)
  ) return null;

  const rawControl = Number(entry.control ?? entry.controlPercent ?? entry.percent ?? 0);
  const rawRadius = Number(entry.radiusKm ?? entry.radius ?? 8);
  const control = Number.isFinite(rawControl) ? Math.max(0, Math.min(100, Math.round(rawControl))) : 0;
  const radiusKm = Number.isFinite(rawRadius) ? Math.max(0.5, Math.min(80, rawRadius)) : 8;
  const contestedBy = normalizeContestedBy(
    entry.contestedBy || entry.opponent || entry.attacker,
    ownerCode,
  );
  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();
  const rawFrontOrigin = entry.frontOrigin && typeof entry.frontOrigin === "object"
    ? entry.frontOrigin
    : null;
  const frontOriginLng = finiteOrNull(rawFrontOrigin?.lng ?? rawFrontOrigin?.lon ?? rawFrontOrigin?.longitude);
  const frontOriginLat = finiteOrNull(rawFrontOrigin?.lat ?? rawFrontOrigin?.latitude);
  const frontOrigin = frontOriginLng !== null && frontOriginLat !== null
    && frontOriginLng >= -180 && frontOriginLng <= 180
    && frontOriginLat >= -90 && frontOriginLat <= 90
    ? { lng: frontOriginLng, lat: frontOriginLat }
    : undefined;
  const rawFrontWidthKm = Number(entry.frontWidthKm);
  const rawAdvanceDepthKm = Number(entry.advanceDepthKm);

  const sector = {
    id: normalizeOptionalString(entry.id) || generateId(`sector-${index}`),
    regionId,
    name,
    ownerCode,
    ...(contestedBy.length > 0 ? { contestedBy: contestedBy.length === 1 ? contestedBy[0] : contestedBy } : {}),
    control,
    center: { lng, lat },
    frontOrigin,
    frontBearing: Number.isFinite(Number(entry.frontBearing ?? entry.bearingDeg))
      ? ((Number(entry.frontBearing ?? entry.bearingDeg) % 360) + 360) % 360
      : undefined,
    frontWidthKm: Number.isFinite(rawFrontWidthKm)
      ? Math.round(Math.max(2, Math.min(60, rawFrontWidthKm)) * 10) / 10
      : undefined,
    advanceDepthKm: Number.isFinite(rawAdvanceDepthKm)
      ? Math.round(Math.max(2, Math.min(160, rawAdvanceDepthKm)) * 10) / 10
      : undefined,
    radiusKm: Math.round(radiusKm * 10) / 10,
    status: CONTROL_SECTOR_STATUS_SET.has(rawStatus)
      ? rawStatus
      : contestedBy.length > 0 || control < 100
        ? "contested"
        : "held",
    battleId: normalizeOptionalString(entry.battleId || entry.frontId),
    startedAt: normalizeOptionalString(entry.startedAt || entry.startDate),
    updatedAt: normalizeOptionalString(entry.updatedAt || entry.date),
    note: normalizeOptionalString(entry.note || entry.description),
  };

  const rawCells = Array.isArray(entry.cells) ? entry.cells : [];
  const cells = rawCells.length > 0
    ? rawCells.map((cell, cellIndex) => normalizeControlSectorCellEntry(cell, sector, cellIndex)).filter(Boolean)
    : generateCells ? buildGeneratedControlCells(sector) : [];
  const normalizedCells = normalizeCellHierarchy(cells, sector.id);
  const parentIds = new Set(normalizedCells.map((cell) => cell.parentCellId).filter(Boolean));
  const leaves = normalizedCells.filter((cell) => !parentIds.has(cell.id));
  // Individual leaf cells are authoritative. Recompute the sector summary after
  // a cellOp so a captured approach immediately changes the displayed/prompted
  // sector percentage even if the model repeated a stale parent value.
  const weightTotal = leaves.reduce((sum, cell) => sum + Math.max(0.25, cell.radiusKm ** 2), 0);
  const summarizedControl = weightTotal > 0
    ? Math.round(leaves.reduce((sum, cell) => sum + cell.control * Math.max(0.25, cell.radiusKm ** 2), 0) / weightTotal)
    : sector.control;
  const hasContestedLeaf = leaves.some((cell) => cell.contestedBy || ["assault", "contested", "encircled"].includes(cell.status));
  return {
    ...sector,
    control: summarizedControl,
    status: ["withdrawn", "destroyed"].includes(sector.status)
      ? sector.status
      : hasContestedLeaf || summarizedControl < 100
        ? ["assault", "encircled"].includes(sector.status) ? sector.status : "contested"
        : "held",
    cells: normalizedCells,
  };
};

export const normalizeControlSectors = (sectors) =>
  normalizeArray(sectors)
    .map((entry, index) => normalizeControlSectorEntry(entry, index))
    .filter(Boolean);

export const normalizeSectorOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const op = normalizeOptionalString(entry.op).toLowerCase();
  if (["upsert", "update", "set"].includes(op)) {
    const rawSector = entry.sector ?? entry;
    if (!normalizeOptionalString(rawSector.id || entry.id || entry.sectorId)) return null;
    const sector = normalizeControlSectorEntry(rawSector, 0, { generateCells: false });
    if (!sector) return null;
    const rawCellOps = Array.isArray(rawSector.cellOps)
      ? rawSector.cellOps
      : Array.isArray(entry.cellOps) ? entry.cellOps : [];
    const cellOps = rawCellOps
      .map((cellOp, cellIndex) => normalizeControlSectorCellOp(cellOp, sector, cellIndex))
      .filter(Boolean);
    return cellOps.length > 0 ? { op: "upsert", sector, cellOps } : { op: "upsert", sector };
  }
  if (op === "remove" || op === "clear") {
    const id = normalizeOptionalString(entry.id || entry.sectorId);
    return id ? { op: "remove", id } : null;
  }
  return null;
};

export const applySectorOps = (sectors, ops) => {
  let next = normalizeControlSectors(sectors);
  for (const raw of normalizeArray(ops)) {
    const op = normalizeSectorOp(raw);
    if (!op) continue;
    if (op.op === "upsert") {
      const previous = next.find((sector) => sector.id === op.sector.id);
      const baseCells = op.sector.cells.length > 0
        ? op.sector.cells
        : previous?.cells?.length > 0
          ? previous.cells
          : buildGeneratedControlCells(op.sector);
      let cells = [...baseCells];
      for (const cellOp of op.cellOps || []) {
        if (cellOp.op === "upsert") {
          const cellIndex = cells.findIndex((cell) => cell.id === cellOp.cell.id);
          cells = cellIndex < 0
            ? [...cells, cellOp.cell]
            : cells.map((cell, index) => (index === cellIndex ? cellOp.cell : cell));
        } else if (cellOp.op === "remove") {
          const removedIds = new Set([cellOp.id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const cell of cells) {
              if (cell.parentCellId && removedIds.has(cell.parentCellId) && !removedIds.has(cell.id)) {
                removedIds.add(cell.id);
                changed = true;
              }
            }
          }
          cells = cells.filter((cell) => !removedIds.has(cell.id));
        }
      }
      const mergedSector = normalizeControlSectorEntry({ ...op.sector, cells }, 0, { generateCells: false });
      if (mergedSector) {
        next = [...next.filter((sector) => sector.id !== op.sector.id), mergedSector];
      }
    } else if (op.op === "remove") {
      next = next.filter((sector) => sector.id !== op.id);
    }
  }
  return next;
};

const normalizeCellReference = (value) => {
  if (value && typeof value === "object") {
    const sectorId = normalizeOptionalString(value.sectorId || value.sector || value.parentSectorId);
    const cellId = normalizeOptionalString(value.cellId || value.id);
    return sectorId && cellId ? `${sectorId}:${cellId}` : "";
  }
  return normalizeOptionalString(value).replace(/\s+/g, "");
};

const normalizeTerritoryFragmentEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const id = normalizeOptionalString(entry.id || entry.fragmentId) || generateId(`fragment-${index}`);
  const parentRegionId = normalizeOptionalString(entry.parentRegionId || entry.regionId || entry.parentRegion);
  const name = normalizeOptionalString(entry.name || entry.title || entry.label);
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.controller));
  const cellRefs = normalizeArray(entry.cellRefs || entry.cells)
    .map(normalizeCellReference)
    .filter(Boolean)
    .filter((ref, refIndex, refs) => refs.indexOf(ref) === refIndex)
    .slice(0, 256);
  if (!parentRegionId || !name || !ownerCode || cellRefs.length === 0) return null;
  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();
  return {
    id,
    name,
    parentRegionId,
    ownerCode,
    cellRefs,
    kind: normalizeOptionalString(entry.kind || entry.type) || "subregion",
    status: TERRITORY_FRAGMENT_STATUS_SET.has(rawStatus) ? rawStatus : "active",
    note: normalizeOptionalString(entry.note || entry.description),
    foundedAt: normalizeOptionalString(entry.foundedAt || entry.date),
  };
};

export const normalizeTerritoryFragments = (fragments) =>
  normalizeArray(fragments)
    .map((entry, index) => normalizeTerritoryFragmentEntry(entry, index))
    .filter(Boolean);

const normalizeTerritoryOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const op = normalizeOptionalString(entry.op).toLowerCase();
  if (["create", "upsert", "update", "split"].includes(op)) {
    const fragment = normalizeTerritoryFragmentEntry(entry.fragment ?? entry, 0);
    return fragment ? { op: "upsert", fragment } : null;
  }
  if (["remove", "dissolve", "abolish"].includes(op)) {
    const id = normalizeOptionalString(entry.id || entry.fragmentId);
    return id ? { op: "remove", id } : null;
  }
  return null;
};

export const normalizeTerritoryOps = (ops) =>
  normalizeArray(ops).map(normalizeTerritoryOp).filter(Boolean);

export const applyTerritoryOps = (fragments, ops) => {
  let next = normalizeTerritoryFragments(fragments);
  for (const raw of normalizeArray(ops)) {
    const op = normalizeTerritoryOp(raw);
    if (!op) continue;
    if (op.op === "upsert") {
      next = [...next.filter((fragment) => fragment.id !== op.fragment.id), op.fragment];
    } else if (op.op === "remove") {
      next = next.filter((fragment) => fragment.id !== op.id);
    }
  }
  return next;
};

// A structure built during play: any named point on the map — city, military
// base, bunker, missile silo, embassy, port. `kind` is deliberately free-form
// (lowercased for stable styling/grouping); unknown kinds are first-class.
export const normalizeMarkerEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
  const lat = finiteOrNull(entry.lat ?? entry.latitude);
  const name = normalizeOptionalString(entry.name || entry.title);
  if (lng === null || lat === null || (lng === 0 && lat === 0) || !name) {
    return null;
  }

  const source = normalizeOptionalString(entry.source).toLowerCase();
  const status = normalizeOptionalString(entry.status).toLowerCase();
  return {
    id: normalizeOptionalString(entry.id) || generateId(`marker-${index}`),
    name,
    kind: (normalizeOptionalString(entry.kind || entry.type) || "landmark").toLowerCase(),
    ownerCode: toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code)),
    lng,
    lat,
    note: normalizeOptionalString(entry.note || entry.description),
    foundedAt: normalizeOptionalString(entry.foundedAt || entry.date),
    source: MARKER_SOURCE_SET.has(source) ? source : "ai",
    status: MARKER_STATUS_SET.has(status) ? status : source === "player" ? "pending" : "active",
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
  };
};

export const normalizeMarkers = (markers) =>
  normalizeArray(markers)
    .map((entry, index) => normalizeMarkerEntry(entry, index))
    .filter(Boolean);

const normalizeReserveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

const normalizeReserveMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, amount]) => [normalizeOptionalString(key), normalizeReserveNumber(amount)])
      .filter(([key]) => key),
  );
};

export const normalizeReserveSheet = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const reportedInput = entry.reported && typeof entry.reported === "object" && !Array.isArray(entry.reported)
    ? entry.reported
    : null;
  const has = (...keys) => keys.some((key) => Object.prototype.hasOwnProperty.call(entry, key));
  const reportedField = (key, ...valueKeys) => {
    // An explicit false always means UNKNOWN. An explicit true still needs a
    // value in the sheet; otherwise a partial report would turn an omitted
    // field into a spendable zero on the next normalization pass.
    if (reportedInput?.[key] === false) return false;
    return has(...valueKeys);
  };
  const reported = {
    // Legacy reserve sheets predate per-field provenance. Treat their existing
    // scalar/map fields as authoritative, while omissions remain UNKNOWN.
    manpower: reportedField("manpower", "manpower", "personnel"),
    manpowerCommitted: reportedField("manpowerCommitted", "manpowerCommitted", "committed"),
    equipment: reportedField("equipment", "equipment"),
    munitions: reportedField("munitions", "munitions", "ammunition"),
    fuel: reportedField("fuel", "fuel"),
    supplies: reportedField("supplies", "supplies", "materials"),
    maintenance: reportedField("maintenance", "maintenance", "spareParts"),
  };
  return {
    manpower: normalizeReserveNumber(entry.manpower ?? entry.personnel),
    manpowerCommitted: normalizeReserveNumber(entry.manpowerCommitted ?? entry.committed),
    equipment: normalizeReserveMap(entry.equipment),
    munitions: normalizeReserveMap(entry.munitions ?? entry.ammunition),
    fuel: normalizeReserveNumber(entry.fuel),
    supplies: normalizeReserveNumber(entry.supplies ?? entry.materials),
    maintenance: normalizeReserveNumber(entry.maintenance ?? entry.spareParts),
    reported,
    note: normalizeOptionalString(entry.note || entry.description),
    updatedAt: normalizeOptionalString(entry.updatedAt || entry.date),
  };
};

export const normalizeMilitaryReserves = (reserves) => {
  if (!reserves || typeof reserves !== "object" || Array.isArray(reserves)) return {};
  return Object.fromEntries(
    Object.entries(reserves)
      .map(([owner, sheet]) => [toCountryName(normalizeOptionalString(owner)), normalizeReserveSheet(sheet)])
      .filter(([owner, sheet]) => owner && sheet),
  );
};

const normalizeReserveOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const op = normalizeOptionalString(entry.op).toLowerCase();
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code));
  if (!ownerCode) return null;
  if (["set", "update", "report"].includes(op)) {
    const sheet = normalizeReserveSheet(entry.reserves ?? entry.sheet ?? entry);
    return sheet ? { op: "set", ownerCode, sheet } : null;
  }
  if (op === "clear" || op === "remove") return { op: "clear", ownerCode };
  return null;
};

export const normalizeReserveOps = (ops) =>
  normalizeArray(ops).map(normalizeReserveOp).filter(Boolean);

export const applyReserveOps = (reserves, ops) => {
  const next = normalizeMilitaryReserves(reserves);
  for (const raw of normalizeArray(ops)) {
    const op = normalizeReserveOp(raw);
    if (!op) continue;
    if (op.op === "set") next[op.ownerCode] = op.sheet;
    if (op.op === "clear") delete next[op.ownerCode];
  }
  return next;
};

const RESOURCE_NAMES = new Set([
  "manpower",
  "manpowerCommitted",
  "equipment",
  "munitions",
  "fuel",
  "supplies",
  "maintenance",
]);

const RESOURCE_ALIASES = {
  ammo: "munitions",
  ammunition: "munitions",
  material: "supplies",
  materials: "supplies",
  personnel: "manpower",
  spareparts: "maintenance",
  soldiers: "manpower",
};

const normalizeResourceName = (value) => {
  const raw = normalizeOptionalString(value).replace(/[\s_-]+/g, "").toLowerCase();
  if (raw === "manpowercommitted" || raw === "committedmanpower") return "manpowerCommitted";
  const alias = RESOURCE_ALIASES[raw] || raw;
  return RESOURCE_NAMES.has(alias) ? alias : "";
};

const normalizeResourceAmount = (value, { allowZero = false } = {}) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount);
  if (rounded < 0 || (!allowZero && rounded === 0)) return null;
  return rounded;
};

// A resource operation is deliberately narrower than a prose ledger entry. It
// is the only operation allowed to change a reported stockpile incrementally;
// absolute reserveOps remain available when a new intelligence report replaces
// the whole sheet.
export const normalizeResourceOp = (entry, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const op = normalizeOptionalString(entry.op || entry.action).toLowerCase();
  if (!["consume", "produce", "set"].includes(op)) return null;
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.polity));
  const resource = normalizeResourceName(entry.resource || entry.kind || entry.bucket);
  const item = normalizeOptionalString(entry.item || entry.itemId || entry.asset || entry.equipmentType);
  const amount = normalizeResourceAmount(entry.amount ?? entry.quantity ?? entry.value, { allowZero: op === "set" });
  if (!ownerCode || !resource || amount === null) return null;
  if (["equipment", "munitions"].includes(resource) && !item) return null;
  return {
    id: normalizeOptionalString(entry.id || entry.transactionId) || generateId(`resource-${index}`),
    amount,
    date: normalizeOptionalString(entry.date),
    item,
    note: normalizeOptionalString(entry.note || entry.reason),
    op,
    ownerCode,
    resource,
  };
};

export const normalizeResourceOps = (ops) =>
  normalizeArray(ops).map((entry, index) => normalizeResourceOp(entry, index)).filter(Boolean);

const resourceIsReported = (sheet, resource) => sheet?.reported?.[resource] !== false;

const updateResourceValue = (sheet, resource, item, value) => {
  if (["equipment", "munitions"].includes(resource)) {
    return {
      ...sheet,
      [resource]: { ...(sheet[resource] || {}), [item]: value },
      reported: { ...(sheet.reported || {}), [resource]: true },
    };
  }
  return {
    ...sheet,
    [resource]: value,
    reported: { ...(sheet.reported || {}), [resource]: true },
  };
};

const readResourceValue = (sheet, resource, item) => {
  if (!resourceIsReported(sheet, resource)) return null;
  if (["equipment", "munitions"].includes(resource)) {
    if (!Object.prototype.hasOwnProperty.call(sheet?.[resource] || {}, item)) return null;
    return Number(sheet[resource][item]);
  }
  return Number(sheet?.[resource]);
};

// Apply incremental resource changes without ever manufacturing a starting
// balance. The caller receives rejected operations so the AI validator can ask
// for a real reserve report instead of silently clamping a shortage to zero.
export const applyResourceOps = (reserves, ops) => {
  let next = normalizeMilitaryReserves(reserves);
  const applied = [];
  const rejected = [];

  for (const operation of normalizeResourceOps(ops)) {
    const sheet = next[operation.ownerCode];
    const mapResource = ["equipment", "munitions"].includes(operation.resource);
    const currentValue = readResourceValue(sheet, operation.resource, operation.item);
    const current = currentValue === null && operation.op === "produce" && mapResource && resourceIsReported(sheet, operation.resource)
      ? 0
      : currentValue;
    if (!sheet || current === null || !Number.isFinite(current)) {
      rejected.push({ operation, reason: "the starting balance is unknown" });
      continue;
    }

    const nextValue = operation.op === "set"
      ? operation.amount
      : operation.op === "produce"
        ? current + operation.amount
        : current - operation.amount;
    if (nextValue < 0) {
      rejected.push({ operation, reason: `insufficient ${operation.resource}${operation.item ? `/${operation.item}` : ""} (have ${current}, need ${operation.amount})` });
      continue;
    }

    next[operation.ownerCode] = updateResourceValue(
      sheet,
      operation.resource,
      operation.item,
      nextValue,
    );
    applied.push(operation);
  }

  return { applied, rejected, reserves: next };
};

export const normalizeResourceLedger = (entries) => normalizeArray(entries)
  .map((entry, index) => {
    const operation = normalizeResourceOp(entry, index);
    if (!operation) return null;
    return {
      ...operation,
      signedAmount: operation.op === "consume" ? -operation.amount : operation.amount,
    };
  })
  .filter(Boolean);

const KEY_FIGURE_STATUS_SET = new Set([
  "active",
  "deceased",
  "exiled",
  "imprisoned",
  "retired",
  "missing",
  "unknown",
]);
const KEY_FIGURE_BRAIN_MODE_SET = new Set(["off", "light", "full"]);
const KEY_FIGURE_BRAIN_STATUS_SET = new Set(["active", "paused", "dormant", "retired"]);
const KEY_FIGURE_MEETING_MODE_SET = new Set(["cabinet", "secure-channel", "correspondence"]);
const KEY_FIGURE_MEETING_ACCESS_SET = new Set(["normal", "restricted", "granted", "impossible"]);
export const KEY_FIGURE_FULL_BRAIN_LIMIT = 8;
const MILITARY_INDUSTRY_SECTIONS = ["arsenal", "research", "production", "ledger"];
const MILITARY_INDUSTRY_SECTION_SET = new Set(MILITARY_INDUSTRY_SECTIONS);

const normalizeEntityId = (value, fallback, index = 0) => {
  const explicit = normalizeOptionalString(value);
  if (explicit) return explicit;
  const name = normalizeOptionalString(fallback)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return name ? `${name}` : `${name || "entry"}-${index + 1}`;
};

const normalizeFigureListInput = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  // Accept both the current list form and the useful legacy map form:
  // {"figure-id": {name: "..."}}.
  const entryKeys = new Set([
    "id", "figureId", "name", "fullName", "title", "role", "position", "polity",
    "ownerCode", "country", "status", "influence", "note", "description",
  ]);
  if (Object.keys(value).some((key) => entryKeys.has(key))) return [value];
  return Object.entries(value).map(([id, entry]) =>
    entry && typeof entry === "object" ? { ...entry, id: entry.id ?? id } : { id, name: entry },
  );
};

export const normalizeKeyFigureEntry = (entry, index = 0, { allowMissingName = false } = {}) => {
  if (typeof entry === "string") {
    const name = normalizeString(entry);
    return name ? {
      id: name,
      name,
      role: "",
      ownerCode: "",
      polity: "",
      status: "active",
      brainMode: "off",
      brainEnabled: false,
      brainStatus: "dormant",
      meetingModes: ["secure-channel", "correspondence"],
      meetingAccess: "normal",
      influence: 0,
      loyalty: 0,
      aliases: [],
      note: "",
      updatedAt: "",
    } : null;
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const name = normalizeOptionalString(entry.name || entry.fullName || entry.title || entry.person);
  const explicitId = normalizeOptionalString(entry.id || entry.figureId || entry.personId || entry.slug);
  const id = explicitId || (name ? normalizeEntityId("", name, index) : "");
  if (!name && !allowMissingName) return null;
  const rawInfluence = Number(entry.influence ?? entry.weight ?? entry.power);
  const rawLoyalty = Number(entry.loyalty ?? entry.loyaltyScore);
  const status = normalizeOptionalString(entry.status).toLowerCase();
  const rawBrainMode = normalizeOptionalString(entry.brainMode || entry.personalityMode || entry.brain).toLowerCase();
  const brainMode = KEY_FIGURE_BRAIN_MODE_SET.has(rawBrainMode)
    ? rawBrainMode
    : entry.brainEnabled === true
      ? "full"
      : "off";
  const rawBrainStatus = normalizeOptionalString(entry.brainStatus).toLowerCase();
  const brainStatus = KEY_FIGURE_BRAIN_STATUS_SET.has(rawBrainStatus)
    ? rawBrainStatus
    : brainMode === "off" ? "dormant" : "active";
  const meetingModes = normalizeArray(entry.meetingModes || entry.contactModes)
    .map((mode) => normalizeOptionalString(mode).toLowerCase())
    .map((mode) => mode === "in-person" ? "cabinet" : mode)
    .filter((mode, modeIndex, values) => KEY_FIGURE_MEETING_MODE_SET.has(mode) && values.indexOf(mode) === modeIndex);
  const meetingAccess = normalizeOptionalString(entry.meetingAccess || entry.access).toLowerCase();
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.polity || entry.country || entry.countryName));
  const figure = {
    ...cloneValue(entry),
    id,
    name: name || id,
    role: normalizeOptionalString(entry.role || entry.position || entry.office),
    ownerCode,
    polity: ownerCode,
    status: KEY_FIGURE_STATUS_SET.has(status) ? status : status || "active",
    brainMode,
    brainEnabled: brainMode !== "off",
    brainStatus,
    // Physical presence is never inferred from a person's existence. The Game
    // Master must explicitly add "cabinet" to the contact modes for the current
    // timeline; otherwise only remote channels are available.
    meetingModes: meetingModes.length > 0 ? meetingModes : ["secure-channel", "correspondence"],
    meetingAccess: KEY_FIGURE_MEETING_ACCESS_SET.has(meetingAccess) ? meetingAccess : "normal",
    influence: Number.isFinite(rawInfluence) ? Math.max(0, Math.min(100, Math.round(rawInfluence))) : 0,
    loyalty: Number.isFinite(rawLoyalty) ? Math.max(0, Math.min(100, Math.round(rawLoyalty))) : 0,
    aliases: normalizeActionParticipants(entry.aliases || entry.alsoKnownAs),
    location: normalizeOptionalString(entry.location || entry.base || entry.region),
    birthDate: normalizeOptionalString(entry.birthDate || entry.birth || entry.dateOfBirth || entry.birthYear),
    deathDate: normalizeOptionalString(entry.deathDate || entry.death || entry.dateOfDeath || entry.deathYear),
    note: normalizeOptionalString(entry.note || entry.description),
    updatedAt: normalizeOptionalString(entry.updatedAt || entry.date),
  };
  if (entry.traits !== undefined) figure.traits = normalizeActionParticipants(entry.traits);
  if (entry.goals !== undefined) figure.goals = normalizeActionParticipants(entry.goals);
  if (allowMissingName && !name) {
    delete figure.id;
    delete figure.name;
    if (entry.role === undefined && entry.position === undefined && entry.office === undefined) delete figure.role;
    if (entry.polity === undefined && entry.ownerCode === undefined && entry.country === undefined && entry.countryName === undefined) {
      delete figure.polity;
      delete figure.ownerCode;
    }
    if (entry.status === undefined) delete figure.status;
    if (entry.influence === undefined && entry.weight === undefined && entry.power === undefined) delete figure.influence;
    if (entry.aliases === undefined && entry.alsoKnownAs === undefined) delete figure.aliases;
    if (entry.note === undefined && entry.description === undefined) delete figure.note;
    if (entry.updatedAt === undefined && entry.date === undefined) delete figure.updatedAt;
    if (entry.loyalty === undefined && entry.loyaltyScore === undefined) delete figure.loyalty;
    if (entry.location === undefined && entry.base === undefined && entry.region === undefined) delete figure.location;
    if (entry.brainMode === undefined && entry.personalityMode === undefined && entry.brain === undefined) delete figure.brainMode;
    if (entry.brainEnabled === undefined) delete figure.brainEnabled;
    if (entry.brainStatus === undefined) delete figure.brainStatus;
    if (entry.meetingModes === undefined && entry.contactModes === undefined) delete figure.meetingModes;
    if (entry.meetingAccess === undefined && entry.access === undefined) delete figure.meetingAccess;
    if (entry.birthDate === undefined && entry.birth === undefined && entry.dateOfBirth === undefined && entry.birthYear === undefined) delete figure.birthDate;
    if (entry.deathDate === undefined && entry.death === undefined && entry.dateOfDeath === undefined && entry.deathYear === undefined) delete figure.deathDate;
  }
  return figure;
};

export const normalizeKeyFigures = (figures) => {
  const byId = new Map();
  normalizeFigureListInput(figures).forEach((entry, index) => {
    const figure = normalizeKeyFigureEntry(entry, index);
    if (figure) byId.set(figure.id, figure);
  });
  return [...byId.values()];
};

export const enforceKeyFigureBrainBudget = (figures) => {
  const normalized = normalizeKeyFigures(figures);
  const fullIds = normalized
    .filter((figure) => figure.brainMode === "full" && figure.brainStatus === "active" && figure.status === "active")
    .slice(-KEY_FIGURE_FULL_BRAIN_LIMIT)
    .map((figure) => figure.id);
  const keepFull = new Set(fullIds);
  return normalized.map((figure) => (
    figure.brainMode === "full" && figure.brainStatus === "active" && figure.status === "active" && !keepFull.has(figure.id)
      ? { ...figure, brainMode: "light", brainEnabled: true, brainStatus: "active" }
      : figure
  ));
};

const normalizeKeyFigureOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const rawOp = normalizeOptionalString(entry.op || entry.action).toLowerCase();
  const op = rawOp || "upsert";
  const rawFigure = entry.figure ?? entry.person ?? Object.fromEntries(
    Object.entries(entry).filter(([key]) => !["op", "action"].includes(key)),
  );
  if (["remove", "delete", "clear"].includes(op)) {
    const id = normalizeOptionalString(entry.id || entry.figureId || entry.personId || rawFigure?.id);
    const name = normalizeOptionalString(entry.name || rawFigure?.name);
    if (op === "clear") return { op: "clear", ownerCode: toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.polity)) };
    return id || name ? { op: "remove", id, name } : null;
  }
  if (["create", "set", "upsert", "add"].includes(op)) {
    const figure = normalizeKeyFigureEntry(rawFigure, 0);
    return figure ? { op: "upsert", figure } : null;
  }
  if (["update", "patch"].includes(op)) {
    const patchSource = entry.figure ?? entry.person ?? entry.patch ?? Object.fromEntries(
      Object.entries(entry).filter(([key]) => !["op", "action", "id", "figureId", "name"].includes(key)),
    );
    const id = normalizeOptionalString(entry.id || entry.figureId || entry.personId || patchSource?.id);
    const name = normalizeOptionalString(entry.name || patchSource?.name);
    if (!id && !name) return null;
    const patch = normalizeKeyFigureEntry(patchSource, 0, { allowMissingName: true });
    if (!patch) return null;
    if (id) patch.id = id;
    return { op: "update", id: id || patch.id, name, patch };
  }
  return null;
};

export const normalizeKeyFigureOps = (ops) =>
  normalizeArray(ops).map(normalizeKeyFigureOp).filter(Boolean);

export const applyKeyFigureOps = (figures, ops) => {
  let next = normalizeKeyFigures(figures);
  for (const raw of normalizeArray(ops)) {
    const op = normalizeKeyFigureOp(raw);
    if (!op) continue;
    const targetId = op.op === "upsert" ? op.figure.id : op.id;
    const targetName = op.op === "upsert" ? op.figure.name : op.name;
    const index = next.findIndex((figure) =>
      targetId ? figure.id === targetId : targetName && figure.name.toLowerCase() === targetName.toLowerCase());
    if (op.op === "upsert") {
      next = index < 0 ? [...next, op.figure] : next.map((figure, figureIndex) => figureIndex === index ? op.figure : figure);
    } else if (op.op === "update") {
      if (index < 0) {
        next = [...next, op.patch];
      } else {
        next = next.map((figure, figureIndex) => figureIndex === index ? { ...figure, ...op.patch, id: figure.id } : figure);
      }
    } else if (op.op === "clear") {
      next = op.ownerCode
        ? next.filter((figure) => figure.ownerCode !== op.ownerCode && figure.polity !== op.ownerCode)
        : [];
    } else if (op.op === "remove") {
      if (index >= 0) {
        const targetId = next[index].id;
        next = next.filter((figure) => figure.id !== targetId);
      }
    }
  }
  return enforceKeyFigureBrainBudget(next);
};

const industryEntryLooksLikeRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) && [
    "id", "itemId", "name", "title", "ownerCode", "owner", "polity", "status",
    "quantity", "amount", "date", "kind", "category", "item", "project", "facility",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));

const normalizeIndustryListInput = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (industryEntryLooksLikeRecord(value)) return [value];
  return Object.entries(value).map(([id, entry]) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return { ...entry, id: entry.id ?? id };
    }
    return { id, value: entry, quantity: entry };
  });
};

const normalizeIndustryNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
};

const normalizeIndustryEntry = (entry, section, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const name = normalizeOptionalString(entry.name || entry.title || entry.item || entry.project || entry.system);
  const id = normalizeOptionalString(
    entry.id || entry.itemId || entry.recordId || entry.assetId || entry.projectId || entry.lineId || name,
  ) || normalizeEntityId("", name || entry.ownerCode, index);
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.polity || entry.country));
  const result = { ...cloneValue(entry), id, ownerCode };
  const rawQuantity = entry.quantity ?? entry.count ?? entry.amount ?? entry.units;
  const rawRate = entry.rate ?? entry.monthlyRate ?? entry.outputPerMonth;
  const rawProgress = entry.progress ?? entry.completion ?? entry.percent;

  if (section === "arsenal") {
    result.name = name || id;
    result.category = normalizeOptionalString(entry.category || entry.type);
    result.quantity = normalizeIndustryNumber(rawQuantity);
  } else if (section === "research") {
    result.name = name || id;
    result.status = normalizeOptionalString(entry.status).toLowerCase() || "planned";
    result.progress = Math.max(0, Math.min(100, normalizeIndustryNumber(rawProgress)));
  } else if (section === "production") {
    result.name = name || id;
    result.item = normalizeOptionalString(entry.item || entry.product || entry.name || entry.title);
    result.status = normalizeOptionalString(entry.status).toLowerCase() || "planned";
    result.quantity = normalizeIndustryNumber(rawQuantity);
    if (rawRate !== undefined) result.rate = normalizeIndustryNumber(rawRate);
    if (rawProgress !== undefined) result.progress = Math.max(0, Math.min(100, normalizeIndustryNumber(rawProgress)));
  } else {
    result.date = normalizeOptionalString(entry.date || entry.updatedAt || entry.time);
    result.kind = normalizeOptionalString(entry.kind || entry.type) || "update";
    result.section = normalizeOptionalString(entry.section || entry.domain || entry.area).toLowerCase();
    result.itemId = normalizeOptionalString(entry.itemId || entry.assetId || entry.projectId || entry.lineId || result.id);
    result.note = normalizeOptionalString(entry.note || entry.description);
    if (entry.quantity !== undefined || entry.amount !== undefined || entry.delta !== undefined || entry.change !== undefined) {
      const amount = entry.delta ?? entry.change ?? entry.quantity ?? entry.amount;
      result.delta = Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : 0;
    }
  }
  return result;
};

const normalizeIndustryCollection = (value, section) => {
  const byId = new Map();
  normalizeIndustryListInput(value).forEach((entry, index) => {
    const normalized = normalizeIndustryEntry(entry, section, index);
    if (normalized) byId.set(normalized.id, normalized);
  });
  return [...byId.values()];
};

export const normalizeArsenal = (value) => normalizeIndustryCollection(value, "arsenal");
export const normalizeResearch = (value) => normalizeIndustryCollection(value, "research");
export const normalizeProduction = (value) => normalizeIndustryCollection(value, "production");
export const normalizeLedger = (value) => normalizeIndustryCollection(value, "ledger");

export const normalizeMilitaryIndustry = (industry) => {
  const source = industry && typeof industry === "object" && !Array.isArray(industry) ? industry : {};
  return {
    ...cloneValue(source),
    arsenal: normalizeArsenal(source.arsenal ?? source.inventory ?? source.stock),
    research: normalizeResearch(source.research ?? source.projects ?? source.technologies),
    production: normalizeProduction(source.production ?? source.lines ?? source.factories),
    ledger: normalizeLedger(source.ledger ?? source.history ?? source.transactions),
  };
};

const normalizeMilitaryIndustryOp = (entry, forcedSection = "") => {
  if (!entry || typeof entry !== "object") return null;
  let section = normalizeOptionalString(entry.section || entry.domain || entry.area || entry.category || forcedSection).toLowerCase();
  let rawOp = normalizeOptionalString(entry.op || entry.action).toLowerCase();
  if (MILITARY_INDUSTRY_SECTION_SET.has(rawOp) && !section) {
    section = rawOp;
    rawOp = "upsert";
  }
  if (["produce", "consume"].includes(rawOp) && !section) section = "arsenal";
  if (!MILITARY_INDUSTRY_SECTION_SET.has(section)) return null;
  const op = rawOp || "upsert";
  if (["produce", "consume"].includes(op)) {
    const itemId = normalizeOptionalString(entry.itemId || entry.assetId || entry.productId || entry.id || entry.entry?.itemId || entry.entry?.id || entry.name);
    const amount = normalizeIndustryNumber(entry.amount ?? entry.quantity ?? entry.count ?? entry.entry?.quantity ?? entry.entry?.amount);
    if (!itemId || amount <= 0) return null;
    const source = Object.fromEntries(Object.entries(entry.entry || entry).filter(([key]) => !["op", "action", "section", "domain", "area"].includes(key)));
    const itemSource = Object.fromEntries(Object.entries(source).filter(([key]) => !["itemId", "amount", "count", "delta", "ledgerId", "ledgerName"].includes(key)));
    const item = normalizeIndustryEntry({
      ...itemSource,
      id: itemId,
      name: entry.name || itemId,
      quantity: amount,
    }, "arsenal", 0);
    const ledgerSource = Object.fromEntries(Object.entries(entry.ledger || source).filter(([key]) => !["op", "action", "section", "domain", "area"].includes(key)));
    const ledger = normalizeIndustryEntry({
      ...ledgerSource,
      id: entry.ledgerId || `${op}-${itemId}-${normalizeOptionalString(entry.date) || "turn"}`,
      itemId,
      name: entry.ledgerName || `${op === "produce" ? "Produced" : "Consumed"}: ${item.name}`,
      kind: op,
      delta: op === "produce" ? amount : -amount,
      quantity: op === "produce" ? amount : -amount,
    }, "ledger", 0);
    return { op, section: "arsenal", id: itemId, name: item.name, entry: item, ledger };
  }
  const rawEntry = entry.entry ?? entry.record ?? entry.asset ?? entry.project ?? entry.line ?? entry.item ?? entry.value ?? entry[section] ?? entry;
  const id = normalizeOptionalString(entry.id || entry.itemId || entry.recordId || entry.assetId || entry.projectId || entry.lineId || rawEntry?.id);
  const name = normalizeOptionalString(entry.name || rawEntry?.name);
  if (["remove", "delete", "clear"].includes(op)) return id || name ? { op: "remove", section, id, name } : { op: "clear", section };
  if (!["create", "set", "upsert", "add", "update", "patch", "record", "append", "log"].includes(op)) return null;
  const cleanEntry = rawEntry && typeof rawEntry === "object"
    ? Object.fromEntries(Object.entries(rawEntry).filter(([key]) => !["op", "action", "section", "domain", "area"].includes(key)))
    : rawEntry;
  const normalized = normalizeIndustryEntry(cleanEntry, section, 0);
  if (!normalized) return null;
  if (id) normalized.id = id;
  return {
    op: ["update", "patch"].includes(op) ? "update" : ["record", "append", "log"].includes(op) ? "append" : "upsert",
    section,
    id: id || normalized.id,
    name,
    entry: normalized,
  };
};

export const normalizeMilitaryIndustryOps = (ops) => {
  const normalizeOne = (entry, forcedSection = "") => {
    if (entry && ["produce", "consume"].includes(normalizeOptionalString(entry.op).toLowerCase()) && entry.entry && entry.ledger) {
      return entry;
    }
    return normalizeMilitaryIndustryOp(entry, forcedSection);
  };
  if (ops && typeof ops === "object" && !Array.isArray(ops)) {
    return MILITARY_INDUSTRY_SECTIONS.flatMap((section) =>
      normalizeIndustryListInput(ops[section]).map((entry) => normalizeOne(entry, section)).filter(Boolean),
    );
  }
  return normalizeArray(ops).map((entry) => normalizeOne(entry)).filter(Boolean);
};

export const applyMilitaryIndustryOps = (industry, ops) => {
  const next = normalizeMilitaryIndustry(industry);
  for (const raw of normalizeMilitaryIndustryOps(ops)) {
    const collection = next[raw.section];
    if (raw.op === "clear") {
      next[raw.section] = [];
      continue;
    }
    const index = collection.findIndex((entry) => entry.id === raw.id);
    if (["produce", "consume"].includes(raw.op)) {
      const current = next.arsenal.find((entry) => entry.id === raw.id);
      const amount = normalizeIndustryNumber(raw.entry.quantity);
      const nextQuantity = Math.max(0, (current?.quantity || 0) + (raw.op === "produce" ? amount : -amount));
      const updated = { ...(current || {}), ...raw.entry, id: raw.id, quantity: nextQuantity, ...(current?.name ? { name: current.name } : {}) };
      next.arsenal = current
        ? next.arsenal.map((entry) => entry.id === raw.id ? updated : entry)
        : [...next.arsenal, updated];
      if (raw.ledger && !next.ledger.some((entry) => entry.id === raw.ledger.id)) next.ledger.push(raw.ledger);
      continue;
    }
    if (raw.op === "remove") {
      next[raw.section] = collection.filter((entry) =>
        entry.id !== raw.id && (!raw.name || entry.name.toLowerCase() !== raw.name.toLowerCase()));
    } else if (raw.op === "append") {
      next[raw.section] = index < 0 ? [...collection, raw.entry] : collection;
    } else if (raw.op === "update") {
      next[raw.section] = index < 0
        ? [...collection, raw.entry]
        : collection.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...raw.entry, id: entry.id } : entry);
    } else if (raw.op === "upsert") {
      next[raw.section] = index < 0
        ? [...collection, raw.entry]
        : collection.map((entry, entryIndex) => entryIndex === index ? raw.entry : entry);
    }
  }
  return next;
};

// One AI-authored mutation to the built-structure list: build | remove.
const normalizeMarkerOp = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const op = normalizeOptionalString(entry.op).toLowerCase();

  if (op === "build" || op === "found") {
    const marker = normalizeMarkerEntry(entry.marker ?? entry, 0);
    if (!marker) return null;
    return { op: "build", marker };
  }

  if (op === "remove" || op === "destroy") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name);
    if (!markerId && !name) return null;
    return { op: "remove", markerId, name, note: normalizeOptionalString(entry.note) };
  }

  if (op === "rename") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name || entry.from || entry.oldName);
    const newName = normalizeOptionalString(entry.newName || entry.to);
    if ((!markerId && !name) || !newName) return null;
    return { op: "rename", markerId, name, newName, note: normalizeOptionalString(entry.note) };
  }

  if (op === "update" || op === "annotate" || op === "identify") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name || entry.from || entry.oldName);
    if (!markerId && !name) return null;
    const patch = {};
    const nextName = normalizeOptionalString(entry.newName || entry.to || entry.label);
    const kind = normalizeOptionalString(entry.kind || entry.type).toLowerCase();
    const ownerCode = normalizeOptionalString(entry.ownerCode || entry.owner || entry.controller);
    const status = normalizeOptionalString(entry.status).toLowerCase();
    if (nextName) patch.name = nextName;
    if (kind) patch.kind = kind;
    if (ownerCode) patch.ownerCode = toCountryName(ownerCode);
    if (status && MARKER_STATUS_SET.has(status)) patch.status = status;
    if (Object.prototype.hasOwnProperty.call(entry, "note")) patch.note = normalizeOptionalString(entry.note);
    if (Object.prototype.hasOwnProperty.call(entry, "foundedAt")) patch.foundedAt = normalizeOptionalString(entry.foundedAt);
    return { op: "update", markerId, name, patch };
  }

  return null;
};

// Apply a batch of marker ops (pure). Rebuilding under an existing name
// replaces it rather than stacking duplicates; removal matches id first, then
// exact name — the AI usually knows the name, rarely the id.
export const applyMarkerOps = (markers, ops) => {
  let next = normalizeMarkers(markers);
  for (const op of normalizeArray(ops)) {
    if (op.op === "build") {
      next = [
        ...next.filter((marker) => marker.name.toLowerCase() !== op.marker.name.toLowerCase()),
        op.marker,
      ];
    } else if (op.op === "remove") {
      next = next.filter((marker) =>
        op.markerId ? marker.id !== op.markerId : marker.name.toLowerCase() !== op.name.toLowerCase());
    } else if (op.op === "rename") {
      next = next.map((marker) =>
        (op.markerId ? marker.id === op.markerId : marker.name.toLowerCase() === (op.name || "").toLowerCase())
          ? { ...marker, name: op.newName }
          : marker);
    } else if (op.op === "update") {
      next = next.map((marker) => {
        const matches = op.markerId
          ? marker.id === op.markerId
          : marker.name.toLowerCase() === (op.name || "").toLowerCase();
        return matches ? { ...marker, ...op.patch } : marker;
      });
    }
  }
  return next;
};

// One AI-authored mutation to the unit list: spawn | move | strength | remove.
// Why normalizeUnitOp refused an entry, in words a player can paste into a bug
// report. Mirrors the checks below — keep the two in step.
const describeUnitOpRejection = (entry) => {
  if (!entry || typeof entry !== "object") return "not an object";
  const op = normalizeOptionalString(entry.op).toLowerCase();
  if (!op) return "no op (expected spawn, move, strength or remove)";
  if (op === "spawn") {
    const unit = entry.unit ?? entry;
    if (!unit || typeof unit !== "object") return "spawn without a unit";
    const lng = finiteOrNull(unit.lng ?? unit.lon ?? unit.longitude);
    const lat = finiteOrNull(unit.lat ?? unit.latitude);
    if (lng === null || lat === null) {
      // The usual cause: a non-numeric coordinate ("37,06", "37.06°N") that JSON
      // carried through as a string and Number() turned into NaN.
      return `spawn has unusable coordinates (lng=${JSON.stringify(unit.lng)}, lat=${JSON.stringify(unit.lat)})`;
    }
    if (lng === 0 && lat === 0) return "spawn at 0,0 — the output template's placeholder, not a real position";
    if (!normalizeOptionalString(unit.ownerCode || unit.owner || unit.code)) return "spawn has no owner";
    return "spawn rejected";
  }
  if (!normalizeOptionalString(entry.unitId || entry.id)) return `${op} without a unitId`;
  if (op === "move") {
    const toLng = finiteOrNull(entry.toLng ?? entry.lng);
    const toLat = finiteOrNull(entry.toLat ?? entry.lat);
    if (toLng === null || toLat === null) return `move has unusable destination (toLng=${JSON.stringify(entry.toLng)}, toLat=${JSON.stringify(entry.toLat)})`;
    if (toLng === 0 && toLat === 0) return "move to 0,0 — the output template's placeholder, not a real position";
  }
  return `unknown op "${op}"`;
};

const normalizeUnitOp = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const op = normalizeOptionalString(entry.op).toLowerCase();
  const unitId = normalizeOptionalString(entry.unitId || entry.id);

  if (op === "spawn") {
    const unit = normalizeUnitEntry(entry.unit ?? entry, 0);
    if (!unit) return null;
    unit.source = "ai";
    return { op, unit };
  }

  if (!unitId) {
    return null;
  }

  if (op === "move") {
    const toLng = finiteOrNull(entry.toLng ?? entry.lng);
    const toLat = finiteOrNull(entry.toLat ?? entry.lat);
    if (toLng === null || toLat === null || (toLng === 0 && toLat === 0)) return null;
    return {
      op,
      unitId,
      toLng,
      toLat,
      regionId: normalizeOptionalString(entry.regionId),
      sectorId: normalizeOptionalString(entry.sectorId || entry.frontId),
      note: normalizeOptionalString(entry.note),
    };
  }

  if (op === "strength") {
    return { op, unitId, strength: clampUnitStrength(entry.strength ?? 0), note: normalizeOptionalString(entry.note) };
  }

  if (op === "remove") {
    return { op, unitId, note: normalizeOptionalString(entry.note) };
  }

  return null;
};

// Apply a batch of unit ops to a unit list (pure). Ops referencing unknown ids
// are silently ignored; units reduced to <=0 strength are dropped.
export const applyUnitOps = (units, ops) => {
  let next = normalizeUnits(units);
  for (const op of normalizeArray(ops)) {
    if (op.op === "spawn") {
      // Idempotent: skip a spawn whose unit id is already present, so a re-applied
      // op batch can't duplicate a unit (mirrors the event-restatement de-dup).
      const spawnId = op.unit?.id;
      if (!spawnId || !next.some((unit) => unit.id === spawnId)) next.push(op.unit);
    } else if (op.op === "move") {
      next = next.map((unit) =>
        unit.id === op.unitId
          ? {
              ...unit,
              lng: op.toLng,
              lat: op.toLat,
              regionId: op.regionId || unit.regionId,
              sectorId: op.sectorId || unit.sectorId,
              status: "moving",
              updatedAt: new Date().toISOString(),
            }
          : unit,
      );
    } else if (op.op === "strength") {
      next = next.map((unit) =>
        unit.id === op.unitId
          ? { ...unit, strength: op.strength, status: op.strength <= 0 ? "defeated" : unit.status, updatedAt: new Date().toISOString() }
          : unit,
      );
    } else if (op.op === "remove") {
      next = next.filter((unit) => unit.id !== op.unitId);
    }
  }
  return next.filter((unit) => unit.strength > 0 && unit.status !== "defeated");
};

const normalizeEventImpacts = (value) => {
  if (!value || typeof value !== "object") {
    return {
      actionIds: [],
      createdChats: [],
      keyFigureOps: [],
      markerOps: [],
      militaryIndustryOps: [],
      territoryOps: [],
      reserveOps: [],
      resourceOps: [],
      forceOps: [],
      polityChanges: [],
      regionTransfers: [],
      sectorOps: [],
      unitOps: [],
    };
  }

  return {
    actionIds: normalizeActionParticipants(value.actionIds),
    createdChats: normalizeChats(value.createdChats),
    keyFigureOps: normalizeKeyFigureOps(value.keyFigureOps ?? value.keyFiguresOps ?? value.keyFigures),
    markerOps: normalizeArray(value.markerOps).map(normalizeMarkerOp).filter(Boolean),
    militaryIndustryOps: [
      ...normalizeMilitaryIndustryOps(value.militaryIndustryOps ?? value.industryOps ?? value.militaryIndustry),
      ...MILITARY_INDUSTRY_SECTIONS.flatMap((section) =>
        normalizeMilitaryIndustryOps(value[`${section}Ops`]?.map?.((entry) => ({ ...entry, section })) ?? []),
      ),
    ],
    territoryOps: normalizeTerritoryOps(value.territoryOps),
    reserveOps: normalizeReserveOps(value.reserveOps),
    resourceOps: normalizeResourceOps(value.resourceOps ?? value.logisticsOps),
    forceOps: normalizeForceOps(value.forceOps ?? value.forceOrders),
    polityChanges: normalizeArray(value.polityChanges).map(normalizePolityChange).filter(Boolean),
    regionTransfers: normalizeArray(value.regionTransfers).map(normalizeRegionTransfer).filter(Boolean),
    sectorOps: normalizeArray(value.sectorOps).map(normalizeSectorOp).filter(Boolean),
    // Say WHY a unit op was thrown away. A dropped op is the difference between an
    // event that narrates a deployment and troops that actually appear on the map,
    // and it used to vanish into .filter(Boolean) without a word — leaving no way
    // to tell "the model never emitted one" from "it emitted one we rejected".
    // Region transfers have logged their drops for a while; units now match.
    unitOps: normalizeArray(value.unitOps)
      .map((entry, index) => {
        const normalized = normalizeUnitOp(entry);
        if (!normalized) {
          console.warn(
            `[ai] unitOps[${index}] dropped — ${describeUnitOpRejection(entry)}:`,
            entry,
          );
        }
        return normalized;
      })
      .filter(Boolean),
  };
};

export const normalizeEventEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const title = normalizeString(entry);
    if (!title) return null;

    return {
      createdAt: new Date().toISOString(),
      date: "",
      description: "",
      id: generateId(`event-${index}`),
      impacts: normalizeEventImpacts(null),
      importance: "minor",
      kind: "world",
      notable: false,
      playerRelated: false,
      source: "scenario",
      title,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const title =
    normalizeOptionalString(entry.title || entry.headline || entry.name) ||
    normalizeOptionalString(entry.description || entry.summary);

  if (!title) {
    return null;
  }

  return {
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
    date: normalizeOptionalString(entry.date),
    description: normalizeOptionalString(entry.description || entry.summary || entry.text),
    id: normalizeOptionalString(entry.id) || generateId(`event-${index}`),
    impacts: normalizeEventImpacts(entry.impacts),
    importance: normalizeOptionalString(entry.importance) || "minor",
    kind: normalizeOptionalString(entry.kind) || "world",
    notable: Boolean(entry.notable),
    playerRelated: Boolean(entry.playerRelated),
    source: normalizeOptionalString(entry.source) || "scenario",
    title,
  };
};

export const normalizeEvents = (events) => {
  if (Array.isArray(events)) {
    return events
      .map((entry, index) => normalizeEventEntry(entry, index))
      .filter(Boolean);
  }

  if (events && typeof events === "object") {
    if (Array.isArray(events.events)) {
      return normalizeEvents(events.events);
    }

    return Object.values(events)
      .map((entry, index) => normalizeEventEntry(entry, index))
      .filter(Boolean);
  }

  return [];
};

const normalizePolityOverride = (key, value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const code = normalizeOptionalString(value.code) || normalizeOptionalString(key);
  if (!code) {
    return null;
  }

  return {
    aliases: normalizeActionParticipants(value.aliases || value.additionalNames),
    code,
    color: normalizeOptionalString(value.color),
    name: normalizeOptionalString(value.name || value.label),
    note: normalizeOptionalString(value.note),
  };
};

const normalizeActionSuggestions = (value) =>
  normalizeArray(value).map((topic) => {
    if (!topic || typeof topic !== "object") {
      return null;
    }

    const title = normalizeOptionalString(topic.title || topic.name);
    if (!title) {
      return null;
    }

    return {
      actions: normalizeArray(topic.actions).map((entry, index) => normalizeActionEntry(entry, index)).filter(Boolean),
      description: normalizeOptionalString(topic.description),
      id: normalizeOptionalString(topic.id) || generateId("topic"),
      title,
    };
  }).filter(Boolean);

const normalizeConsolidatedHistory = (value) => normalizeArray(value)
  .map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const summary = normalizeTextLike(entry.summary);
    if (!summary) return null;
    return {
      chatIds: normalizeActionParticipants(entry.chatIds),
      createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
      source: normalizeOptionalString(entry.source) || "ai",
      summary,
      throughDate: normalizeOptionalString(entry.throughDate),
      throughEventId: normalizeOptionalString(entry.throughEventId),
      throughRound: Number.isFinite(Number(entry.throughRound))
        ? Math.max(0, Math.trunc(Number(entry.throughRound)))
        : 0,
    };
  })
  .filter(Boolean);

export const normalizeWorldState = (world) => {
  const nextWorld = world && typeof world === "object" ? world : {};
  const polityOverrides = Object.fromEntries(
    Object.entries(nextWorld.polityOverrides ?? {})
      .map(([key, value]) => [key, normalizePolityOverride(key, value)])
      .filter(([, value]) => value),
  );

  const regionOwnershipOverrides = Object.fromEntries(
    Object.entries(nextWorld.regionOwnershipOverrides ?? {})
      // Canonicalise on READ too, so a save written before this migrated still
      // resolves to the same owner identity as everything computed now.
      .map(([regionId, ownerCode]) => [normalizeOptionalString(regionId), toCountryName(normalizeOptionalString(ownerCode))])
      .filter(([regionId, ownerCode]) => regionId && ownerCode),
  );

  const regionClaimants = Object.fromEntries(
    Object.entries(nextWorld.regionClaimants ?? {})
      .map(([regionId, claimants]) => [
        normalizeOptionalString(regionId),
        normalizeArray(claimants).map((name) => normalizeOptionalString(name)).filter(Boolean).slice(0, 4),
      ])
      .filter(([regionId, claimants]) => regionId && claimants.length),
  );

  const internationalReputation = Object.fromEntries(
    Object.entries(nextWorld.internationalReputation ?? {})
      .map(([polityCode, value]) => [normalizeOptionalString(polityCode), Number(value)])
      .filter(([polityCode, value]) => polityCode && Number.isFinite(value))
      .map(([polityCode, value]) => [polityCode, Math.max(0, Math.min(100, Math.round(value)))]),
  );

  // Keyed by country NAME, verbatim — same namespace as internationalReputation
  // above, polityOverrides and colors. This used to uppercase while its neighbours
  // did not, so one applyEventImpacts change.code landed under two different keys
  // (countryTags["RUSSIA"] but internationalReputation["Russia"]). Harmless while
  // owners were uppercase GADM codes; a silent desync the moment they are names.
  const countryTags = Object.fromEntries(
    Object.entries(nextWorld.countryTags ?? {})
      .map(([country, list]) => [normalizeOptionalString(country), normalizeTagList(list)])
      .filter(([country, list]) => country && list.length),
  );

  // Persisted per-country stat sheets: keep each code -> sheet-object entry as-is (the
  // Stats pane tolerates missing fields). Explicit, not via the spread — new-field trap.
  const countryStats = Object.fromEntries(
    Object.entries(nextWorld.countryStats ?? {})
      .filter(([code, sheet]) => normalizeOptionalString(code) && sheet && typeof sheet === "object"),
  );
  const diplomaticMemory = normalizeChatMemories(nextWorld.diplomaticMemory);

  return {
    ...WORLD_DEFAULTS,
    ...nextWorld,
    countryTags,
    countryStats,
    actionSuggestions: normalizeActionSuggestions(nextWorld.actionSuggestions),
    activeCatalyst: normalizeCatalyst(nextWorld.activeCatalyst),
    consolidatedHistory: normalizeConsolidatedHistory(nextWorld.consolidatedHistory),
    diplomaticMemory,
    internationalReputation,
    keyFigures: enforceKeyFigureBrainBudget(nextWorld.keyFigures),
    labelFont: normalizeOptionalString(nextWorld.labelFont),
    labelHaloColor: normalizeOptionalString(nextWorld.labelHaloColor),
    labelTextColor: normalizeOptionalString(nextWorld.labelTextColor),
    language: normalizeOptionalString(nextWorld.language) || WORLD_DEFAULTS.language,
    lastJumpMode: normalizeOptionalString(nextWorld.lastJumpMode),
    lastJumpSummary: normalizeOptionalString(nextWorld.lastJumpSummary),
    lastJumpTargetDate: normalizeOptionalString(nextWorld.lastJumpTargetDate),
    militaryIndustry: normalizeMilitaryIndustry(nextWorld.militaryIndustry),
    militaryReserves: normalizeMilitaryReserves(nextWorld.militaryReserves),
    resourceLedger: normalizeResourceLedger(nextWorld.resourceLedger),
    notes: normalizeOptionalString(nextWorld.notes),
    polityOverrides,
    regionClaimants,
    regionOwnershipOverrides,
    simulationHistory: normalizeArray(nextWorld.simulationHistory)
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        return {
          ...cloneValue(entry),
          catalyst: normalizeCatalyst(entry.catalyst),
          date: normalizeOptionalString(entry.date),
          eventIds: normalizeActionParticipants(entry.eventIds),
          fallbackReason: normalizeOptionalString(entry.fallbackReason),
          fromDate: normalizeOptionalString(entry.fromDate || entry.startDate),
          mode: normalizeOptionalString(entry.mode),
          plannedActions: normalizeActions(entry.plannedActions || entry.actions),
          round:
            Number.isFinite(Number(entry.round)) && Number(entry.round) > 0
              ? Math.trunc(Number(entry.round))
              : 0,
          summary: normalizeTextLike(entry.summary),
          source: normalizeOptionalString(entry.source) || "ai",
          toDate: normalizeOptionalString(entry.toDate || entry.endDate || entry.date),
        };
      })
      .filter(Boolean),
    markers: normalizeMarkers(nextWorld.markers),
    controlSectors: normalizeControlSectors(nextWorld.controlSectors),
    territoryFragments: normalizeTerritoryFragments(nextWorld.territoryFragments),
    // Explicit (not via the ...WORLD_DEFAULTS spread) so this new field survives every
    // write path — the documented new-world-field trap.
    cityRenames: Object.fromEntries(
      Object.entries(nextWorld.cityRenames && typeof nextWorld.cityRenames === "object" ? nextWorld.cityRenames : {})
        .map(([key, value]) => [normalizeString(key).toLowerCase(), normalizeString(value)])
        .filter(([key, value]) => key && value),
    ),
    simulationRules: normalizeOptionalString(nextWorld.simulationRules),
    startingTimelineText: normalizeOptionalString(nextWorld.startingTimelineText),
    units: normalizeUnits(nextWorld.units),
  };
};

// Does a polity currently hold no territory? A stateless actor — a
// government-in-exile, a movement, or a person with no country of their own.
// Single source of truth for "landless", used by both the AI prompt
// (buildPlayerPolityRegionsText) and the UI flag resolvers: a landless polity
// with no flag of its own must NOT borrow the code-derived country flag (a
// "stateless person in Japan" is not Japan), so the flag shows neutral instead.
//
// The distinction that matters: owning a region via an override = has land; but
// a scenario that ships NO override list at all means the polity owns its country
// through the base map tiles (a stock modern map), which is NOT landless.
export const isPolityLandless = (world, code) => {
  const polityCode = normalizeString(code);
  if (!polityCode) return false;
  const normalized = normalizeWorldState(world);
  const entries = Object.entries(normalized.regionOwnershipOverrides);
  const owns = entries.some(
    ([, ownerCode]) => normalizeString(ownerCode).toLowerCase() === polityCode.toLowerCase(),
  );
  if (owns) return false;
  const isKnownPolity = Boolean(normalized.polityOverrides?.[polityCode]);
  // No override list AND not a declared polity = stock map, owns via base tiles.
  if (entries.length === 0 && !isKnownPolity) return false;
  return true;
};

// Recover a Gregorian date stored in a loose format back to strict YYYY-MM-DD.
// Older builds wrote the model's stopDate verbatim, so real saves hold values
// like "2016-12-31T00:00:00.000Z" or "December 31, 2016" — the header displays
// them fine, but date math (addIsoDays) rejects them, so every jump silently
// computes target == origin and the game clock freezes forever while the model
// re-simulates the past. Deliberately non-Gregorian scenario dates ("1200 BCE")
// don't parse and pass through untouched.
const canonicalizeDateString = (value) => {
  const text = normalizeOptionalString(value);
  if (!text || /^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // An ISO date prefix (datetime forms) is authoritative — slicing it avoids
  // the timezone day-shift of parsing "...T00:00:00Z" into local time.
  const prefix = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(text);
  if (prefix) return prefix[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    if (year >= 1 && year <= 9999) {
      return `${String(year).padStart(4, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
  }
  return text;
};

export const normalizeGameData = (game) => {
  const nextGame = game && typeof game === "object" ? game : {};

  return {
    ...GAME_DEFAULTS,
    ...nextGame,
    country: normalizeOptionalString(nextGame.country),
    difficulty: normalizeOptionalString(nextGame.difficulty) || GAME_DEFAULTS.difficulty,
    gameDate: canonicalizeDateString(nextGame.gameDate),
    language: normalizeOptionalString(nextGame.language) || GAME_DEFAULTS.language,
    round:
      Number.isFinite(Number(nextGame.round)) && Number(nextGame.round) > 0
        ? Math.trunc(Number(nextGame.round))
        : GAME_DEFAULTS.round,
    startDate: canonicalizeDateString(nextGame.startDate),
  };
};

export const buildActionDisplayText = (action) => {
  const normalized = normalizeActionEntry(action);
  if (!normalized) {
    return "";
  }

  return normalized.kind === "chat" && normalized.chatStarter
    ? `${normalized.title}: ${normalized.chatStarter}`
    : normalized.text;
};

export const readWorldState = async ({ force = false } = {}) =>
  normalizeWorldState(await readJson(JSON_URLS.world, { defaultValue: WORLD_DEFAULTS, force }));

export const writeWorldState = async (world, options = {}) => {
  const normalized = normalizeWorldState(world);
  // Edited/AI-written polity names, aliases and notes get translated (and
  // saved to the server language pack) the moment they're written, not when
  // they first happen to be rendered somewhere.
  enqueueContentStrings(normalized.polityOverrides);
  return writeJson(JSON_URLS.world, normalized, { pretty: true, ...options });
};

export const readGameData = async ({ force = false } = {}) =>
  normalizeGameData(await readJson(JSON_URLS.game, { defaultValue: GAME_DEFAULTS, force }));

export const writeGameData = async (game, options = {}) =>
  writeJson(JSON_URLS.game, normalizeGameData(game), { pretty: true, ...options });

export const readActionsState = async ({ force = false } = {}) =>
  normalizeActions(await readJson(JSON_URLS.actions, { defaultValue: [], force }));

export const writeActionsState = async (actions, options = {}) =>
  writeJson(JSON_URLS.actions, normalizeActions(actions), { pretty: true, ...options });

export const readEventsState = async ({ force = false } = {}) =>
  normalizeEvents(await readJson(JSON_URLS.events, { defaultValue: [], force }));

export const writeEventsState = async (events, options = {}) => {
  // Choke-point safety net: no writer can persist a log that already contains
  // exact-duplicate events (the AI restating its own timeline). See eventDedup.js.
  const normalized = dedupeEventLog(normalizeEvents(events));
  // New/edited event text follows the UI language immediately (see above).
  enqueueContentStrings(normalized);
  return writeJson(JSON_URLS.events, normalized, { pretty: true, ...options });
};

export const readChatsState = async ({ force = false } = {}) =>
  normalizeChats(await readJson(JSON_URLS.chat, { defaultValue: [], force }));

export const writeChatsState = async (chats, options = {}) =>
  writeJson(JSON_URLS.chat, normalizeChats(chats), { pretty: true, ...options });

export const readGameStateBundle = async ({ force = false } = {}) => {
  const [actions, chats, events, game, world] = await Promise.all([
    readActionsState({ force }),
    readChatsState({ force }),
    readEventsState({ force }),
    readGameData({ force }),
    readWorldState({ force }),
  ]);

  return {
    actions,
    chats,
    events,
    game,
    world,
  };
};

export const applyEventImpactsToWorld = ({ colors = {}, events = [], world }) => {
  const nextColors = cloneValue(colors) ?? {};
  const nextWorld = normalizeWorldState(world);
  const completedRegionTransfers = new Set();

  for (const event of normalizeEvents(events)) {
    for (const transfer of event.impacts.regionTransfers) {
      nextWorld.regionOwnershipOverrides[transfer.regionId] = transfer.toCode;
      completedRegionTransfers.add(transfer.regionId);
      if (transfer.regionName) completedRegionTransfers.add(transfer.regionName);
    }

    if (event.impacts.sectorOps?.length) {
      nextWorld.controlSectors = applySectorOps(nextWorld.controlSectors, event.impacts.sectorOps);
    }

    if (event.impacts.territoryOps?.length) {
      nextWorld.territoryFragments = applyTerritoryOps(nextWorld.territoryFragments, event.impacts.territoryOps);
    }

    for (const change of event.impacts.polityChanges) {
      nextWorld.polityOverrides[change.code] = {
        ...(nextWorld.polityOverrides[change.code] ?? {
          aliases: [],
          code: change.code,
          color: "",
          name: "",
          note: "",
        }),
        ...(change.aliases?.length > 0 ? { aliases: change.aliases } : {}),
        ...(change.color ? { color: change.color } : {}),
        ...(change.name ? { name: change.name } : {}),
        ...(change.note ? { note: change.note } : {}),
      };

      if (change.color) {
        const normalizedColor = normalizeOptionalString(change.color);
        const hexMatch = /^#?([a-f0-9]{6})$/i.exec(normalizedColor);
        if (hexMatch) {
          const hex = hexMatch[1];
          nextColors[change.code] = [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
          ];
        }
      }

      // Reputation the AI set this turn becomes the polity's authoritative value.
      if (Number.isFinite(change.reputation)) {
        nextWorld.internationalReputation[change.code] = change.reputation;
        // Keep the persisted sheet's reputation index in sync with the authoritative value.
        if (nextWorld.countryStats?.[change.code]?.indices) {
          nextWorld.countryStats[change.code] = {
            ...nextWorld.countryStats[change.code],
            indices: { ...nextWorld.countryStats[change.code].indices, internationalReputation: change.reputation },
          };
        }
      }

      // Persistent stat sheet: merge the AI's changed fields into the stored sheet so a
      // country's stats change ONLY when the AI changes them (not every date). Deep-merge
      // the nested groups and mirror the reputation index into the authoritative store.
      if (change.stats && typeof change.stats === "object") {
        if (!nextWorld.countryStats || typeof nextWorld.countryStats !== "object") nextWorld.countryStats = {};
        const prev = nextWorld.countryStats[change.code] && typeof nextWorld.countryStats[change.code] === "object"
          ? nextWorld.countryStats[change.code]
          : {};
        const merged = { ...prev, ...change.stats };
        for (const group of ["indices", "economy", "gdpBreakdown"]) {
          if (change.stats[group] && typeof change.stats[group] === "object") {
            merged[group] = { ...(prev[group] || {}), ...change.stats[group] };
          }
        }
        nextWorld.countryStats[change.code] = merged;
        const rep = Number(merged.indices?.internationalReputation);
        if (Number.isFinite(rep)) {
          nextWorld.internationalReputation[change.code] = Math.max(0, Math.min(100, Math.round(rep)));
        }
      }

      // Tags the AI set this turn replace the scenario's starting tags for this
      // country, wholesale — the model sends the complete list, so a revolution
      // that drops "socialist" must actually drop it. null means "unchanged",
      // which is why normalizePolityChange distinguishes null from [].
      if (Array.isArray(change.tags)) {
        if (!nextWorld.countryTags || typeof nextWorld.countryTags !== "object") {
          nextWorld.countryTags = {};
        }
        if (change.tags.length) nextWorld.countryTags[change.code] = change.tags;
        else delete nextWorld.countryTags[change.code];
      }
    }

    if (event.impacts.keyFigureOps?.length) {
      nextWorld.keyFigures = applyKeyFigureOps(nextWorld.keyFigures, event.impacts.keyFigureOps);
    }

    if (event.impacts.militaryIndustryOps?.length) {
      nextWorld.militaryIndustry = applyMilitaryIndustryOps(
        nextWorld.militaryIndustry,
        event.impacts.militaryIndustryOps,
      );
    }

    if (event.impacts.unitOps?.length) {
      nextWorld.units = applyUnitOps(nextWorld.units, event.impacts.unitOps);
    }

    if (event.impacts.reserveOps?.length) {
      nextWorld.militaryReserves = applyReserveOps(nextWorld.militaryReserves, event.impacts.reserveOps);
    }

    // A forceOp expands a scoped order against the complete current order of
    // battle. It intentionally runs after explicit unitOps so a model can still
    // move one named formation and then issue a quantified withdrawal for the
    // rest of a front.
    if (event.impacts.forceOps?.length) {
      nextWorld.units = applyForceOps(nextWorld.units, event.impacts.forceOps);
    }

    if (event.impacts.resourceOps?.length) {
      const resourceResult = applyResourceOps(nextWorld.militaryReserves, event.impacts.resourceOps);
      nextWorld.militaryReserves = resourceResult.reserves;
      if (resourceResult.applied.length > 0) {
        const ledgerEntries = normalizeResourceLedger(resourceResult.applied.map((entry) => ({
          ...entry,
          date: entry.date || event.date,
        })));
        const existingIds = new Set(nextWorld.resourceLedger.map((entry) => entry.id));
        nextWorld.resourceLedger = [
          ...nextWorld.resourceLedger,
          ...ledgerEntries.filter((entry) => !existingIds.has(entry.id)),
        ].slice(-2000);
      }
    }

    if (event.impacts.markerOps?.length) {
      const before = normalizeMarkers(nextWorld.markers);
      nextWorld.markers = applyMarkerOps(nextWorld.markers, event.impacts.markerOps);
      // A rename that matched no existing structure is a STOCK-map city rename (stock
      // cities live in PMTiles, not world.markers) — record it as an override layer so
      // the label layer can show the new name (see Cities.jsx / cityRenames).
      for (const raw of normalizeArray(event.impacts.markerOps)) {
        const op = normalizeMarkerOp(raw);
        if (!op || op.op !== "rename" || !op.name) continue;
        const matched = before.some((m) =>
          op.markerId ? m.id === op.markerId : m.name.toLowerCase() === op.name.toLowerCase());
        if (!matched) {
          nextWorld.cityRenames = { ...(nextWorld.cityRenames || {}), [op.name.toLowerCase()]: op.newName };
        }
      }
    }
  }

  // Once the administrative region itself changes hands, its tactical patches
  // are stale. A subsequent battle can recreate them under the new owner.
  const completedRegionKeys = new Set(
    [...completedRegionTransfers].map((value) => normalizeOptionalString(value).toLowerCase()).filter(Boolean),
  );
  nextWorld.controlSectors = nextWorld.controlSectors.filter(
    (sector) => !completedRegionKeys.has(normalizeOptionalString(sector.regionId).toLowerCase()),
  );
  nextWorld.territoryFragments = nextWorld.territoryFragments.filter(
    (fragment) => !completedRegionKeys.has(normalizeOptionalString(fragment.parentRegionId).toLowerCase()),
  );

  return {
    colors: nextColors,
    world: nextWorld,
  };
};
