import dayjs from "dayjs";
import { JSON_URLS, getNationTags, loadRegionCatalog, readJson } from "../../runtime/assets.js";
import { resolveAllCountryTags, resolveCountryTags } from "../../runtime/countryTags.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  buildActionDisplayText,
  isPolityLandless,
  normalizeActionEntry,
  normalizeActions,
  normalizeChats,
  normalizeEvents,
  normalizeWorldState,
} from "../../runtime/gameState.js";
import { buildRegionOwnershipText } from "./regionVocab.js";
import { buildCanonicalStateForPrompt } from "../../runtime/operationalState.js";
import { clipTokenContext } from "./tokenBudget.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const promptText = (value, maxChars = 900) => clipTokenContext(normalizeString(value), maxChars);

export const renderTemplate = (template, variables) =>
  String(template ?? "").replace(/\$\{([^}]+)\}/g, (_match, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });

export const resolveHelperValues = (helperTemplates, variables) => {
  let resolved = {};

  for (let pass = 0; pass < 2; pass += 1) {
    resolved = Object.fromEntries(
      Object.entries(helperTemplates).map(([key, template]) => [
        key,
        renderTemplate(template, { ...variables, ...resolved }),
      ]),
    );
  }

  return resolved;
};

export const getUnconsolidatedEvents = (events, world) => {
  const normalizedEvents = normalizeEvents(events);
  const history = normalizeWorldState(world).consolidatedHistory;
  const throughEventId = history.at(-1)?.throughEventId;
  if (!throughEventId) return normalizedEvents;

  const boundaryIndex = normalizedEvents.findIndex((event) => event.id === throughEventId);
  return boundaryIndex >= 0 ? normalizedEvents.slice(boundaryIndex + 1) : normalizedEvents;
};

export const buildEventHistoryText = (events, { limit = 10, world = null } = {}) => {
  const normalizedEvents = world ? getUnconsolidatedEvents(events, world) : normalizeEvents(events);
  if (normalizedEvents.length === 0) {
    return "No unconsolidated events have been recorded yet.";
  }

  return normalizedEvents
    .slice(-limit)
    .map((event) => {
      const date = normalizeString(event.date) || "undated";
      const description = promptText(event.description, 900);
      const impactNotes = [];

      if (event.impacts.regionTransfers.length > 0) {
        impactNotes.push(
          `Territorial shifts: ${event.impacts.regionTransfers.slice(0, 12)
            .map((entry) => `${entry.regionName || entry.regionId} -> ${entry.toCode}`)
            .join(", ")}${event.impacts.regionTransfers.length > 12 ? ` (+${event.impacts.regionTransfers.length - 12} more)` : ""}`,
        );
      }

      if (event.impacts.polityChanges.length > 0) {
        impactNotes.push(
          `Polity changes: ${event.impacts.polityChanges.slice(0, 12)
            .map((entry) => `${entry.code}${entry.name ? ` renamed to ${entry.name}` : ""}${entry.color ? ` color ${entry.color}` : ""}`)
            .join(", ")}${event.impacts.polityChanges.length > 12 ? ` (+${event.impacts.polityChanges.length - 12} more)` : ""}`,
        );
      }

      return [
        `- ${date}: ${event.title}`,
        description ? `  ${description}` : "",
        impactNotes.length > 0 ? `  ${impactNotes.join(" | ")}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n");
};

export const buildConsolidatedHistoryText = (world) => {
  const entries = normalizeWorldState(world).consolidatedHistory;
  if (entries.length === 0) return "No earlier campaign history has been consolidated yet.";

  // Preserve samples across the whole campaign, not just its beginning/end.
  // New saves keep one rolling entry; this also bounds older multi-entry saves.
  const selected = entries.length <= 12
    ? entries.map((entry, index) => ({ entry, index }))
    : Array.from({ length: 12 }, (_, slot) => {
      const index = Math.round((slot * (entries.length - 1)) / 11);
      return { entry: entries[index], index };
    });
  return selected
    .map(({ entry, index }, selectedIndex) => {
      const previousIndex = selectedIndex > 0 ? selected[selectedIndex - 1].index : -1;
      const omitted = Math.max(0, index - previousIndex - 1);
      const gap = omitted > 0 ? `[${omitted} intermediate history batches omitted]\n` : "";
      return `${gap}Through ${entry.throughDate || "an earlier date"}: ${promptText(entry.summary, 1400)}`;
    })
    .join("\n\n");
};

export const buildCampaignHistoryText = (events, world, { limit = 24 } = {}) => [
  "STORY SO FAR:",
  buildConsolidatedHistoryText(world),
  "",
  "RECENT EVENTS:",
  buildEventHistoryText(events, { limit, world }),
].join("\n");

export const buildChatSummaryText = (chats, { limit = 4 } = {}) => {
  const normalizedChats = normalizeChats(chats);
  if (normalizedChats.length === 0) return "No diplomatic chats are currently recorded.";

  return normalizedChats.slice(0, limit).map((chat) => {
    const participants = chat.countries.map((country) => country.name).join(", ");
    const lastMessage = chat.messages.at(-1);
    return `- ${participants}: ${lastMessage ? `${lastMessage.speaker || lastMessage.role}: ${promptText(lastMessage.text, 500)}` : "no messages yet"}`;
  }).join("\n");
};

export const buildDetailedChatHistoryText = (chats, { limit = 8, messageLimit = 10 } = {}) => {
  const normalizedChats = normalizeChats(chats);
  if (normalizedChats.length === 0) return "No chats occurred in these rounds.";

  return normalizedChats.slice(0, limit).map((chat, index) => {
    const header = `Chat ${index + 1}: ${chat.countries.map((country) => country.name).join(", ")}`;
    const body = chat.messages.length > 0
      ? chat.messages.slice(-messageLimit).map((message) => `${message.speaker || message.role}: ${promptText(message.text, 700)}`).join("\n")
      : "No messages yet.";
    return `${header}\n${body}`;
  }).join("\n\n");
};

export const buildAdvisorHistoryText = (messages, { limit = 18 } = {}) => {
  const normalizedMessages = normalizeArray(messages).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const role = normalizeString(entry.role || entry.speaker || "message");
    const text = promptText(entry.text || entry.content || entry.message, 900);
    return role && text ? `${role}: ${text}` : null;
  }).filter(Boolean);

  return normalizedMessages.length > 0
    ? normalizedMessages.slice(-limit).join("\n")
    : "No advisor messages are currently recorded.";
};

export const buildActionHistoryText = (actions, { includeResolved = false, limit = includeResolved ? 24 : 48 } = {}) => {
  const normalizedActions = normalizeActions(actions);
  const filteredActions = includeResolved
    ? normalizedActions
    : normalizedActions.filter((action) => action.status === "planned");
  if (filteredActions.length === 0) {
    return includeResolved ? "No actions have been recorded yet." : "No planned actions are currently queued.";
  }

  const planned = filteredActions.filter((action) => action.status === "planned");
  const resolved = filteredActions.filter((action) => action.status !== "planned");
  const selected = includeResolved
    ? [...planned, ...resolved.slice(-Math.max(0, limit - planned.length))]
    : filteredActions.slice(-limit);
  const omitted = Math.max(0, filteredActions.length - selected.length);
  return selected.map((action) => {
    const kindLabel = action.kind === "chat" ? "chat" : "action";
    const statusLabel = action.status !== "planned" ? ` [${action.status}]` : "";
    return `- (${kindLabel}) ${promptText(action.title, 180)}${statusLabel}: ${promptText(buildActionDisplayText(action), 700)}`;
  }).join("\n") + (omitted > 0 ? `\n(+${omitted} older resolved actions omitted)` : "");
};

export const formatActionsForPrompt = (actions) => normalizeArray(actions)
  .slice(-48)
  .map((entry) => {
    if (typeof entry === "string") return promptText(entry, 700);
    const normalized = normalizeActionEntry(entry);
    return normalized ? `- ${promptText(normalized.title, 180)}: ${promptText(buildActionDisplayText(normalized), 700)}` : "";
  })
  .filter(Boolean)
  .join("\n");

export const formatDateReadable = (value) => {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("D MMMM YYYY") : normalizeString(value);
};

export const buildDifficultyGuidance = (difficulty, mode = "general") => {
  const normalized = normalizeString(difficulty).toLowerCase().replace(/[\s_]+/g, "-");
  const intro = mode === "chats"
    ? "Diplomatic concessions and cooperation should scale with the difficulty."
    : "Long-term success and geopolitical leverage should scale with the difficulty.";

  switch (normalized) {
    case "very-easy": return `${intro} The player can turn even modest preparation into results, and setbacks should stay forgiving.`;
    case "easy": return `${intro} The player can convert reasonable preparation into results relatively easily.`;
    case "hard": return `${intro} The player should need stronger leverage, preparation, and credibility before major outcomes stick.`;
    case "very-hard":
    case "extreme": return `${intro} Major outcomes should require overwhelming preparation, sustained leverage, or unusually favorable conditions.`;
    case "impossible": return `${intro} Outcomes should almost never break the player's way without extraordinary, sustained, multi-front effort.`;
    default: return `${intro} Outcomes should feel plausible and earned without becoming static.`;
  }
};

export const buildRecentRoundsWithDates = (bundle) => {
  const history = normalizeArray(bundle.world?.simulationHistory);
  if (history.length === 0) return `Current round only: ${bundle.game.gameDate || "unknown date"}`;
  return history.slice(0, 8)
    .map((entry) => `${entry.fromDate || "unknown"} -> ${entry.toDate || entry.date || "unknown"}`)
    .join("; ");
};

export const buildUnitsSummaryText = (world) => {
  const units = normalizeArray(world?.units);
  if (units.length === 0) return "No military units are currently deployed on the map.";
  return units.slice(0, 60).map((unit) => {
    const lat = Number(unit.lat);
    const lng = Number(unit.lng);
    const coords = Number.isFinite(lat) && Number.isFinite(lng)
      ? `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}`
      : "unknown location";
    return `- ${unit.name} [id ${unit.id}] (${unit.type}, owner ${unit.ownerCode}, strength ${unit.strength}, status ${unit.status}) at ${coords}${unit.regionId ? `, region ${unit.regionId}` : ""}`;
  }).join("\n");
};

const contextRecordList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  const recordFields = new Set([
    "id", "figureId", "name", "fullName", "figure", "person", "role", "position", "title",
    "polity", "country", "ownerCode", "capacity", "productionCapacity", "output", "facility",
    "quantity", "amount", "date", "kind", "category", "item", "project", "system", "note",
    "description",
  ]);
  if (Object.keys(value).some((key) => recordFields.has(key))) return [value];

  return Object.entries(value).map(([key, entry]) => (
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? { id: key, ...entry }
      : { id: key, value: entry }
  ));
};

const clipContextValue = (value, limit = 240) => {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
};

const formatContextValue = (value, depth = 0) => {
  if (value == null) return "";
  if (typeof value !== "object") return clipContextValue(normalizeString(value));
  if (depth >= 1) return clipContextValue(JSON.stringify(value));
  if (Array.isArray(value)) {
    return clipContextValue(value.slice(0, 5).map((entry) => formatContextValue(entry, depth + 1)).filter(Boolean).join(", "));
  }
  return clipContextValue(Object.entries(value)
    .slice(0, 5)
    .map(([key, entry]) => `${key} ${formatContextValue(entry, depth + 1)}`)
    .filter((entry) => entry.trim())
    .join(", "));
};

const buildCompactContextSummary = (value, {
  emptyText,
  labelFields,
  heading,
  limit = 32,
}) => {
  const records = contextRecordList(value);
  if (records.length === 0) return emptyText;

  const lines = records.slice(0, limit).map((record, index) => {
    if (!record || typeof record !== "object") return `- ${formatContextValue(record)}`;
    const label = labelFields
      .map((field) => formatContextValue(record[field]))
      .find(Boolean) || `Record ${index + 1}`;
    const details = Object.entries(record)
      .filter(([key, entry]) => !labelFields.includes(key) && key !== "id" && entry != null && entry !== "")
      .slice(0, 8)
      .map(([key, entry]) => `${key} ${formatContextValue(entry)}`)
      .filter((entry) => entry.trim());
    return `- ${label}${details.length > 0 ? `: ${details.join("; ")}` : ""}`;
  });

  const suffix = records.length > limit ? `\n(+${records.length - limit} more records not listed)` : "";
  return `${heading}:\n${lines.join("\n")}${suffix}`;
};

export const buildKeyFiguresSummaryText = (world) => {
  const figures = normalizeWorldState(world).keyFigures;
  if (figures.length === 0) return "No key-figure records are currently supplied.";
  const listText = (value, limit = 3) => normalizeArray(value)
    .slice(0, limit)
    .map((entry) => typeof entry === "object" ? entry?.title || entry?.name || entry?.summary || "" : String(entry ?? ""))
    .filter(Boolean)
    .join(", ");

  const lines = figures.slice(0, 80).map((figure) => {
    const mode = String(figure.brainMode || (figure.brainEnabled ? "full" : "off")).toLowerCase();
    const base = [
      `${figure.name || figure.id || "Unnamed figure"}`,
      figure.role ? `role ${figure.role}` : "",
      figure.polity ? `polity ${figure.polity}` : "",
      `status ${figure.status || "unknown"}`,
      `brain ${["off", "light", "full"].includes(mode) ? mode : "off"}`,
      figure.meetingAccess ? `access ${figure.meetingAccess}` : "",
      Array.isArray(figure.meetingModes) && figure.meetingModes.length > 0 ? `channels ${figure.meetingModes.join(", ")}` : "",
      figure.birthDate ? `born ${figure.birthDate}` : "",
      figure.deathDate ? `died ${figure.deathDate}` : "",
    ].filter(Boolean);
    if (mode === "off") return `- ${base.join("; ")} (factual record only; no personal brain)`;

    const compact = [
      Array.isArray(figure.goals) && figure.goals.length > 0 ? `goals ${figure.goals.slice(0, 3).join(", ")}` : "",
      Array.isArray(figure.traits) && figure.traits.length > 0 ? `traits ${figure.traits.slice(0, 3).join(", ")}` : "",
      figure.location ? `location ${promptText(figure.location, 240)}` : "",
    ].filter(Boolean);
    if (mode !== "full") return `- ${base.join("; ")}${compact.length ? `; ${compact.join("; ")}` : ""} (light dossier; do not call a personal brain)`;

    const privateState = [
      ...compact,
      figure.thought ? `thought ${promptText(figure.thought, 500)}` : "",
      Array.isArray(figure.achievements) && figure.achievements.length > 0 ? `achievements ${listText(figure.achievements.slice(-3))}` : "",
      Array.isArray(figure.projects) && figure.projects.length > 0 ? `projects ${listText(figure.projects)}` : "",
    ].filter(Boolean);
    return `- ${base.join("; ")}${privateState.length ? `; ${privateState.join("; ")}` : ""}`;
  });
  const suffix = figures.length > 80 ? `\n(+${figures.length - 80} more factual records not listed)` : "";
  return `KEY FIGURES (orchestrator budget; most people stay off):\n${lines.join("\n")}${suffix}`;
};

export const buildMilitaryIndustrySummaryText = (world) => {
  const industry = world?.militaryIndustry;
  const sections = ["arsenal", "research", "production", "ledger"]
    .filter((section) => contextRecordList(industry?.[section]).length > 0);
  if (sections.length === 0) {
    const hasSectionShape = industry && typeof industry === "object" && !Array.isArray(industry)
      && ["arsenal", "research", "production", "ledger"].some((section) => section in industry);
    if (hasSectionShape) return "No military-industry records are currently supplied.";
    return buildCompactContextSummary(industry, {
      emptyText: "No military-industry records are currently supplied.",
      heading: "MILITARY INDUSTRY",
      labelFields: ["name", "polity", "country", "ownerCode", "owner", "code", "id"],
    });
  }

  return sections.map((section) => buildCompactContextSummary(industry[section], {
    emptyText: "",
    heading: section.toUpperCase(),
    labelFields: ["name", "item", "title", "project", "polity", "country", "ownerCode", "owner", "id"],
    limit: 16,
  })).join("\n");
};

// Tactical sectors are the fine-grained layer beneath administrative region
// ownership. Keep the summary compact but explicit so the model can continue a
// battle across several jumps instead of recreating a fresh front every turn.
export const buildControlSectorsSummaryText = (world) => {
  const sectors = normalizeWorldState(world).controlSectors;
  if (sectors.length === 0) return "No tactical control sectors or prolonged battles are currently recorded.";
  const lines = sectors.slice(0, 80).map((sector) => {
    const center = sector.center && typeof sector.center === "object" ? sector.center : {};
    const lat = Number(center.lat);
    const lng = Number(center.lng);
    const coords = Number.isFinite(lat) && Number.isFinite(lng)
      ? `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}`
      : "unknown location";
    const opposition = sector.contestedBy
      ? `, contested by ${Array.isArray(sector.contestedBy) ? sector.contestedBy.join(", ") : sector.contestedBy}`
      : "";
    const battle = sector.battleId ? `, battle ${sector.battleId}` : "";
    const started = sector.startedAt ? `, started ${sector.startedAt}` : "";
    const cells = (sector.cells || []).slice(0, 24).map((cell) => {
      const cellCenter = cell.center && typeof cell.center === "object" ? cell.center : {};
      const cellLat = Number(cellCenter.lat);
      const cellLng = Number(cellCenter.lng);
      const cellCoords = Number.isFinite(cellLat) && Number.isFinite(cellLng)
        ? `@${cellLat.toFixed(2)},${cellLng.toFixed(2)}`
        : "@unknown";
      const cellOpposition = cell.contestedBy
        ? ` vs ${Array.isArray(cell.contestedBy) ? cell.contestedBy.join("/") : cell.contestedBy}`
        : "";
      const parent = cell.parentCellId ? ` child-of ${cell.parentCellId}` : "";
      return `${cell.id}=${cell.ownerCode} ${cell.control}% depth ${cell.depth || 1}${cellOpposition}${parent} ref ${sector.id}:${cell.id} ${cellCoords}`;
    }).join(", ");
    const cellSummary = cells ? `; cells: ${cells}` : "";
    return `- ${sector.name} [id ${sector.id}] in region ${sector.regionId}: ${sector.ownerCode} controls ${sector.control}%${opposition}; status ${sector.status}; center ${coords}; radius ${sector.radiusKm} km${battle}${started}${cellSummary}${sector.note ? ` — ${promptText(sector.note, 400)}` : ""}`;
  }).join("\n");
  return "These are partial tactical-control patches inside administrative regions, not region ownership. Cell depth is limited to 2: depth 1 is the normal grid, depth 2 is the final micro-cell level. Reference a leaf cell as sectorId:cellId. Update them with sectorOps; use territoryOps for a named cell-backed subregion; use regionTransfers only for a complete administrative change.\n" + lines;
};

export const buildTerritoryFragmentsSummaryText = (world) => {
  const fragments = normalizeWorldState(world).territoryFragments;
  if (fragments.length === 0) return "No named subregions, autonomous pockets, or secession fragments are currently recorded.";
  return fragments.slice(0, 60).map((fragment) =>
    `- ${fragment.name} [id ${fragment.id}] (${fragment.kind}, ${fragment.status}, owner ${fragment.ownerCode}) inside region ${fragment.parentRegionId}; cells ${fragment.cellRefs.slice(0, 64).join(", ")}${fragment.note ? ` — ${promptText(fragment.note, 400)}` : ""}`,
  ).join("\n");
};

// Structures founded during play (world.markers): cities, military bases,
// bunkers, missile silos, embassies. Listed with coordinates so the model can
// reference, defend, target, or expand them — and knows their names are taken.
export const buildMarkersSummaryText = (world) => {
  const markers = normalizeArray(world?.markers);
  if (markers.length === 0) return "No player-placed map markers or AI-built structures are currently recorded.";
  return markers.slice(0, 60).map((marker) => {
    const lat = Number(marker.lat);
    const lng = Number(marker.lng);
    const coords = Number.isFinite(lat) && Number.isFinite(lng)
      ? `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}`
      : "unknown location";
    return `- ${marker.name} [id ${marker.id}] (${marker.kind}${marker.ownerCode ? `, owner ${marker.ownerCode}` : ""}, source ${marker.source}, status ${marker.status}) at ${coords}${marker.note ? ` — ${promptText(marker.note, 400)}` : ""}`;
  }).join("\n");
};

export const buildMilitaryReservesSummaryText = (world) => {
  const reserves = normalizeWorldState(world).militaryReserves;
  const entries = Object.entries(reserves);
  if (entries.length === 0) return "No military reserve sheets are currently reported. Do not assume zero; logistics data has not been supplied yet.";
  const formatValue = (sheet, field, value) => sheet?.reported?.[field] === false ? "UNKNOWN" : value;
  const formatMap = (sheet, field, value) => {
    if (sheet?.reported?.[field] === false) return "UNKNOWN";
    const pairs = Object.entries(value || {}).map(([key, amount]) => `${key} ${amount}`);
    return pairs.length ? pairs.join(", ") : "none reported";
  };
  return entries.slice(0, 40).map(([owner, sheet]) =>
    `- ${owner}: manpower reserve ${formatValue(sheet, "manpower", sheet.manpower)}, committed ${formatValue(sheet, "manpowerCommitted", sheet.manpowerCommitted)}; equipment [${formatMap(sheet, "equipment", sheet.equipment)}]; munitions [${formatMap(sheet, "munitions", sheet.munitions)}]; fuel ${formatValue(sheet, "fuel", sheet.fuel)}; supplies ${formatValue(sheet, "supplies", sheet.supplies)}; maintenance ${formatValue(sheet, "maintenance", sheet.maintenance)}${sheet.note ? ` — ${sheet.note}` : ""}`,
  ).join("\n");
};

// City coordinates for the model, so troop deployments and events land on the
// actual city instead of a guess. Two sources, mirroring the map's own layer:
// custom-city scenarios use their era set; everything else uses the significant
// slice of the stock database (capitals + metropolises). Only the stock slice is
// cached — it's a static asset, while the custom set changes with the scenario.
const CITY_CATALOG_LIMIT = 200;
let _stockCityCatalogCache = null;

// Same resolution the editor's city importer uses: the seed rides the content
// node on web builds and same-origin /assets locally.
const CITY_SEED_URL = `${(import.meta.env.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "")}/cities-seed.json`;

const formatCityLine = (name, country, lat, lng, extra = "") =>
  `- ${name}${country ? ` (${country})` : ""}: lat ${Number(lat).toFixed(2)}, lng ${Number(lng).toFixed(2)}${extra}`;

export const buildCityCatalogText = async (world) => {
  try {
    if (world?.customCities) {
      const geojson = await readJson(JSON_URLS.citiesGeojson, { defaultValue: null, force: true });
      const features = normalizeArray(geojson?.features)
        .filter((feature) => Array.isArray(feature?.geometry?.coordinates))
        .sort((a, b) =>
          (b.properties?.tier ?? 0) - (a.properties?.tier ?? 0)
          || (b.properties?.population ?? 0) - (a.properties?.population ?? 0))
        .slice(0, CITY_CATALOG_LIMIT);
      if (features.length) {
        return features.map((feature) => {
          const props = feature.properties ?? {};
          const [lng, lat] = feature.geometry.coordinates;
          return formatCityLine(props.city || props.name || "Unnamed", "", lat, lng, props.capital === "primary" ? " (capital)" : "");
        }).join("\n");
      }
      return "No city coordinate catalog is available.";
    }

    if (_stockCityCatalogCache) return _stockCityCatalogCache;
    const response = await fetch(CITY_SEED_URL);
    const seed = response.ok ? await response.json() : [];
    const significant = normalizeArray(seed)
      .filter((city) => Array.isArray(city?.coord)
        && (city.capital === "primary" || (city.population ?? 0) >= 2000000))
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
      .slice(0, CITY_CATALOG_LIMIT);
    if (significant.length) {
      _stockCityCatalogCache = significant.map((city) =>
        formatCityLine(city.name, city.country, city.coord[1], city.coord[0], city.capital === "primary" ? " (capital)" : ""),
      ).join("\n");
      return _stockCityCatalogCache;
    }
    return "No city coordinate catalog is available.";
  } catch {
    // A missing catalog degrades to the old behavior (model guesses), never breaks a jump.
    return "No city coordinate catalog is available.";
  }
};

const loadRegions = async () => loadRegionCatalog().catch(() => []);

// The land the player's polity holds — or an explicit statement that it holds none.
// A landless player is a deliberate scenario, not missing data (a government in
// exile, a stateless movement leading a campaign to take a nation back), so it must
// read to the model as an intentional condition rather than an empty field, or the
// model tries to run a normal territorial power and invents holdings.
const LANDLESS_PLAYER_TEXT =
  "This polity is LANDLESS — it currently holds no territory. It is a stateless "
  + "actor (a government-in-exile, a movement, or a power that has lost its land), "
  + "and its story is about influence, alliances, insurgency, and the fight to gain "
  + "or retake territory — not about administering provinces it does not have.";

export const buildPlayerPolityRegionsText = async (bundle, regionCatalog = null) => {
  const playerCode = normalizeString(bundle.game.country);
  if (!playerCode) return "No player polity is currently set.";
  const world = normalizeWorldState(bundle.world);
  const entries = Object.entries(world.regionOwnershipOverrides);
  const owns = entries.some(([, ownerCode]) => normalizeString(ownerCode).toLowerCase() === playerCode.toLowerCase());
  // Zero regions AND the polity exists = deliberately landless. Distinguish that
  // from a scenario that simply ships no override list (a stock modern map, where
  // the player owns their country through the base tiles, not an override).
  // isPolityLandless is the shared source of truth for that line (see gameState).
  if (!owns) {
    return isPolityLandless(world, playerCode)
      ? LANDLESS_PLAYER_TEXT
      : "No explicit player region override list is currently recorded.";
  }
  const regions = regionCatalog ?? await loadRegions();
  const lookup = new Map(regions.map((region) => [region.id, region]));
  const names = entries
    .filter(([, ownerCode]) => normalizeString(ownerCode).toLowerCase() === playerCode.toLowerCase())
    .slice(0, 24)
    .map(([regionId]) => lookup.get(regionId)?.name || regionId);
  return names.join(", ");
};

export const buildWorldSummary = async (bundle, regionCatalog = null) => {
  const world = normalizeWorldState(bundle.world);
  const regions = regionCatalog ?? await loadRegions();
  const regionLookup = new Map(regions.map((region) => [region.id, region]));
  const territoryEntries = Object.entries(world.regionOwnershipOverrides);
  const territorySummary = territoryEntries.length === 0
    ? "No territorial overrides from the base scenario are currently recorded."
    : territoryEntries.slice(0, 60).map(([regionId, ownerCode]) => {
      const region = regionLookup.get(regionId);
      return `- ${region?.name || regionId}${region?.country ? ` (${region.country})` : ""} -> ${ownerCode}`;
    }).join("\n");
  const polities = Object.values(world.polityOverrides);
  const politySummary = polities.length === 0
    ? "No dynamic polity overrides are currently recorded."
    : polities.slice(0, 16).map((entry) =>
      // `note` is the polity's lore — the author's (or the faction creator's) own
      // description of who this power is. It was persisted but never reached the
      // model, so a player-written backstory did nothing. It steers the story now.
      `- ${entry.code}: ${entry.name || entry.code}${entry.color ? ` (${entry.color})` : ""}${entry.aliases.length > 0 ? ` aliases ${entry.aliases.slice(0, 8).join(", ")}` : ""}${entry.note ? ` — ${promptText(entry.note, 700)}` : ""}`,
    ).join("\n");

  // What each country IS: the map-maker's tags with the AI's own changes layered
  // over them. This is the whole reason tags exist — the model reads it for every
  // task, so "socialist, anti-nato" steers what the Soviet Union plausibly does
  // without any rule saying so. Capped at 40 countries for prompt budget; drop
  // whole countries rather than truncate one list, since "- SOV: socialist," reads
  // as corrupt data to the model.
  const baseTags = await getNationTags().catch(() => ({}));
  const tagged = resolveAllCountryTags(baseTags, world);
  const taggedCodes = Object.keys(tagged);
  const tagSummary = taggedCodes.length === 0
    ? "No countries have defining tags."
    : taggedCodes.slice(0, 40).map((code) => `- ${code}: ${tagged[code].slice(0, 12).join(", ")}`).join("\n")
      + (taggedCodes.length > 40 ? `\n(+${taggedCodes.length - 40} more tagged countries not listed)` : "");
  const playerTags = resolveCountryTags(baseTags, world, bundle.game.country);

  // The region vocabulary the jump prompt promises ("every ... region ... separated
  // by a comma ... ANALYZE THIS INCREDIBLY CAREFULLY"). Until now nothing filled it,
  // so on a stock map the model saw ZERO region names and invented ones that then
  // failed resolveRegionTransfers and got silently dropped — a narrated capture that
  // never moved the map. buildRegionOwnershipText is TIERED so we hand names where
  // they are needed without dumping all ~3000 provinces every jump: FULL `name (id)`
  // lists only for the powers IN PLAY (the "focus" set below), and codes-only for
  // everyone else (the model names their regions on demand and the retry resolves
  // them). Focus = the player, anyone already re-owned, scenario-defined actors, and
  // the player's active chat partners — the likely belligerents.
  // Every focus token is a FULL COUNTRY NAME, because that is what the vocabulary is
  // keyed by (regionOwnerName). A legacy override still holding "ESP" is canonicalised
  // so it matches "Spain" — otherwise that power silently drops out of the enumerated
  // section and the model is left inventing its region names again.
  const playerName = toCountryName(normalizeString(bundle.game.country));
  const overrideOwnerNames = [...new Set(
    territoryEntries.map(([, owner]) => toCountryName(normalizeString(owner))).filter(Boolean),
  )];
  const actorNames = polities.map((entry) => toCountryName(normalizeString(entry?.code))).filter(Boolean);
  const chatNames = normalizeArray(bundle.chats).flatMap((chat) =>
    normalizeArray(chat?.countries).map((country) => toCountryName(normalizeString(country?.code))).filter(Boolean));
  const focusCodes = [playerName, ...overrideOwnerNames, ...actorNames, ...chatNames].filter(Boolean);
  // Owner name -> display name for both sections: base country names from the catalog,
  // with dynamic polity overrides layered on top (a re-owned/renamed power wins).
  const polityNames = {};
  for (const region of regions) {
    const name = String(region.country || toCountryName(region.countryCode) || "").toLowerCase();
    if (name && !polityNames[name]) polityNames[name] = region.country || toCountryName(region.countryCode);
  }
  for (const entry of polities) {
    if (entry?.code) polityNames[toCountryName(String(entry.code)).toLowerCase()] = entry.name || toCountryName(entry.code);
  }
  const regionOwnershipCatalog = buildRegionOwnershipText(regions, world.regionOwnershipOverrides, {
    focusCodes,
    polityNames,
  });

  return [
    `Player polity: ${bundle.game.country || "Unknown polity"}${playerTags.length ? ` (${playerTags.join(", ")})` : ""}`,
    `Current round: ${bundle.game.round || 1}`,
    `Current date: ${bundle.game.gameDate || "unknown"}`,
    `Language: ${world.language || bundle.game.language || "English"}`,
    `Difficulty: ${bundle.game.difficulty || "standard"}`,
    `World before round one: ${promptText(world.startingTimelineText, 6000) || "No world briefing provided."}`,
    `Simulation rules: ${promptText(world.simulationRules, 6000) || "No extra simulation rules were provided."}`,
    "",
    "Territorial changes from the base scenario:",
    territorySummary,
    "",
    "Map ownership (this IS the comma-separated region list referenced above — the "
      + "region vocabulary for regionTransfers):",
    regionOwnershipCatalog,
    "",
    "Dynamic polity overrides:",
    politySummary,
    "",
    "What each country is (ideology, alignment, posture). Treat these as binding "
      + "characterisation: act, speak and react in keeping with them, and only change "
      + "them via polityChanges when events genuinely reshape a country.",
    tagSummary,
    "",
    world.activeCatalyst
      ? `Active catalyst: ${world.activeCatalyst.title || "untitled"} - ${world.activeCatalyst.premise || world.activeCatalyst.opening || ""}`
      : "No active catalyst scene.",
  ].join("\n");
};

export const buildPromptContext = async (bundle, {
  actionInput = "",
  advisorLimit = 18,
  canonicalStateOptions = {},
  catalystChoice = "",
  catalystHistory = "",
  catalystOpening = "",
  catalystPremise = "",
  chat = null,
  chatLimit = 8,
  chatsToConsolidate = "",
  eventLimit = 10,
  eventsToConsolidate = "",
  excludeCurrentChatFromLongHistory = false,
  gameMasterRequest = "",
  longEventLimit = 24,
  respondingPolityName = "",
  targetDate = "",
} = {}) => {
  const normalizedChat = chat && typeof chat === "object" ? normalizeChats([chat])[0] : null;
  const regionCatalog = await loadRegions();
  const date = bundle.game.gameDate || "";
  const target = targetDate || date;
  const worldSummary = await buildWorldSummary(bundle, regionCatalog);
  const citiesSummary = await buildCityCatalogText(bundle.world);
  const recentEvents = buildEventHistoryText(bundle.events, { limit: eventLimit, world: bundle.world });
  const campaignHistory = buildCampaignHistoryText(bundle.events, bundle.world, { limit: longEventLimit });
  const allActions = buildActionHistoryText(bundle.actions, { includeResolved: true });
  const actionText = formatActionsForPrompt(bundle.actions);
  const consolidatedChatIds = new Set(
    normalizeWorldState(bundle.world).consolidatedHistory.flatMap((entry) => entry.chatIds),
  );
  const unconsolidatedChats = normalizeChats(bundle.chats)
    .filter((entry) => !consolidatedChatIds.has(entry.id));
  const currentChat = normalizedChat ?? unconsolidatedChats[0] ?? null;
  const currentChatParticipants = [
    ...normalizeArray(currentChat?.countries).map((participant) => participant.name),
    ...normalizeArray(currentChat?.figures).map((participant) => participant.name),
  ].filter(Boolean);
  const longHistoryChats = excludeCurrentChatFromLongHistory && currentChat
    ? unconsolidatedChats.filter((entry) => entry.id !== currentChat.id)
    : unconsolidatedChats;

  return {
    actionInput,
    actions: actionText,
    advisorMessages: buildAdvisorHistoryText(bundle.advisor || [], { limit: advisorLimit }),
    allActions,
    canonicalStateSummary: buildCanonicalStateForPrompt({
      actions: bundle.actions,
      events: bundle.events,
      game: bundle.game,
      playerPolity: bundle.game.country || "",
      world: bundle.world,
    }, canonicalStateOptions),
    catalystChoice,
    catalystDate: date,
    catalystHistory,
    catalystOpening,
    catalystPercent: normalizeArray(bundle.world?.activeCatalyst?.history).length > 0
      ? `${Math.min(100, normalizeArray(bundle.world.activeCatalyst.history).length * 50)}%`
      : "0%",
    catalystPremise,
    citiesSummary,
    chat: clipTokenContext(JSON.stringify(unconsolidatedChats), 12000, { preserveEnds: true }),
    chatHistory: currentChat?.messages?.slice(-20).map((message) => `${message.speaker || message.role}: ${promptText(message.text, 900)}`).join("\n") || "No chat history.",
    chatHistoryLong: buildDetailedChatHistoryText(longHistoryChats, { limit: chatLimit }),
    chatParticipants: currentChatParticipants.join(", ") || "",
    chatSummary: buildChatSummaryText(unconsolidatedChats),
    chatsToConsolidate: chatsToConsolidate || buildDetailedChatHistoryText(unconsolidatedChats, { limit: 12, messageLimit: 50 }),
    consolidatedHistory: buildConsolidatedHistoryText(bundle.world),
    date,
    dateReadable: formatDateReadable(date),
    difficulty: bundle.game.difficulty || "standard",
    difficultyGuidanceChats: buildDifficultyGuidance(bundle.game.difficulty, "chats"),
    difficultyGuidanceJumpForward: buildDifficultyGuidance(bundle.game.difficulty, "jump"),
    eventsToConsolidate: eventsToConsolidate || buildEventHistoryText(bundle.events, { limit: 12 }),
    gameMasterRequest,
    language: bundle.world.language || bundle.game.language || "English",
    lastSpeaker: currentChat?.messages?.at(-1)?.speaker || "",
    keyFiguresSummary: buildKeyFiguresSummaryText(bundle.world),
    markersSummary: buildMarkersSummaryText(bundle.world),
    militaryIndustrySummary: buildMilitaryIndustrySummaryText(bundle.world),
    numberOfRegions: String(regionCatalog.length),
    plannedActions: buildActionHistoryText(bundle.actions),
    playerBattalionSummaries: buildUnitsSummaryText(bundle.world),
    controlSectorsSummary: buildControlSectorsSummaryText(bundle.world),
    territoryFragmentsSummary: buildTerritoryFragmentsSummaryText(bundle.world),
    militaryReservesSummary: buildMilitaryReservesSummaryText(bundle.world),
    playerPolity: bundle.game.country || "Unknown polity",
    playerPolityRegions: await buildPlayerPolityRegionsText(bundle, regionCatalog),
    recentEvents,
    recentEventsLong: campaignHistory,
    recentRoundsWithDates: buildRecentRoundsWithDates(bundle),
    respondingPolityName: respondingPolityName || currentChatParticipants.find((name) => name !== bundle.game.country) || "",
    round: String(bundle.game.round || 1),
    simulationRules: promptText(bundle.world.simulationRules, 6000) || "No extra simulation rules were provided.",
    startDate: bundle.game.startDate || "",
    targetDate: target,
    targetDateReadable: formatDateReadable(target),
    unitsSummary: buildUnitsSummaryText(bundle.world),
    worldBeforeRoundOne: promptText(bundle.world.startingTimelineText, 6000) || "No pre-game world briefing was provided.",
    worldSummary,
    worldSummaryNoCity: worldSummary,
  };
};
