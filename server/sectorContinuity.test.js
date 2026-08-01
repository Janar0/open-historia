import assert from "node:assert/strict";
import test from "node:test";
import {
  hasTacticalAnchor,
  tacticalCellsAreConnected,
  tacticalDistanceKm,
} from "../src/Game/AI/sectorContinuity.js";

const cell = (lng, lat, radiusKm = 8) => ({ center: { lng, lat }, radiusKm });

test("tactical distance uses real kilometre scale", () => {
  const distance = tacticalDistanceKm(cell(39.70, 47.23), cell(39.42, 47.14));
  assert.ok(distance > 20 && distance < 30);
});

test("a local front chain is connected while a leap to the regional center is not", () => {
  const border = cell(39.20, 47.05, 10);
  const approach = cell(39.42, 47.14, 10);
  const rostovCenter = cell(39.72, 47.23, 10);
  assert.equal(tacticalCellsAreConnected([border, approach, rostovCenter]), true);
  assert.equal(tacticalCellsAreConnected([border, rostovCenter]), false);
});

test("a hostile pocket needs a nearby operational anchor", () => {
  const target = [cell(39.72, 47.23, 8)];
  assert.equal(hasTacticalAnchor(target, [cell(39.68, 47.21, 2)]), true);
  assert.equal(hasTacticalAnchor(target, [cell(37.80, 48.00, 2)]), false);
});
