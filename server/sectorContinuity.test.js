import assert from "node:assert/strict";
import test from "node:test";
import polygonClipping from "polygon-clipping";
import {
  boundTacticalSectorEvolution,
  deriveTacticalBorderSector,
  groundSpawnIsFriendly,
  hasTacticalAnchor,
  hostileGroundMoveIsContinuous,
  tacticalCellsAreConnected,
  tacticalConnectedComponents,
  tacticalConnectionLimitKm,
  tacticalDistanceKm,
  tacticalEntryPoint,
  tacticalGeometryContainsPoint,
  tacticalNearestBoundaryPoint,
  tacticalRegionCoverageGate,
} from "../src/Game/AI/sectorContinuity.js";
import {
  controlSliceMultiPolygon,
  smoothClosedRing,
  tacticalAreaPolygon,
} from "../src/Game/Map/controlGeometry.js";
import { applySectorOps, normalizeSectorOp } from "../src/runtime/gameState.js";

const cell = (lng, lat, radiusKm = 8) => ({ center: { lng, lat }, radiusKm });

test("tactical distance uses real kilometre scale", () => {
  const distance = tacticalDistanceKm(cell(39.70, 47.23), cell(39.42, 47.14));
  assert.ok(distance > 20 && distance < 30);
});

test("a local front chain is connected while a leap to the regional center is not", () => {
  const border = cell(39.20, 47.05, 10);
  const approach = cell(39.45, 47.14, 10);
  const rostovCenter = cell(39.72, 47.23, 10);
  assert.equal(tacticalCellsAreConnected([border, approach, rostovCenter]), true);
  assert.equal(tacticalCellsAreConnected([border, rostovCenter]), false);
});

test("a hostile pocket needs a nearby operational anchor", () => {
  const target = [cell(39.72, 47.23, 8)];
  assert.equal(hasTacticalAnchor(target, [cell(39.68, 47.21, 2)]), true);
  assert.equal(hasTacticalAnchor(target, [cell(37.80, 48.00, 2)]), false);
});

test("visual gaps are not accepted as a continuous front", () => {
  const first = cell(39.20, 47.05, 6);
  const touching = cell(39.36, 47.05, 6);
  const detached = cell(39.70, 47.05, 6);
  assert.ok(tacticalDistanceKm(first, touching) < tacticalConnectionLimitKm(first, touching));
  assert.equal(tacticalCellsAreConnected([first, touching, detached]), false);
  assert.deepEqual(tacticalConnectedComponents([first, touching, detached]).map((group) => group.length), [2, 1]);
});

test("partial control is cut from the merged footprint without reopening the cell grid", () => {
  const cells = [cell(39.20, 47.05, 6.84), cell(39.34, 47.05, 6.84)];
  const footprint = polygonClipping.union(...cells.map((entry, index) => [[
    smoothClosedRing(tacticalAreaPolygon({ ...entry.center, radiusKm: entry.radiusKm }, `cell-${index}`), 0.1),
  ]]));
  const controlled = controlSliceMultiPolygon(footprint, 60, 90, 47.05);
  assert.equal(footprint.length, 1);
  assert.equal(controlled.length, 1);
  assert.ok(controlled[0][0].length > 8);
});

test("ground formations cannot spawn at a hostile objective", () => {
  assert.equal(groundSpawnIsFriendly({ ownerCode: "Ukraine", locationOwnerCode: "Russia" }), false);
  assert.equal(groundSpawnIsFriendly({ ownerCode: "Ukraine", locationOwnerCode: "Ukraine" }), true);
  assert.equal(groundSpawnIsFriendly({ ownerCode: "Rebels", locationOwnerCode: "Russia", isNewPolity: true }), true);
});

test("hostile ground movement must remain beside the connected front", () => {
  const unit = cell(39.20, 47.05, 2);
  const borderFront = [cell(39.35, 47.08, 7)];
  assert.equal(hostileGroundMoveIsContinuous(unit, cell(39.36, 47.08, 2), borderFront), true);
  assert.equal(hostileGroundMoveIsContinuous(unit, cell(39.72, 47.23, 2), borderFront), false);
});

test("the engine derives first contact just across the real target boundary", () => {
  const target = {
    type: "Polygon",
    coordinates: [[[1, -1], [3, -1], [3, 1], [1, 1], [1, -1]]],
  };
  const anchor = cell(0.9, 0, 2);
  const boundary = tacticalNearestBoundaryPoint(anchor, target);
  const entry = tacticalEntryPoint(anchor, target, 2);
  assert.ok(boundary.distanceKm > 10 && boundary.distanceKm < 12);
  assert.ok(boundary.bearingDeg > 89 && boundary.bearingDeg < 91);
  assert.ok(entry.lng > 1);
  assert.ok(Math.abs(entry.lat) < 0.001);
});

test("first contact ignores guessed geometry and becomes a shallow connected border strip", () => {
  const targetRegion = {
    id: "target-region",
    geometry: {
      type: "Polygon",
      coordinates: [[[1, -1], [3, -1], [3, 1], [1, 1], [1, -1]]],
    },
  };
  const sector = deriveTacticalBorderSector({
    anchor: cell(0.82, 0, 2),
    targetRegion,
    sector: {
      id: "front-1",
      regionId: "wrong-friendly-region",
      name: "Coastal advance",
      ownerCode: "Attacker",
      contestedBy: "Defender",
      control: 91,
      center: { lng: 0.4, lat: 0.6 },
      radiusKm: 80,
    },
  });
  assert.equal(sector.regionId, targetRegion.id);
  assert.ok(sector.control >= 12 && sector.control <= 35);
  assert.ok(sector.radiusKm <= 10);
  assert.ok(sector.cells.length >= 1 && sector.cells.length <= 3);
  assert.equal(tacticalCellsAreConnected(sector.cells), true);
  assert.equal(sector.cells.every((entry) => tacticalGeometryContainsPoint(targetRegion.geometry, entry)), true);
  assert.equal(sector.cells.every((entry) => entry.center.lng > 1), true);
});

test("first contact clears overlapping simplified source and target polygons", () => {
  const targetRegion = {
    id: "target-region",
    geometry: {
      type: "Polygon",
      coordinates: [[[1, -1], [3, -1], [3, 1], [1, 1], [1, -1]]],
    },
  };
  const overlappingSource = {
    type: "Polygon",
    coordinates: [[[-1, -1], [1.15, -1], [1.15, 1], [-1, 1], [-1, -1]]],
  };
  const sector = deriveTacticalBorderSector({
    anchor: cell(0.9, 0, 2),
    targetRegion,
    excludedGeometries: [overlappingSource],
    sector: {
      id: "front-overlap",
      regionId: "source-region",
      name: "Border advance",
      ownerCode: "Attacker",
      contestedBy: "Defender",
      control: 25,
      center: { lng: 0.9, lat: 0 },
      radiusKm: 10,
    },
  });
  assert.ok(sector);
  assert.equal(sector.cells.every((entry) => tacticalGeometryContainsPoint(targetRegion.geometry, entry)), true);
  assert.equal(sector.cells.some((entry) => tacticalGeometryContainsPoint(overlappingSource, entry)), false);
});

test("an established front grows by bounded pieces and its old cells cannot teleport", () => {
  const previous = {
    id: "front-1",
    name: "Border front",
    ownerCode: "Attacker",
    battleId: "battle-1",
    frontBearing: 90,
    cells: [
      { ...cell(1.04, 0, 4), id: "old-1", control: 20 },
      { ...cell(1.12, 0, 4), id: "old-2", control: 24 },
    ],
  };
  const candidate = {
    ...previous,
    name: "Renamed duplicate front",
    frontBearing: 270,
    cells: [
      { ...cell(2.5, 0.5, 20), id: "old-1", control: 100 },
      { ...cell(1.22, 0, 20), id: "new-1", control: 90 },
      { ...cell(1.24, 0.04, 20), id: "new-2", control: 90 },
      { ...cell(1.26, -0.04, 20), id: "new-3", control: 90 },
      { ...cell(1.28, 0, 20), id: "new-4", control: 90 },
      { ...cell(2.8, 0, 20), id: "far-jump", control: 90 },
    ],
  };
  const bounded = boundTacticalSectorEvolution(previous, candidate);
  const byId = new Map(bounded.cells.map((entry) => [entry.id, entry]));
  assert.equal(bounded.name, previous.name);
  assert.equal(bounded.frontBearing, previous.frontBearing);
  assert.deepEqual(byId.get("old-1").center, previous.cells[0].center);
  assert.equal(byId.get("old-1").control, 38);
  assert.equal(byId.has("old-2"), true);
  assert.equal(["new-1", "new-2", "new-3", "new-4"].filter((id) => byId.has(id)).length, 3);
  assert.equal(byId.has("far-jump"), false);
  assert.equal([...byId.values()].filter((entry) => entry.id.startsWith("new-")).every((entry) => (
    entry.control <= 35 && entry.radiusKm <= 4.8 && entry.status === "assault"
  )), true);
});

test("old tactical cells disappear only through an explicit remove", () => {
  const previous = {
    id: "front-1",
    name: "Border front",
    ownerCode: "Attacker",
    cells: [
      { ...cell(1.04, 0, 4), id: "keep", control: 40 },
      { ...cell(1.12, 0, 4), id: "remove", control: 40 },
    ],
  };
  const candidate = { ...previous, cells: [{ ...previous.cells[0], control: 50 }] };
  const implicit = boundTacticalSectorEvolution(previous, candidate);
  const explicit = boundTacticalSectorEvolution(previous, candidate, { removedCellIds: ["remove"] });
  assert.equal(implicit.cells.some((entry) => entry.id === "remove"), true);
  assert.equal(explicit.cells.some((entry) => entry.id === "remove"), false);
});

test("an engine-derived border strip survives operation normalization and persistence", () => {
  const targetRegion = {
    id: "target-region",
    geometry: {
      type: "Polygon",
      coordinates: [[[1, -1], [3, -1], [3, 1], [1, 1], [1, -1]]],
    },
  };
  const sector = deriveTacticalBorderSector({
    anchor: cell(0.85, 0, 2),
    targetRegion,
    sector: {
      id: "persisted-front",
      regionId: "guessed-region",
      name: "Border battle",
      ownerCode: "Attacker",
      contestedBy: "Defender",
      control: 80,
      center: { lng: 9, lat: 9 },
      radiusKm: 60,
    },
  });
  const operation = normalizeSectorOp({ op: "upsert", sector });
  const persisted = applySectorOps([], [operation])[0];
  assert.equal(persisted.id, "persisted-front");
  assert.equal(persisted.regionId, targetRegion.id);
  assert.equal(persisted.frontBearing, 90);
  assert.ok(persisted.cells.length >= 1 && persisted.cells.length <= 3);
  assert.equal(persisted.cells.every((entry) => tacticalGeometryContainsPoint(targetRegion.geometry, entry)), true);
  assert.equal(persisted.control <= 35, true);
});

test("a tiny secured bridgehead cannot flip a large administrative region", () => {
  const largeRegion = {
    type: "Polygon",
    coordinates: [[[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]]],
  };
  const bridgehead = {
    id: "front-1",
    name: "Bridgehead",
    ownerCode: "Attacker",
    control: 100,
    status: "held",
    cells: [
      { ...cell(0.05, 0.8, 5), id: "a", control: 100, status: "held" },
      { ...cell(0.12, 0.8, 5), id: "b", control: 100, status: "held" },
      { ...cell(0.19, 0.8, 5), id: "c", control: 100, status: "held" },
    ],
  };
  const coverage = tacticalRegionCoverageGate(bridgehead, largeRegion);
  assert.equal(coverage.secured, false);
  assert.ok(coverage.frontSpanKm < coverage.requiredSpanKm);
});

test("a broad mature front can complete administrative control", () => {
  const region = {
    type: "Polygon",
    coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]],
  };
  const cells = Array.from({ length: 9 }, (_, index) => ({
    ...cell(0.15 + index * 0.2, 0.5, 8),
    id: `held-${index + 1}`,
    control: 92,
    status: "held",
  }));
  const coverage = tacticalRegionCoverageGate({
    id: "front-1",
    name: "Mature front",
    ownerCode: "Attacker",
    control: 92,
    status: "held",
    cells,
  }, region);
  assert.equal(coverage.cellCount >= coverage.requiredCells, true);
  assert.equal(coverage.frontSpanKm >= coverage.requiredSpanKm, true);
  assert.equal(coverage.secured, true);
});
