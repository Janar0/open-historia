import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEventImpactsToWorld,
  applyForceOps,
  applyResourceOps,
  applyUnitOps,
} from "../src/runtime/gameState.js";
import { buildCanonicalStateForPrompt } from "../src/runtime/operationalState.js";

const unit = (id, regionId, ownerCode = "Germany") => ({
  id,
  name: id,
  type: "infantry",
  ownerCode,
  strength: 100,
  lng: 37,
  lat: 48,
  regionId,
});

const reserves = {
  Germany: {
    manpower: 500,
    manpowerCommitted: 100,
    equipment: { tank: 30 },
    munitions: { "F-1": 5 },
    fuel: 10,
    supplies: 20,
    maintenance: 3,
  },
};

test("forceOps expands a regional withdrawal to every matching formation", () => {
  const next = applyForceOps(
    [unit("one", "front-a"), unit("two", "front-a"), unit("three", "front-b"), unit("enemy", "front-a", "Soviet Union")],
    [{ op: "withdraw", ownerCode: "Germany", regionIds: ["front-a"], note: "fallback line" }],
  );

  assert.deepEqual(next.map((entry) => [entry.id, entry.status]), [
    ["one", "moving"],
    ["two", "moving"],
    ["three", "idle"],
    ["enemy", "idle"],
  ]);
  assert.equal(next[0].note, "fallback line");
});

test("a tactical move can keep a defending formation engaged at the contact", () => {
  const next = applyUnitOps(
    [unit("defender", "front-a", "Ukraine")],
    [{
      op: "move",
      unitId: "defender",
      toLng: 37.12,
      toLat: 48.04,
      regionId: "front-a",
      sectorId: "kharkiv-front",
      status: "engaged",
    }],
  );

  assert.equal(next[0].status, "engaged");
  assert.equal(next[0].sectorId, "kharkiv-front");
  assert.equal(next[0].lng, 37.12);
});

test("resourceOps applies exact production and expenditure and rejects shortages", () => {
  const result = applyResourceOps(reserves, [
    { op: "consume", ownerCode: "Germany", resource: "munitions", item: "F-1", amount: 5 },
    { op: "consume", ownerCode: "Germany", resource: "manpower", amount: 500 },
    { op: "produce", ownerCode: "Germany", resource: "equipment", item: "tank", amount: 12 },
  ]);

  assert.equal(result.rejected.length, 0);
  assert.equal(result.reserves.Germany.munitions["F-1"], 0);
  assert.equal(result.reserves.Germany.manpower, 0);
  assert.equal(result.reserves.Germany.equipment.tank, 42);

  const shortage = applyResourceOps(reserves, [
    { op: "consume", ownerCode: "Germany", resource: "fuel", amount: 11 },
  ]);
  assert.equal(shortage.rejected.length, 1);
  assert.equal(shortage.reserves.Germany.fuel, 10);

  const unknown = applyResourceOps({ Germany: { manpower: 500 } }, [
    { op: "consume", ownerCode: "Germany", resource: "fuel", amount: 1 },
  ]);
  assert.equal(unknown.rejected[0].reason, "the starting balance is unknown");
});

test("event folding applies force/resource operations and records the transaction", () => {
  const { world } = applyEventImpactsToWorld({
    colors: {},
    world: { units: [unit("one", "front-a"), unit("two", "front-a"), unit("three", "front-b")], militaryReserves: reserves },
    events: [{
      date: "1942-01-02",
      title: "Fallback line ordered",
      description: "The army withdraws from the front and spends five grenades.",
      impacts: {
        forceOps: [{ op: "withdraw", ownerCode: "Germany", regionIds: ["front-a"], note: "fallback line" }],
        resourceOps: [{ op: "consume", ownerCode: "Germany", resource: "munitions", item: "F-1", amount: 5, note: "five grenades" }],
      },
    }],
  });

  assert.equal(world.units.filter((entry) => entry.status === "moving").length, 2);
  assert.equal(world.militaryReserves.Germany.munitions["F-1"], 0);
  assert.equal(world.resourceLedger.length, 1);
  assert.equal(world.resourceLedger[0].signedAmount, -5);
});

test("sectorOps fold a connected contested footprint without flipping the administrative region", () => {
  const initialSector = {
    id: "kharkiv-front",
    regionId: "UKR.8_1",
    name: "Kharkiv border sector",
    ownerCode: "Russia",
    contestedBy: "Ukraine",
    control: 42,
    center: { lng: 37.62, lat: 50.24 },
    frontOrigin: { lng: 37.45, lat: 50.43 },
    frontBearing: 140,
    frontWidthKm: 8,
    advanceDepthKm: 18,
    radiusKm: 4,
    status: "contested",
    cells: [{
      id: "kharkiv-entry",
      ownerCode: "Russia",
      contestedBy: "Ukraine",
      control: 42,
      status: "contested",
      center: { lng: 37.59, lat: 50.28 },
      radiusKm: 4,
    }],
  };
  const { world } = applyEventImpactsToWorld({
    world: {
      controlSectors: [initialSector],
      regionOwnershipOverrides: { "UKR.8_1": "Ukraine" },
    },
    events: [{
      title: "Bridgehead widens",
      impacts: {
        sectorOps: [{
          op: "upsert",
          sector: {
            ...initialSector,
            cells: [
              { ...initialSector.cells[0], control: 72 },
              {
                id: "kharkiv-flank",
                ownerCode: "Russia",
                contestedBy: "Ukraine",
                control: 28,
                status: "assault",
                center: { lng: 37.64, lat: 50.20 },
                radiusKm: 4,
              },
            ],
          },
        }],
      },
    }],
  });

  const sector = world.controlSectors.find((entry) => entry.id === "kharkiv-front");
  assert.equal(sector.cells.map((entry) => entry.id).sort().join(","), "kharkiv-entry,kharkiv-flank");
  assert.equal(sector.status, "contested");
  assert.ok(sector.control > 35 && sector.control < 60);
  assert.equal(world.regionOwnershipOverrides["UKR.8_1"], "Ukraine");
});

test("sequential tactical turns extend one front and preserve attrition", () => {
  const initialSector = {
    id: "kharkiv-front",
    regionId: "UKR.8_1",
    name: "Kharkiv border sector",
    ownerCode: "Russia",
    contestedBy: "Ukraine",
    control: 24,
    center: { lng: 37.59, lat: 50.28 },
    frontOrigin: { lng: 37.45, lat: 50.43 },
    frontBearing: 140,
    frontWidthKm: 8,
    advanceDepthKm: 12,
    radiusKm: 4,
    status: "assault",
    cells: [{
      id: "kharkiv-entry",
      ownerCode: "Russia",
      contestedBy: "Ukraine",
      control: 24,
      status: "assault",
      center: { lng: 37.59, lat: 50.28 },
      radiusKm: 4,
    }],
  };
  const attacker = unit("r-1", "UKR.8_1", "Russia");
  const { world } = applyEventImpactsToWorld({
    world: {
      controlSectors: [initialSector],
      units: [attacker],
      regionOwnershipOverrides: { "UKR.8_1": "Ukraine" },
    },
    events: [
      {
        title: "First assault",
        impacts: {
          sectorOps: [{
            op: "upsert",
            sector: {
              ...initialSector,
              control: 34,
              cells: [
                ...initialSector.cells,
                {
                  id: "kharkiv-flank",
                  ownerCode: "Russia",
                  contestedBy: "Ukraine",
                  control: 18,
                  status: "assault",
                  center: { lng: 37.63, lat: 50.24 },
                  radiusKm: 4,
                },
              ],
            },
          }],
          unitOps: [{ op: "strength", unitId: "r-1", strength: 93 }],
        },
      },
      {
        title: "Second assault",
        impacts: {
          sectorOps: [{
            op: "upsert",
            sector: {
              ...initialSector,
              control: 46,
              status: "contested",
              cells: [
                { ...initialSector.cells[0], control: 46, status: "contested" },
                {
                  id: "kharkiv-flank",
                  ownerCode: "Russia",
                  contestedBy: "Ukraine",
                  control: 31,
                  status: "contested",
                  center: { lng: 37.63, lat: 50.24 },
                  radiusKm: 4,
                },
                {
                  id: "kharkiv-approach",
                  ownerCode: "Russia",
                  contestedBy: "Ukraine",
                  control: 16,
                  status: "assault",
                  center: { lng: 37.66, lat: 50.20 },
                  radiusKm: 4,
                },
              ],
            },
          }],
          unitOps: [{ op: "strength", unitId: "r-1", strength: 86 }],
        },
      },
    ],
  });

  const sector = world.controlSectors.find((entry) => entry.id === "kharkiv-front");
  assert.deepEqual(sector.cells.map((entry) => entry.id), ["kharkiv-entry", "kharkiv-flank", "kharkiv-approach"]);
  assert.equal(sector.status, "contested");
  assert.ok(sector.control > 25 && sector.control < 50);
  assert.equal(world.units.find((entry) => entry.id === "r-1").strength, 86);
  assert.equal(world.regionOwnershipOverrides["UKR.8_1"], "Ukraine");
});

test("region transfer folding follows the current owner and rejects stale replay", () => {
  const { world } = applyEventImpactsToWorld({
    world: { regionOwnershipOverrides: { "front-1": "Russia" } },
    events: [
      {
        title: "Bridgehead secured",
        impacts: {
          regionTransfers: [{ regionId: "front-1", fromCode: "Russia", toCode: "Ukraine" }],
        },
      },
      {
        title: "Stale claim rejected",
        impacts: {
          regionTransfers: [{ regionId: "front-1", fromCode: "Russia", toCode: "Poland" }],
        },
      },
    ],
  });

  assert.equal(world.regionOwnershipOverrides["front-1"], "Ukraine");
});

test("region transfer folding rejects a missing source owner after a prior transfer", () => {
  const { world } = applyEventImpactsToWorld({
    world: { regionOwnershipOverrides: { "front-1": "Russia" } },
    events: [{
      title: "Unattributed border flip",
      impacts: {
        regionTransfers: [{ regionId: "front-1", toCode: "Ukraine" }],
      },
    }],
  });

  assert.equal(world.regionOwnershipOverrides["front-1"], "Russia");
});

test("canonical prompt state labels omitted reserve fields as unknown", () => {
  const summary = buildCanonicalStateForPrompt({
    game: { country: "Germany", gameDate: "1942-01-02", round: 3 },
    world: { units: [unit("one", "front-a")], militaryReserves: { Germany: { manpower: 500 } } },
    actions: [{ id: "withdraw-1", title: "Withdraw", text: "Withdraw the front", status: "planned" }],
  });

  assert.match(summary, /CANONICAL WORLD STATE v1/);
  assert.match(summary, /fuel UNKNOWN/);
  assert.match(summary, /withdraw-1/);
  assert.match(summary, /totals include every stored unit/gi);
});
