import {
  normalizeActions,
  normalizeEvents,
  normalizeGameData,
  normalizeWorldState,
} from "./gameState.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clone = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const increment = (map, key, amount = 1) => {
  const safeKey = text(key) || "Unknown";
  map[safeKey] = (map[safeKey] || 0) + amount;
};

const sortEntries = (entries) => entries.sort(([left], [right]) => left.localeCompare(right));

const buildForceTotals = (units) => {
  const byOwner = {};
  for (const unit of units) {
    const owner = text(unit.ownerCode) || "Unknown";
    const current = byOwner[owner] || {
      count: 0,
      strength: 0,
      byRegion: {},
      byStatus: {},
      byType: {},
    };
    current.count += 1;
    current.strength += Number(unit.strength) || 0;
    increment(current.byRegion, unit.regionId || "unassigned");
    increment(current.byStatus, unit.status || "idle");
    increment(current.byType, unit.type || "infantry");
    byOwner[owner] = current;
  }
  return sortEntries(Object.entries(byOwner)).reduce((result, [owner, summary]) => {
    result[owner] = summary;
    return result;
  }, {});
};

const minimalUnit = (unit) => ({
  id: text(unit.id),
  name: text(unit.name),
  type: text(unit.type),
  ownerCode: text(unit.ownerCode),
  strength: Number(unit.strength) || 0,
  status: text(unit.status) || "idle",
  regionId: text(unit.regionId),
  sectorId: text(unit.sectorId),
  lng: number(unit.lng),
  lat: number(unit.lat),
  orderId: text(unit.orderId),
  note: text(unit.note),
});

const minimalSector = (sector) => ({
  id: text(sector.id),
  regionId: text(sector.regionId),
  name: text(sector.name),
  ownerCode: text(sector.ownerCode),
  contestedBy: clone(sector.contestedBy),
  control: Number(sector.control) || 0,
  status: text(sector.status),
  battleId: text(sector.battleId),
  startedAt: text(sector.startedAt),
  updatedAt: text(sector.updatedAt),
  center: clone(sector.center),
  cells: asArray(sector.cells).map((cell) => ({
    id: text(cell.id),
    cellRef: text(cell.cellRef) || `${text(sector.id)}:${text(cell.id)}`,
    name: text(cell.name),
    parentCellId: text(cell.parentCellId),
    depth: Number(cell.depth) || 1,
    ownerCode: text(cell.ownerCode),
    contestedBy: clone(cell.contestedBy),
    control: Number(cell.control) || 0,
    status: text(cell.status),
    center: clone(cell.center),
  })),
});

const minimalReserveSheet = (sheet) => ({
  manpower: Number(sheet.manpower) || 0,
  manpowerCommitted: Number(sheet.manpowerCommitted) || 0,
  equipment: clone(sheet.equipment || {}),
  munitions: clone(sheet.munitions || {}),
  fuel: Number(sheet.fuel) || 0,
  supplies: Number(sheet.supplies) || 0,
  maintenance: Number(sheet.maintenance) || 0,
  reported: clone(sheet.reported || {}),
  note: text(sheet.note),
  updatedAt: text(sheet.updatedAt),
});

const minimalIndustry = (industry) => Object.fromEntries(
  ["arsenal", "research", "production", "ledger"].map((section) => [
    section,
    asArray(industry?.[section]).map((entry) => ({
      id: text(entry.id),
      name: text(entry.name || entry.item || entry.project),
      ownerCode: text(entry.ownerCode || entry.polity),
      itemId: text(entry.itemId),
      kind: text(entry.kind),
      quantity: number(entry.quantity),
      delta: number(entry.delta),
      progress: number(entry.progress),
      rate: number(entry.rate),
      date: text(entry.date || entry.updatedAt),
      note: text(entry.note),
    })),
  ]),
);

export const buildCanonicalStateSnapshot = ({
  actions = [],
  events = [],
  game = {},
  playerPolity = "",
  world = {},
} = {}) => {
  const normalizedWorld = normalizeWorldState(world);
  const normalizedGame = normalizeGameData(game);
  const units = normalizedWorld.units.map(minimalUnit);
  const sectors = normalizedWorld.controlSectors.map(minimalSector);
  const plannedActions = normalizeActions(actions)
    .filter((action) => action.status === "planned")
    .map((action) => ({
      id: text(action.id),
      title: text(action.title),
      text: text(action.text),
      kind: text(action.kind),
      source: text(action.source),
      unitRevert: clone(action.unitRevert),
    }));
  const normalizedEvents = normalizeEvents(events);
  const player = text(playerPolity || normalizedGame.country);
  const regionsByOwner = {};
  for (const [regionId, ownerCode] of Object.entries(normalizedWorld.regionOwnershipOverrides)) {
    regionsByOwner[ownerCode] = [...(regionsByOwner[ownerCode] || []), regionId];
  }
  for (const owner of Object.keys(regionsByOwner)) regionsByOwner[owner].sort();

  return {
    schemaVersion: 1,
    asOf: {
      date: text(normalizedGame.gameDate || normalizedGame.startDate),
      round: normalizedGame.round,
      playerPolity: player,
    },
    territory: {
      ownershipOverrides: clone(normalizedWorld.regionOwnershipOverrides),
      regionsByOwner,
      controlSectors: sectors,
      territoryFragments: clone(normalizedWorld.territoryFragments),
    },
    forces: {
      totalsByOwner: buildForceTotals(units),
      units,
    },
    logistics: {
      reserveReports: Object.fromEntries(
        Object.entries(normalizedWorld.militaryReserves).map(([owner, sheet]) => [owner, minimalReserveSheet(sheet)]),
      ),
      industry: minimalIndustry(normalizedWorld.militaryIndustry),
      resourceLedger: clone(normalizedWorld.resourceLedger).slice(-48),
    },
    orders: plannedActions,
    recentEvents: normalizedEvents.slice(-12).map((event) => ({
      id: text(event.id),
      date: text(event.date),
      title: text(event.title),
      impactCounts: Object.fromEntries(
        Object.entries(event.impacts || {})
          .filter(([, value]) => Array.isArray(value) && value.length > 0)
          .map(([key, value]) => [key, value.length]),
      ),
    })),
  };
};

const formatMap = (value) => {
  const entries = Object.entries(value || {});
  return entries.length > 0 ? entries.map(([key, amount]) => `${key} ${amount}`).join(", ") : "none reported";
};

const formatReported = (sheet, field, value) => sheet?.reported?.[field] === false ? "UNKNOWN" : value;

const formatReserve = (owner, sheet) => [
  `- ${owner}: manpower reserve ${formatReported(sheet, "manpower", sheet.manpower)}, committed ${formatReported(sheet, "manpowerCommitted", sheet.manpowerCommitted)}, `
    + `fuel ${formatReported(sheet, "fuel", sheet.fuel)}, supplies ${formatReported(sheet, "supplies", sheet.supplies)}, maintenance ${formatReported(sheet, "maintenance", sheet.maintenance)}`,
  `  equipment [${formatReported(sheet, "equipment", formatMap(sheet.equipment))}]; munitions [${formatReported(sheet, "munitions", formatMap(sheet.munitions))}]${sheet.updatedAt ? `; updated ${sheet.updatedAt}` : ""}`,
].join("\n");

const formatForceOwner = (owner, summary) =>
  `- ${owner}: ${summary.count} formations, abstract strength ${summary.strength}; types [${formatMap(summary.byType)}]; regions [${formatMap(summary.byRegion)}]; statuses [${formatMap(summary.byStatus)}]`;

export const buildCanonicalStateSummaryText = (input = {}, {
  maxUnits = 240,
  maxSectors = 80,
  maxLedger = 24,
} = {}) => {
  const snapshot = input.schemaVersion === 1
    ? input
    : buildCanonicalStateSnapshot(input);
  const lines = [
    `CANONICAL WORLD STATE v${snapshot.schemaVersion}`,
    `As of ${snapshot.asOf.date || "unknown date"}; round ${snapshot.asOf.round}; player polity: ${snapshot.asOf.playerPolity || "unknown"}.`,
    "This snapshot is the source of truth for the current turn. Exact reported balances are authoritative; an UNKNOWN field is not zero and must not be spent or invented.",
    "",
    "ORDER OF BATTLE — totals include every stored unit; the roster below may only be truncated for prompt size:",
    ...Object.entries(snapshot.forces.totalsByOwner).map(([owner, summary]) => formatForceOwner(owner, summary)),
  ];

  const visibleUnits = snapshot.forces.units.slice(0, maxUnits);
  lines.push(
    `FORMATION ROSTER (${visibleUnits.length}/${snapshot.forces.units.length}):`,
    ...visibleUnits.map((unit) => {
      const coords = unit.lat == null || unit.lng == null ? "unknown coordinates" : `lat ${unit.lat}, lng ${unit.lng}`;
      return `- ${unit.id}: ${unit.name} (${unit.type}, owner ${unit.ownerCode}, strength ${unit.strength}, status ${unit.status}) at ${coords}${unit.regionId ? `, region ${unit.regionId}` : ""}${unit.sectorId ? `, sector ${unit.sectorId}` : ""}${unit.orderId ? `, order ${unit.orderId}` : ""}${unit.note ? ` — ${unit.note}` : ""}`;
    }),
  );
  if (visibleUnits.length < snapshot.forces.units.length) lines.push(`(+${snapshot.forces.units.length - visibleUnits.length} formations omitted from the roster; totals remain exact.)`);

  const reserveEntries = Object.entries(snapshot.logistics.reserveReports);
  lines.push("", "LOGISTICS AND RESOURCES — reported sheets:");
  if (reserveEntries.length === 0) {
    lines.push("- No reserve sheet exists. Manpower, equipment, munitions, fuel, supplies and maintenance are UNKNOWN, not zero.");
  } else {
    lines.push(...reserveEntries.map(([owner, sheet]) => formatReserve(owner, sheet)));
  }

  const arsenal = snapshot.logistics.industry.arsenal;
  const production = snapshot.logistics.industry.production;
  const ledger = snapshot.logistics.resourceLedger.slice(-maxLedger);
  lines.push("", "MILITARY INDUSTRY:");
  lines.push(arsenal.length ? `- Arsenal: ${arsenal.map((entry) => `${entry.ownerCode || "unknown owner"}/${entry.name || entry.id}=${entry.quantity ?? "?"}`).join("; ")}` : "- Arsenal: no authoritative inventory records.");
  lines.push(production.length ? `- Production: ${production.map((entry) => `${entry.ownerCode || "unknown owner"}/${entry.name || entry.id}${entry.rate == null ? "" : ` rate ${entry.rate}`}${entry.progress == null ? "" : ` progress ${entry.progress}%`}`).join("; ")}` : "- Production: no active lines reported.");
  lines.push(ledger.length ? "RESOURCE TRANSACTIONS:" : "RESOURCE TRANSACTIONS: none recorded.");
  for (const entry of ledger) {
    const sign = Number(entry.signedAmount) < 0 ? "-" : "+";
    lines.push(`- ${entry.date || "undated"} ${entry.ownerCode}: ${sign}${Math.abs(Number(entry.signedAmount) || 0)} ${entry.resource}${entry.item ? `/${entry.item}` : ""}${entry.note ? ` — ${entry.note}` : ""}`);
  }

  const visibleSectors = snapshot.territory.controlSectors.slice(0, maxSectors);
  lines.push("", "TACTICAL CONTROL — cells are partial control inside administrative regions; region ownership is separate:");
  if (visibleSectors.length > 0) {
    lines.push(...visibleSectors.map((sector) => {
      const cells = sector.cells.map((cell) => `${cell.cellRef}=${cell.ownerCode}/${cell.control}%/${cell.status}`).join(", ");
      return `- ${sector.id} ${sector.name} in region ${sector.regionId}: ${sector.ownerCode} ${sector.control}% (${sector.status})${sector.battleId ? ` battle ${sector.battleId}` : ""}; cells [${cells || "none"}]`;
    }));
  } else {
    lines.push("- No tactical sectors or prolonged battles recorded.");
  }
  if (visibleSectors.length < snapshot.territory.controlSectors.length) lines.push(`(+${snapshot.territory.controlSectors.length - visibleSectors.length} tactical sectors omitted.)`);
  if (snapshot.territory.territoryFragments.length > 0) {
    lines.push("NAMED CELL-BACKED FRAGMENTS:", ...snapshot.territory.territoryFragments.slice(0, 60).map((fragment) => `- ${fragment.id}: ${fragment.name}, owner ${fragment.ownerCode}, parent ${fragment.parentRegionId}, cells ${(fragment.cellRefs || []).join(", ")}`));
  }

  lines.push("", "PLANNED PLAYER ORDERS:");
  if (snapshot.orders.length > 0) {
    lines.push(...snapshot.orders.map((order) => `- ${order.id}: ${order.title || order.text}${order.text && order.text !== order.title ? ` — ${order.text}` : ""}`));
  } else {
    lines.push("- No planned player orders.");
  }
  lines.push("", "OPERATIONAL RULES: use forceOps for a scoped withdrawal/redeployment so every matching formation is updated; use unitOps for individual exceptions. Use resourceOps only against a reported balance, and reserveOps for a new absolute report. Never turn missing data into zero.");
  return lines.join("\n");
};

export const buildCanonicalStateForPrompt = (input, options) =>
  buildCanonicalStateSummaryText(
    input?.schemaVersion === 1 ? input : buildCanonicalStateSnapshot(input),
    options,
  );
