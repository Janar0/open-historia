/*! Open Historia — relief for a painted map: land mask, heightmap and rivers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test scripts/relief/reliefCore.test.mjs
//
// A painted scenario map is one picture: zoomed in on a small country it has
// nothing left to show. This turns the picture and a hand-made sketch of its
// mountains, basins, lakes and rivers into a heightmap and river lines the game
// draws as lit relief over the painting (src/Game/Map/ReliefLayers.jsx). The
// design: docs/superpowers/specs/2026-11-23-scenario-relief-design.md.
//
// Everything here is plain arithmetic on typed arrays, deterministic for a seed,
// and import-free, so it runs under bare node and its tests need no build.

// ---- Seeded noise ---------------------------------------------------------------

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Value noise on a lattice, smoothly interpolated: -1..1.
const makeValueNoise = (seed) => {
  const random = mulberry32(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i += 1) table[i] = random() * 2 - 1;
  const at = (x, y) => table[((y & (size - 1)) * size) + (x & (size - 1))];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
};

// Fractal sums of it: soft hills (fbm) and sharp crests (ridged), about -1..1 and 0..1.
const fbm = (noise, x, y, octaves = 5) => {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum;
};
const ridged = (noise, x, y, octaves = 5) => {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i += 1) {
    const r = 1 - Math.abs(noise(x * frequency, y * frequency));
    sum += r * r * amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum;
};

// ---- Land and sea ----------------------------------------------------------------

// Sea is the colour that fills the picture's margin inside its frame (parchment,
// water); land is the other of two colour clusters. Thin dark marks drawn on the
// sea (a grid, waves, lettering) are opened away; small specks of either are
// closed. Nothing outside the frame is land.
export const landMask = (rgba, width, height, { frame = { x0: 0, y0: 0, x1: width, y1: height }, cleanRadius = 2 } = {}) => {
  const n = width * height;
  const inside = (x, y) => x >= frame.x0 && x < frame.x1 && y >= frame.y0 && y < frame.y1;
  const colour = (i) => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
  // Seed the sea from the frame's inner margin, the land from the picture's darker half.
  const margin = Math.max(1, Math.round(Math.min(frame.x1 - frame.x0, frame.y1 - frame.y0) * 0.04));
  let sea = [0, 0, 0];
  let seaCount = 0;
  const lum = [];
  for (let y = frame.y0; y < frame.y1; y += 1) {
    for (let x = frame.x0; x < frame.x1; x += 1) {
      const i = y * width + x;
      const [r, g, b] = colour(i);
      lum.push(r * 0.299 + g * 0.587 + b * 0.114);
      const edge = x - frame.x0 < margin || frame.x1 - 1 - x < margin || y - frame.y0 < margin || frame.y1 - 1 - y < margin;
      if (edge) { sea = [sea[0] + r, sea[1] + g, sea[2] + b]; seaCount += 1; }
    }
  }
  sea = sea.map((v) => v / Math.max(1, seaCount));
  const sorted = [...lum].sort((a, b) => a - b);
  const cut = sorted[Math.floor(sorted.length * 0.3)];
  let land = [0, 0, 0];
  let landCount = 0;
  for (let y = frame.y0; y < frame.y1; y += 1) {
    for (let x = frame.x0; x < frame.x1; x += 1) {
      const [r, g, b] = colour(y * width + x);
      if (r * 0.299 + g * 0.587 + b * 0.114 <= cut) { land = [land[0] + r, land[1] + g, land[2] + b]; landCount += 1; }
    }
  }
  land = landCount ? land.map((v) => v / landCount) : sea.map((v) => v * 0.6);
  const distance = (c, m) => (c[0] - m[0]) ** 2 + (c[1] - m[1]) ** 2 + (c[2] - m[2]) ** 2;
  // Two-means, a few rounds.
  let mask = new Uint8Array(n);
  for (let round = 0; round < 6; round += 1) {
    const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (!inside(x, y)) { mask[i] = 0; continue; }
        const c = colour(i);
        const isLand = distance(c, land) < distance(c, sea) ? 1 : 0;
        mask[i] = isLand;
        const s = sums[isLand];
        s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3] += 1;
      }
    }
    if (sums[0][3]) sea = sums[0].slice(0, 3).map((v) => v / sums[0][3]);
    if (sums[1][3]) land = sums[1].slice(0, 3).map((v) => v / sums[1][3]);
  }
  if (cleanRadius > 0) {
    mask = dilate(erode(mask, width, height, cleanRadius), width, height, cleanRadius);
    mask = erode(dilate(mask, width, height, cleanRadius), width, height, cleanRadius);
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (!inside(x, y)) mask[y * width + x] = 0;
  return mask;
};

// Square-window morphology, separable.
const morph = (mask, width, height, radius, keep) => {
  const pass = (source, horizontal) => {
    const out = new Uint8Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let value = keep === "min" ? 1 : 0;
        for (let d = -radius; d <= radius; d += 1) {
          const xx = horizontal ? x + d : x;
          const yy = horizontal ? y : y + d;
          const v = xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : source[yy * width + xx];
          value = keep === "min" ? Math.min(value, v) : Math.max(value, v);
        }
        out[y * width + x] = value;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
};
const erode = (mask, width, height, radius) => morph(mask, width, height, radius, "min");
const dilate = (mask, width, height, radius) => morph(mask, width, height, radius, "max");

// Distance from every land cell to the nearest sea cell, in cells (chamfer 3-4).
const coastDistance = (mask, width, height) => {
  const big = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] ? big : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < d.length; i += 1) d[i] /= 3;
  return d;
};

// ---- Geometry helpers --------------------------------------------------------------

const segmentDistance = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const polylineDistance = (px, py, points) => {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, segmentDistance(px, py, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }
  return points.length === 1 ? Math.hypot(px - points[0][0], py - points[0][1]) : best;
};
const insidePolygon = (px, py, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const boxOf = (points, pad) => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: Math.floor(x0 - pad), y0: Math.floor(y0 - pad), x1: Math.ceil(x1 + pad), y1: Math.ceil(y1 + pad) };
};

// ---- The heightmap ------------------------------------------------------------------

// Metres for every cell: the coast climbs inland, hills everywhere, then what the
// sketch says. A sketch, in cells of this grid:
//   ranges  [{ points: [[x,y],…], crest: m, width: cells }]   ridged crests along a line
//   peaks   [{ x, y, height: m, radius: cells }]               volcanoes, lone summits
//   basins  [{ polygon: [[x,y],…], level: m }]                 plains and forest floors pulled to a level
//   lakes   [{ polygon: [[x,y],…], level: m }]                 flat water
//   rivers  [{ points: [[x,y],…], depth?: m, width?: cells }]  painted rivers, carved into valleys
export const buildHeightmap = (mask, width, height, sketch = {}, { seed = 1, cellKm = 4 } = {}) => {
  const noise = makeValueNoise(seed);
  const ridgeNoise = makeValueNoise(seed + 101);
  const out = new Float32Array(width * height);
  const coast = coastDistance(mask, width, height);
  // Feature scales in cells, so the look holds whatever the grid's size.
  const hillScale = 1 / Math.max(6, 60 / cellKm);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const inland = 1 - Math.exp(-coast[i] / 12);
      const base = 20 + 260 * inland;
      const hills = (fbm(noise, x * hillScale, y * hillScale) * 0.5 + 0.5) * 220 * inland;
      out[i] = base + hills;
    }
  }
  const add = (box, fn) => {
    for (let y = Math.max(0, box.y0); y < Math.min(height, box.y1); y += 1) {
      for (let x = Math.max(0, box.x0); x < Math.min(width, box.x1); x += 1) {
        const i = y * width + x;
        if (mask[i]) out[i] = fn(x, y, out[i]);
      }
    }
  };
  for (const range of sketch.ranges ?? []) {
    const widthCells = Math.max(1, range.width ?? 8);
    add(boxOf(range.points, widthCells * 3), (x, y, h) => {
      const d = polylineDistance(x, y, range.points);
      const fall = Math.exp(-((d / widthCells) ** 2));
      if (fall < 0.002) return h;
      const crest = 0.55 + 0.45 * ridged(ridgeNoise, x * 0.09, y * 0.09);
      return h + range.crest * fall * crest;
    });
  }
  for (const peak of sketch.peaks ?? []) {
    const radius = Math.max(1, peak.radius ?? 6);
    add(boxOf([[peak.x, peak.y]], radius), (x, y, h) => {
      const d = Math.hypot(x - peak.x, y - peak.y);
      if (d >= radius) return h;
      const shape = (1 - d / radius) ** 1.6;
      const rough = 0.85 + 0.15 * ridged(ridgeNoise, x * 0.2, y * 0.2);
      return Math.max(h, h * (1 - shape) + peak.height * shape * rough);
    });
  }
  for (const basin of sketch.basins ?? []) {
    add(boxOf(basin.polygon, 0), (x, y, h) => (insidePolygon(x, y, basin.polygon) ? basin.level + (h - basin.level) * 0.15 : h));
  }
  for (const river of sketch.rivers ?? []) {
    const depth = river.depth ?? 60;
    const widthCells = Math.max(1, river.width ?? 3);
    add(boxOf(river.points, widthCells * 3), (x, y, h) => {
      const d = polylineDistance(x, y, river.points);
      return Math.max(1, h - depth * Math.exp(-((d / widthCells) ** 2)));
    });
  }
  for (const lake of sketch.lakes ?? []) {
    add(boxOf(lake.polygon, 0), (x, y, h) => (insidePolygon(x, y, lake.polygon) ? lake.level : h));
  }
  for (let i = 0; i < out.length; i += 1) out[i] = mask[i] ? Math.max(1, out[i]) : 0;
  return out;
};

// ---- Rivers ----------------------------------------------------------------------------

const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// Where water goes: depressions filled (priority flood from the sea), each land
// cell draining to its lowest neighbour, flow counted in cells upstream; a river
// is every cell carrying more than `threshold`, traced from its source to the
// sea or to the river it joins. Traced rivers (`keep`, the painted ones) come
// first, as drawn.
export const routeRivers = (heights, mask, width, height, { threshold = 400, keep = [], minLength = 6 } = {}) => {
  const n = width * height;
  const filled = new Float32Array(heights);
  const done = new Uint8Array(n);
  // A binary heap of [height, index].
  const heap = [];
  const push = (h, i) => {
    heap.push([h, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i += 1) {
    if (!mask[i]) { done[i] = 1; push(0, i); }
  }
  const order = [];
  while (heap.length) {
    const [h, i] = pop();
    order.push(i);
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of D8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const j = yy * width + xx;
      if (done[j]) continue;
      done[j] = 1;
      filled[j] = Math.max(filled[j], h + 0.001);
      push(filled[j], j);
    }
  }
  // Drain to the lowest neighbour on the filled surface.
  const down = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    let best = -1;
    let bestH = filled[i];
    for (const [dx, dy] of D8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const j = yy * width + xx;
      const h = mask[j] ? filled[j] : -1;
      if (h < bestH) { bestH = h; best = j; }
    }
    down[i] = best;
  }
  const flow = new Float32Array(n).fill(1);
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const i = order[k];
    if (mask[i] && down[i] >= 0) flow[down[i]] += flow[i];
  }
  const rivers = keep.map((river) => ({ points: river.points.map((p) => [p[0], p[1]]), flow: Infinity, traced: true }));
  const taken = new Uint8Array(n);
  // Sources: river cells no upstream river cell flows into.
  const feeds = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) if (mask[i] && flow[i] > threshold && down[i] >= 0) feeds[down[i]] = 1;
  const sources = [];
  for (let i = 0; i < n; i += 1) if (mask[i] && flow[i] > threshold && !feeds[i]) sources.push(i);
  sources.sort((a, b) => flow[b] - flow[a]);
  for (const source of sources) {
    const points = [];
    let i = source;
    let last = 0;
    while (i >= 0) {
      const x = i % width;
      points.push([x, (i - x) / width]);
      last = flow[i];
      if (!mask[i] || taken[i]) break;
      taken[i] = 1;
      i = down[i];
      if (i < 0) break;
      if (!mask[i]) { const xx = i % width; points.push([xx, (i - xx) / width]); break; }
    }
    if (points.length >= minLength) rivers.push({ points, flow: last });
  }
  return rivers.map(({ traced, ...river }) => (traced ? { ...river, flow: Number.MAX_SAFE_INTEGER } : river));
};

// ---- Packing and placing ---------------------------------------------------------------

export const encodeHeight16 = (heights, maxMetres) => {
  const out = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i += 1) {
    out[i] = Math.max(0, Math.min(65535, Math.round((heights[i] / maxMetres) * 65535)));
  }
  return out;
};

// Where a pixel of the picture lies on the map: the picture is stretched between
// its bounds in Web Mercator, as MapLibre's image source draws it
// (server/mapProjection.js imageQuad), so latitude follows the Mercator y.
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOf = (y) => (Math.atan(Math.exp(y)) - Math.PI / 4) * (360 / Math.PI);
export const pixelToLngLat = (x, y, width, height, bounds) => {
  const lng = bounds.west + ((bounds.east - bounds.west) * x) / width;
  const top = mercY(bounds.north);
  const bottom = mercY(bounds.south);
  return [lng, latOf(top + ((bottom - top) * y) / height)];
};
