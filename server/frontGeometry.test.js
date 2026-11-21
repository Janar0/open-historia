import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCombatBand,
  buildEngagementRail,
  buildEngagementRailTeeth,
  buildOperationalEnvelope,
  buildOperationalRoute,
  buildParallelFrontLine,
  projectFrontPoint,
} from "../src/Game/Map/frontGeometry.js";

test("operational envelope is a tapered connected bridgehead with a contact edge", () => {
  const sector = {
    frontOrigin: { lng: 37.45, lat: 50.43 },
    frontWidthKm: 12,
  };
  const cells = [
    { id: "rear", center: { lng: 37.59, lat: 50.28 }, radiusKm: 3.4 },
    { id: "lead", center: { lng: 37.65, lat: 50.15 }, radiusKm: 3.4 },
  ];
  const envelope = buildOperationalEnvelope(cells, sector, 140.7);
  assert.ok(envelope);
  assert.equal(envelope.ring.length, 8);
  assert.equal(envelope.contactLine.length, 3);
  assert.equal(envelope.leftFlank.length, 3);
  assert.ok(envelope.lead.cell.id === "lead");
  assert.ok(envelope.rear.cell.id === "rear");
});

test("front projection preserves forward and lateral axes", () => {
  const projection = projectFrontPoint(
    { lng: 37.65, lat: 50.15 },
    { lng: 37.45, lat: 50.43 },
    140.7,
  );
  assert.ok(projection);
  assert.ok(projection.forward > 0);
  assert.ok(Number.isFinite(projection.lateral));
});

test("operational routes remain anchored to real formations", () => {
  const route = buildOperationalRoute(
    { lng: 37.66, lat: 50.21 },
    { lng: 37.65, lat: 50.15 },
    140.7,
    1.4,
  );
  assert.equal(route.length, 3);
  assert.deepEqual(route[0], [37.66, 50.21]);
  assert.deepEqual(route.at(-1), [37.65, 50.15]);
});

test("engagement rail follows the connected contested cells", () => {
  const rail = buildEngagementRail(
    [
      { center: { lng: 37.59, lat: 50.28 } },
      { center: { lng: 37.65, lat: 50.15 } },
      { center: { lng: 37.74, lat: 50.09 } },
    ],
    { lng: 37.45, lat: 50.43 },
    140.7,
  );
  assert.equal(rail.length, 3);
  assert.ok(rail.every((coordinate) => coordinate.length === 2));
  assert.notDeepEqual(rail[0], [37.59, 50.28]);
  assert.ok(buildEngagementRailTeeth(rail, 140.7).length > 0);
});

test("combat bands and echelon lines stay parallel to the contact", () => {
  const contact = [[37.65, 50.15], [37.72, 50.18], [37.78, 50.21]];
  const rear = buildParallelFrontLine(contact, -2.6, 140.7);
  const enemy = buildParallelFrontLine(contact, 1.6, 140.7);
  const band = buildCombatBand(contact, 140.7, 2.6, 1.6);
  assert.equal(rear.length, contact.length);
  assert.equal(enemy.length, contact.length);
  assert.equal(band.length, contact.length * 2 + 1);
  assert.ok(rear[0][1] !== contact[0][1]);
  assert.ok(enemy[0][0] !== contact[0][0]);
});
