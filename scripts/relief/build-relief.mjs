#!/usr/bin/env node
/*! Open Historia — builds a painted scenario map's relief asset (relief.json) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The relief the game draws over a painted map (src/Game/Map/ReliefLayers.jsx):
// a heightmap and the rivers and lakes that follow it, made from the scenario's
// picture and a hand-made sketch of its terrain (scripts/relief/sketches/).
// The design: docs/superpowers/specs/2026-11-23-scenario-relief-design.md.
//
//   node scripts/relief/build-relief.mjs \
//     --scenario <scenario folder, with background.json and world.json> \
//     --sketch scripts/relief/sketches/tensura-octagram.json \
//     [--out <relief.json>, default: the scenario folder's] [--debug <png>] [--seed N]
//
// Copy the result into the scenario's folder on the server; a game on that
// scenario reads it as the scenario's `reliefData` asset.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildHeightmap, encodeHeight16, landMask, pixelToLngLat, routeRivers } from "./reliefCore.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), list[index + 1]?.startsWith("--") ? true : list[index + 1]]);
  return pairs;
}, []));
if (!args.scenario || !args.sketch) {
  console.error("Usage: build-relief.mjs --scenario <folder> --sketch <sketch.json> [--out relief.json] [--debug out.png] [--seed N]");
  process.exit(2);
}

// The heightmap is kept at half the picture's size (the spec's size limit); the
// browser adds the finer detail. The sketch is written in these half-size pixels.
const SCALE = 0.5;
const MAX_METRES = 6000;

const sketch = JSON.parse(fs.readFileSync(args.sketch, "utf8"));
const world = JSON.parse(fs.readFileSync(path.join(args.scenario, "world.json"), "utf8"));
// The picture as painted: background.original.json when a cleaned background
// (--clean-background) has replaced background.json, so a rebuild still reads
// the frame and the ornaments it has to find.
const original = path.join(args.scenario, "background.original.json");
const background = JSON.parse(fs.readFileSync(fs.existsSync(original) ? original : path.join(args.scenario, "background.json"), "utf8"));
const bounds = world.background?.bounds;
if (!background.dataUrl || !bounds) throw new Error("This scenario has no painted (image) background with bounds.");

const picture = Buffer.from(background.dataUrl.split(",")[1], "base64");
const meta = await sharp(picture).metadata();
const width = Math.round(meta.width * SCALE);
const height = Math.round(meta.height * SCALE);
const rgba = new Uint8Array(await sharp(picture).resize(width, height).ensureAlpha().raw().toBuffer());

// Land and sea from the picture, then the sketch's corrections: drawings on the
// sea (a dragon, a compass rose, corner ornaments) made sea, land the colours missed made land.
const mask = landMask(rgba, width, height, { frame: sketch.frame, cleanRadius: sketch.cleanRadius ?? 2, minLand: sketch.minLand ?? 30 });
const inPolygon = (px, py, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const polygonOf = (entry) => (Array.isArray(entry) ? entry : entry.polygon);
for (const [key, value] of [["sea", 0], ["land", 1]]) {
  for (const polygon of (sketch[key] ?? []).map(polygonOf)) {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (inPolygon(x, y, polygon)) mask[y * width + x] = value;
  }
}

const seed = Number(args.seed ?? sketch.seed ?? 1);
const heights = buildHeightmap(mask, width, height, sketch, { seed });
const rivers = routeRivers(heights, mask, width, height, {
  threshold: sketch.riverThreshold ?? 900,
  keep: sketch.rivers ?? [],
  minLength: 10,
});

// Lines in map coordinates: thinned (every other point), then smoothed twice
// (Chaikin) so a river reads as a river, not a staircase of cells.
const chaikin = (points) => {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
  }
  out.push(points.at(-1));
  return out;
};
const thin = (points) => points.filter((_, i) => i === 0 || i === points.length - 1 || i % 2 === 0);
const toMap = ([x, y]) => pixelToLngLat(x + 0.5, y + 0.5, width, height, bounds).map((v) => Number(v.toFixed(4)));
const maxFlow = Math.max(1, ...rivers.filter((r) => Number.isFinite(r.flow) && r.flow < Number.MAX_SAFE_INTEGER).map((r) => r.flow));
const riverFeatures = rivers.map((river) => ({
  type: "Feature",
  properties: { flow: river.flow >= Number.MAX_SAFE_INTEGER ? 1 : Number(Math.min(1, river.flow / maxFlow).toFixed(3)) },
  geometry: { type: "LineString", coordinates: chaikin(chaikin(thin(river.points))).map(toMap) },
}));
const lakeFeatures = (sketch.lakes ?? []).map((lake) => ({
  type: "Feature",
  properties: { name: lake.name ?? "" },
  geometry: { type: "Polygon", coordinates: [[...chaikin(chaikin([...lake.polygon, lake.polygon[0]])), lake.polygon[0]].map(toMap)] },
}));

// Packed into an 8-bit RGB PNG (high byte red, low byte green): a browser reads
// a canvas eight bits a channel, so a 16-bit greyscale PNG would lose its detail.
const packed = encodeHeight16(heights, MAX_METRES);
const rgb = new Uint8Array(width * height * 3);
for (let i = 0; i < packed.length; i += 1) { rgb[i * 3] = packed[i] >> 8; rgb[i * 3 + 1] = packed[i] & 255; }
const png16 = await sharp(Buffer.from(rgb.buffer), { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();

const relief = {
  version: 1,
  kind: "relief",
  bounds,
  width,
  height,
  maxMetres: MAX_METRES,
  // "rg16": metres / maxMetres * 65535 packed as red (high byte) and green (low byte).
  encoding: "rg16",
  heightmap: `data:image/png;base64,${png16.toString("base64")}`,
  rivers: { type: "FeatureCollection", features: riverFeatures },
  lakes: { type: "FeatureCollection", features: lakeFeatures },
};
const out = args.out ?? path.join(args.scenario, "relief.json");
fs.writeFileSync(out, JSON.stringify(relief));
console.log(`relief.json: ${width}×${height}, ${riverFeatures.length} rivers, ${lakeFeatures.length} lakes, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB → ${out}`);

// --clean-background <out.json>: the picture without its decoration, for the
// scenario's background.json. What goes (outside the frame: the torn paper and
// border; and the sketch's `sea` areas marked `erase`: corner ornaments, a
// compass rose) is repainted as sea: the sea's own tone where it is, read from a
// coarse grid of sea-only averages spread outward, with the paper's grain taken
// from a sea pixel nearby. Never from land, so no coast is copied. Blended over
// the edge so nothing shows a seam. Written as JPEG: a painting loses nothing
// visible to it, and it is a fraction of the PNG.
if (args["clean-background"]) {
  const source = new Uint8Array(await sharp(picture).removeAlpha().raw().toBuffer());
  const W = meta.width;
  const H = meta.height;
  const out = new Uint8Array(source);
  const k = W / width;
  const inner = { x0: sketch.frame.x0 * k + 16, y0: sketch.frame.y0 * k + 16, x1: sketch.frame.x1 * k - 16, y1: sketch.frame.y1 * k - 16 };
  const isSea = (x, y) => {
    if (x < inner.x0 || y < inner.y0 || x >= inner.x1 || y >= inner.y1) return false;
    const mx = Math.min(width - 1, Math.floor(x / k));
    const my = Math.min(height - 1, Math.floor(y / k));
    // Away from any land by a few cells, so coasts' dark lines are not sea.
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
      const xx = mx + dx; const yy = my + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height && mask[yy * width + xx]) return false;
    }
    return true;
  };
  const erase = (sketch.sea ?? []).filter((entry) => !Array.isArray(entry) && entry.erase).map((entry) => entry.polygon.map(([x, y]) => [x * k, y * k]));
  const erased = (x, y) => erase.some((polygon) => inPolygon(x, y, polygon));
  // Sea tone on a coarse grid, then spread into the cells that had none.
  const CELL = 48;
  const gw = Math.ceil(W / CELL);
  const gh = Math.ceil(H / CELL);
  const tone = new Float32Array(gw * gh * 3).fill(NaN);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let r = 0; let g = 0; let b = 0; let count = 0;
      for (let y = gy * CELL; y < Math.min(H, (gy + 1) * CELL); y += 3) {
        for (let x = gx * CELL; x < Math.min(W, (gx + 1) * CELL); x += 3) {
          if (!isSea(x, y) || erased(x, y)) continue;
          const i = (y * W + x) * 3;
          r += source[i]; g += source[i + 1]; b += source[i + 2]; count += 1;
        }
      }
      if (count > 20) tone.set([r / count, g / count, b / count], (gy * gw + gx) * 3);
    }
  }
  for (let round = 0; round < 80; round += 1) {
    let missing = 0;
    const next = new Float32Array(tone);
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        const at = (gy * gw + gx) * 3;
        if (!Number.isNaN(tone[at])) continue;
        let r = 0; let g = 0; let b = 0; let count = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = gx + dx; const yy = gy + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const j = (yy * gw + xx) * 3;
          if (Number.isNaN(tone[j])) continue;
          r += tone[j]; g += tone[j + 1]; b += tone[j + 2]; count += 1;
        }
        if (count) next.set([r / count, g / count, b / count], at); else missing += 1;
      }
    }
    tone.set(next);
    if (!missing) break;
  }
  const toneAt = (x, y, c) => {
    const fx = Math.max(0, Math.min(gw - 1.001, x / CELL - 0.5));
    const fy = Math.max(0, Math.min(gh - 1.001, y / CELL - 0.5));
    const x0 = Math.floor(fx); const y0 = Math.floor(fy);
    const tx = fx - x0; const ty = fy - y0;
    const v = (xx, yy) => tone[(yy * gw + xx) * 3 + c];
    return (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty;
  };
  // Grain: the paper's own texture, from a sea pixel a fixed way off (tiled, mirrored
  // into the frame), as its difference from the tone there.
  const grainAt = (x, y) => {
    for (const [ox, oy] of [[0, 0], [211, 0], [0, 173], [-197, 0], [0, -181], [263, 241], [-320, 0], [0, -320], [-320, -320], [-480, -160], [-160, -480]]) {
      let sx = x + ox; let sy = y + oy;
      sx = sx < inner.x0 ? 2 * inner.x0 - sx : sx >= inner.x1 ? 2 * inner.x1 - sx - 2 : sx;
      sy = sy < inner.y0 ? 2 * inner.y0 - sy : sy >= inner.y1 ? 2 * inner.y1 - sy - 2 : sy;
      sx = Math.round(sx); sy = Math.round(sy);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H || !isSea(sx, sy) || erased(sx, sy)) continue;
      const i = (sy * W + sx) * 3;
      return [0, 1, 2].map((c) => Math.max(-24, Math.min(24, source[i + c] - toneAt(sx, sy, c))));
    }
    return [0, 0, 0];
  };
  const feather = 14;
  const paint = (x, y, weight) => {
    const i = (y * W + x) * 3;
    const grain = grainAt(x, y);
    for (let c = 0; c < 3; c += 1) {
      const sea = toneAt(x, y, c) + grain[c] * 0.8;
      out[i + c] = Math.max(0, Math.min(255, Math.round(source[i + c] * (1 - weight) + sea * weight)));
    }
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const edge = Math.min(x - inner.x0, y - inner.y0, inner.x1 - x, inner.y1 - y);
      if (edge < feather) paint(x, y, edge <= 0 ? 1 : 1 - edge / feather);
    }
  }
  for (const polygon of erase) {
    const xs = polygon.map((p) => p[0]);
    const ys = polygon.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(H, Math.ceil(Math.max(...ys))); y += 1) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(W, Math.ceil(Math.max(...xs))); x += 1) {
        if (inPolygon(x, y, polygon)) paint(x, y, 1);
      }
    }
  }
  const cleaned = await sharp(Buffer.from(out.buffer), { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  fs.writeFileSync(args["clean-background"], JSON.stringify({ dataUrl: `data:image/jpeg;base64,${cleaned.toString("base64")}` }));
  console.log(`clean background: ${args["clean-background"]} (${(cleaned.length / 1e6).toFixed(2)} MB)`);
}

// A look at it: hillshade multiplied over the picture, rivers and the coast on top.
if (args.debug) {
  const shaded = new Uint8Array(width * height * 3);
  const at = (x, y) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * 4000);
      const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * 4000);
      const light = Math.max(0, Math.min(1, 0.55 + (-dx + -dy) * 9));
      const shade = mask[i] ? 0.45 + light * 0.75 : 1;
      // --shade: the relief alone, in grey, to judge its shapes.
      for (let c = 0; c < 3; c += 1) shaded[i * 3 + c] = Math.max(0, Math.min(255, (args.shade ? (mask[i] ? 200 : 235) : rgba[i * 4 + c]) * shade));
      if (args.mask && !mask[i]) { shaded[i * 3] = 40; shaded[i * 3 + 1] = 70; shaded[i * 3 + 2] = 120; }
    }
  }
  for (const river of rivers) {
    for (const [x, y] of river.points) {
      const i = (Math.round(y) * width + Math.round(x)) * 3;
      shaded[i] = 40; shaded[i + 1] = 90; shaded[i + 2] = 200;
    }
  }
  await sharp(Buffer.from(shaded.buffer), { raw: { width, height, channels: 3 } }).png().toFile(args.debug);
  console.log(`debug: ${args.debug}`);
}
