import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEventImpactsToWorld,
  applyForceOps,
  applyResourceOps,
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
