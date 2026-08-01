import assert from "node:assert/strict";
import test from "node:test";
import polygonClipping from "polygon-clipping";
import {
  groundSpawnIsFriendly,
  hasTacticalAnchor,
  hostileGroundMoveIsContinuous,
  tacticalCellsAreConnected,
  tacticalConnectedComponents,
  tacticalConnectionLimitKm,
  tacticalDistanceKm,
  tacticalEntryPoint,
  tacticalNearestBoundaryPoint,
} from "../src/Game/AI/sectorContinuity.js";
import {
  controlSliceMultiPolygon,
  smoothClosedRing,
  tacticalAreaPolygon,
} from "../src/Game/Map/controlGeometry.js";

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
