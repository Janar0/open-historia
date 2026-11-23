/*! Open Historia — tests for a painted map's relief tiles © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { RELIEF_DEM_ENCODING, decodeReliefPixels, encodeReliefDem, reliefTileHeights } from "./reliefDem.js";

const WORLD = { west: -180, east: 180, north: 85.0511, south: -85.0511 };
const grid = (width, height, fill, bounds = WORLD) => ({ width, height, bounds, data: Float32Array.from({ length: width * height }, (_, i) => fill(i % width, Math.floor(i / width))) });
// MapLibre's "custom" DEM encoding, with the factors the source is given.
const decode = (rgba, i) => rgba[i * 4] * RELIEF_DEM_ENCODING.redFactor + rgba[i * 4 + 1] * RELIEF_DEM_ENCODING.greenFactor
  + rgba[i * 4 + 2] * RELIEF_DEM_ENCODING.blueFactor - RELIEF_DEM_ENCODING.baseShift;

test("a level grid gives level tiles, and the encoding round-trips", () => {
  const level = grid(64, 64, () => 1000);
  const heights = reliefTileHeights(level, { z: 2, x: 1, y: 1 }, { size: 32, detail: 0, scale: 1 });
  for (const h of heights) assert.ok(Math.abs(h - 1000) < 1e-3, `${h}`);
  const rgba = encodeReliefDem(heights);
  assert.ok(Math.abs(decode(rgba, 0) - 1000) < 0.1);
  const tall = encodeReliefDem(new Float32Array([250000]));
  assert.ok(Math.abs(decode(tall, 0) - 250000) < 0.1, "far past terrarium's 32 km");
  assert.equal(rgba[3], 255);
});

test("outside the picture the map is at sea level", () => {
  const small = grid(16, 16, () => 1200, { west: 0, east: 10, north: 10, south: 0 });
  const heights = reliefTileHeights(small, { z: 3, x: 0, y: 0 }, { size: 16, detail: 1 });
  for (const h of heights) assert.equal(h, 0);
});

test("neighbouring tiles meet without a step", () => {
  const ramp = grid(128, 128, (x) => x * 10);
  const left = reliefTileHeights(ramp, { z: 3, x: 3, y: 3 }, { size: 64, detail: 1, scale: 1 });
  const right = reliefTileHeights(ramp, { z: 3, x: 4, y: 3 }, { size: 64, detail: 1, scale: 1 });
  for (let row = 0; row < 64; row += 8) {
    const a = left[row * 64 + 63];
    const b = right[row * 64];
    assert.ok(Math.abs(a - b) < 40, `row ${row}: ${a} vs ${b}`);
  }
});

test("detail adds hills on land, never on the sea", () => {
  const coast = grid(64, 64, (x) => (x < 32 ? 0 : 600));
  const flat = reliefTileHeights(coast, { z: 4, x: 7, y: 7 }, { size: 64, detail: 0 });
  const rough = reliefTileHeights(coast, { z: 4, x: 7, y: 7 }, { size: 64, detail: 1 });
  let changed = 0;
  for (let i = 0; i < flat.length; i += 1) {
    if (flat[i] === 0) assert.equal(rough[i], 0, "sea stays at zero");
    if (Math.abs(rough[i] - flat[i]) > 1) changed += 1;
  }
  assert.ok(changed > 0, "the land is rougher");
});

test("zoomed out, the fine detail is left out rather than drawn as grain", () => {
  const land = grid(256, 256, () => 800);
  const far = reliefTileHeights(land, { z: 1, x: 0, y: 0 }, { size: 64, detail: 1, scale: 1 });
  const near = reliefTileHeights(land, { z: 6, x: 32, y: 32 }, { size: 64, detail: 1, scale: 1 });
  const spread = (values) => Math.max(...values) - Math.min(...values);
  // Neighbouring pixels far out differ little; close in, the hills show.
  let jumpFar = 0;
  for (let i = 1; i < 64; i += 1) jumpFar = Math.max(jumpFar, Math.abs(far[32 * 64 + i] - far[32 * 64 + i - 1]));
  assert.ok(jumpFar < 25, `pixel-to-pixel ${jumpFar} m far out`);
  assert.ok(spread(near) > 5, "close in there are hills");
});

test("heights are stretched for the map's scale", () => {
  const tall = grid(16, 16, () => 5000);
  const plain = reliefTileHeights(tall, { z: 1, x: 0, y: 0 }, { size: 8, detail: 0, scale: 1 });
  const stretched = reliefTileHeights(tall, { z: 1, x: 0, y: 0 }, { size: 8, detail: 0, scale: 50 });
  assert.ok(Math.abs(stretched[0] - plain[0] * 50) < 1);
});

test("a packed heightmap reads back in metres", () => {
  // Red high byte, green low byte, of metres / maxMetres * 65535.
  const rgba = new Uint8ClampedArray([128, 0, 0, 255, 255, 255, 0, 255]);
  const metres = decodeReliefPixels(rgba, 6000);
  assert.ok(Math.abs(metres[0] - 6000 * (32768 / 65535)) < 0.01);
  assert.ok(Math.abs(metres[1] - 6000) < 0.01);
});

test("the relief follows whether the scenario's own picture is on screen", async () => {
  const { getPaintingShown, publishPaintingShown, subscribePaintingShown } = await import("./reliefDem.js");
  assert.equal(getPaintingShown(), false, "nothing is drawn over a map nobody said is the picture");
  let heard = 0;
  const stop = subscribePaintingShown(() => { heard += 1; });
  publishPaintingShown(true);
  publishPaintingShown(true);
  assert.equal(getPaintingShown(), true);
  assert.equal(heard, 1, "told once, not on every repeat");
  publishPaintingShown(false);
  stop();
  publishPaintingShown(true);
  assert.equal(heard, 2, "a listener that left hears nothing more");
  publishPaintingShown(false);
});
