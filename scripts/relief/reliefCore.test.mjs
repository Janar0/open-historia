/*! Open Historia — tests for the relief core © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { buildHeightmap, encodeHeight16, landMask, pixelToLngLat, routeRivers } from "./reliefCore.mjs";

// A 40×30 picture: a 2-pixel dark frame, parchment sea, a brown blob of land.
const picture = () => {
  const width = 40;
  const height = 30;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const frame = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const land = (x - 20) ** 2 / 100 + (y - 15) ** 2 / 36 <= 1;
      const [r, g, b] = frame ? [30, 20, 15] : land ? [166, 124, 82] : [232, 217, 176];
      rgba.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { rgba, width, height, frame: { x0: 2, y0: 2, x1: width - 2, y1: height - 2 } };
};

test("the land mask finds the blob and leaves the sea and the frame", () => {
  const { rgba, width, height, frame } = picture();
  const mask = landMask(rgba, width, height, { frame });
  assert.equal(mask[15 * width + 20], 1, "the middle of the blob is land");
  assert.equal(mask[5 * width + 5], 0, "open sea is sea");
  assert.equal(mask[0], 0, "the frame is never land");
  assert.equal(mask[(height - 1) * width + width - 1], 0);
});

test("a sea speck inside the land is land, and a stain on the frame's edge is sea", () => {
  const { rgba, width, height, frame } = picture();
  const paint = (x, y, [r, g, b]) => rgba.set([r, g, b, 255], (y * width + x) * 4);
  // A 4×4 parchment hole in the blob, and a 5×4 brown stain against the frame.
  for (let y = 13; y < 17; y += 1) for (let x = 18; x < 22; x += 1) paint(x, y, [232, 217, 176]);
  for (let y = 2; y < 6; y += 1) for (let x = 30; x < 35; x += 1) paint(x, y, [166, 124, 82]);
  const mask = landMask(rgba, width, height, { frame, cleanRadius: 0 });
  assert.equal(mask[15 * width + 20], 1, "the hole is filled");
  assert.equal(mask[3 * width + 32], 0, "the stain touching the frame goes");
});

test("a peak rises where the sketch puts it, and the sea stays at zero", () => {
  const { rgba, width, height, frame } = picture();
  const mask = landMask(rgba, width, height, { frame });
  const heights = buildHeightmap(mask, width, height, { peaks: [{ x: 20, y: 15, height: 2000, radius: 6 }] }, { seed: 7 });
  assert.ok(heights[15 * width + 20] >= 1800, `the peak is ${heights[15 * width + 20]} m`);
  assert.equal(heights[5 * width + 5], 0);
  for (let i = 0; i < heights.length; i += 1) if (mask[i]) assert.ok(heights[i] > 0, "land is above the sea");
});

test("a basin's edge is a slope, not a step", () => {
  const width = 60;
  const height = 40;
  const mask = new Uint8Array(width * height).fill(1);
  const flat = buildHeightmap(mask, width, height, {}, { seed: 5 });
  const basin = { polygon: [[20, 10], [40, 10], [40, 30], [20, 30]], level: 0 };
  const sunk = buildHeightmap(mask, width, height, { basins: [basin] }, { seed: 5 });
  const drop = (x) => flat[20 * width + x] - sunk[20 * width + x];
  assert.ok(drop(30) > drop(21), "deeper in the middle than at the edge");
  assert.ok(Math.abs(sunk[20 * width + 20] - sunk[20 * width + 19]) < 40, "no cliff where the basin begins");
});

test("a lake lies in the land, never above it", () => {
  const width = 40;
  const height = 30;
  const mask = new Uint8Array(width * height).fill(1);
  const lake = { polygon: [[15, 10], [25, 10], [25, 20], [15, 20]], level: 5000 };
  const heights = buildHeightmap(mask, width, height, { lakes: [lake] }, { seed: 2 });
  assert.ok(heights[15 * width + 20] < 1000, `the lake is at ${heights[15 * width + 20]} m`);
});

test("the same inputs give the same heightmap", () => {
  const { rgba, width, height, frame } = picture();
  const mask = landMask(rgba, width, height, { frame });
  const a = buildHeightmap(mask, width, height, {}, { seed: 3 });
  const b = buildHeightmap(mask, width, height, {}, { seed: 3 });
  assert.deepEqual([...a], [...b]);
});

test("water runs downhill to the sea and gathers as it goes", () => {
  // A 30×20 land tilted down to the left edge, which is sea, with a ridge on the right.
  const width = 30;
  const height = 20;
  const mask = new Uint8Array(width * height);
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      mask[y * width + x] = 1;
      heights[y * width + x] = x * 20 + Math.abs(y - 10) * 15;
    }
  }
  const rivers = routeRivers(heights, mask, width, height, { threshold: 12 });
  assert.ok(rivers.length >= 1, "at least one river");
  const longest = rivers.reduce((best, river) => (river.points.length > best.points.length ? river : best));
  const [lastX] = longest.points.at(-1);
  assert.ok(lastX <= 1, `it ends at the sea, x=${lastX}`);
  assert.ok(longest.flow >= 12);
});

test("a traced river is kept as drawn", () => {
  const width = 10;
  const height = 10;
  const mask = new Uint8Array(width * height).fill(1);
  const heights = new Float32Array(width * height).fill(50);
  const keep = [{ points: [[1, 1], [5, 5], [9, 9]] }];
  const rivers = routeRivers(heights, mask, width, height, { threshold: 1000, keep });
  assert.deepEqual(rivers[0].points, keep[0].points);
});

test("heights pack into sixteen bits and the coordinates follow the map's projection", () => {
  const packed = encodeHeight16(new Float32Array([0, 2500, 5000, 9000]), 5000);
  assert.deepEqual([...packed], [0, 32768, 65535, 65535]);
  const [lng, lat] = pixelToLngLat(50, 50, 100, 100, { west: -180, east: 180, north: 85.0511, south: -85.0511 });
  assert.ok(Math.abs(lng) < 1e-6 && Math.abs(lat) < 1e-6, `${lng}, ${lat}`);
  const [, top] = pixelToLngLat(50, 0, 100, 100, { west: -180, east: 180, north: 60, south: -60 });
  assert.ok(Math.abs(top - 60) < 1e-6);
});
