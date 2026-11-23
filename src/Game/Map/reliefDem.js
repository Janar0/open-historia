/*! Open Historia — a painted map's relief as DEM tiles, made in the browser © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/Map/reliefDem.test.js
//
// A painted scenario map can carry a relief (scripts/relief/build-relief.mjs):
// a heightmap at half the picture's size. MapLibre lights a `raster-dem` source
// with its `hillshade` layer, so this turns that heightmap into DEM tiles
// (in MapLibre's "custom" DEM encoding) on request, through the `ohdem://` protocol (ReliefLayers.jsx), the way the
// season's tint is made (seasonTintTiles.js). The heightmap is sampled smoothly,
// and below its own resolution a little deterministic detail is added in world
// coordinates, so a small country zoomed in shows hills and gullies instead of
// a blur, and two neighbouring tiles agree where they meet.
//
// The arithmetic is import-free; only the tile loader touches the browser.

export const RELIEF_DEM_PROTOCOL = "ohdem";
export const RELIEF_DEM_TILE_SIZE = 256;

const RAD = Math.PI / 180;
// Web Mercator, as 0..1 from the top of the world.
const mercV = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, lat)) * RAD) / 2)) / (2 * Math.PI);

// Integer-lattice value noise, hashed: no table, so it is the same everywhere.
const hash = (x, y, seed) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const valueNoise = (x, y, seed) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed) + (hash(x0 + 1, y0, seed) - hash(x0, y0, seed)) * tx;
  const b = hash(x0, y0 + 1, seed) + (hash(x0 + 1, y0 + 1, seed) - hash(x0, y0 + 1, seed)) * tx;
  return (a + (b - a) * ty) * 2 - 1;
};

// The heightmap's metres from its packed pixels: red high byte, green low byte,
// of metres / maxMetres * 65535 (the build script's "rg16").
export const decodeReliefPixels = (rgba, maxMetres) => {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i += 1) out[i] = ((rgba[i * 4] * 256 + rgba[i * 4 + 1]) / 65535) * maxMetres;
  return out;
};

// Metres for every pixel of tile z/x/y. `grid` is { width, height, data, bounds }
// (bounds in degrees, the picture's: its corners as the map places it).
// `detail` 0..1 scales the added hills.
// A painted continent is stretched over the whole Mercator square, a heightmap
// cell is some 30 km across, and real mountains at that scale light as almost
// nothing (a slope of a percent or two): heights are multiplied by `scale` for
// the hillshade. Far past terrarium's 32 km, so the tiles use MapLibre's
// "custom" encoding instead (RELIEF_DEM_ENCODING), good to a thousand km.
export const RELIEF_VERTICAL_SCALE = 50;
const DEM_TOP = 1_000_000;

export const reliefTileHeights = (grid, { z, x, y }, { size = RELIEF_DEM_TILE_SIZE, detail = 1, scale = RELIEF_VERTICAL_SCALE } = {}) => {
  const out = new Float32Array(size * size);
  if (!grid?.data) return out;
  const { width, height, data, bounds } = grid;
  const u0 = (bounds.west + 180) / 360;
  const u1 = (bounds.east + 180) / 360;
  const v0 = mercV(bounds.north);
  const v1 = mercV(bounds.south);
  const tiles = 2 ** z;
  const at = (col, row) => data[row * width + col];
  // Octaves finer than the heightmap's own cells, in cells of it, but only those
  // at least three tile pixels long at this zoom: finer ones would only draw
  // grain, like crumpled paper, over the whole map.
  const cellsPerPixel = (width / ((u1 - u0) * tiles)) / size;
  const octaves = [2, 4, 8, 16, 32, 64].filter((frequency) => 1 / frequency >= cellsPerPixel * 3);
  for (let py = 0; py < size; py += 1) {
    const v = (y + (py + 0.5) / size) / tiles;
    const fy = ((v - v0) / (v1 - v0)) * height - 0.5;
    for (let px = 0; px < size; px += 1) {
      const u = (x + (px + 0.5) / size) / tiles;
      const fx = ((u - u0) / (u1 - u0)) * width - 0.5;
      if (fx < -0.5 || fy < -0.5 || fx > width - 0.5 || fy > height - 0.5) continue;
      const cx = Math.max(0, Math.min(width - 1.001, fx));
      const cy = Math.max(0, Math.min(height - 1.001, fy));
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      const tx = cx - ix;
      const ty = cy - iy;
      const h = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty)
        + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
      if (h <= 0.5) continue;
      let extra = 0;
      if (detail > 0) {
        // Rougher where it is higher; fading out at the coast so no island
        // rises from the sea.
        let amplitude = (6 + h * 0.015) * detail * Math.min(1, h / 40);
        for (let o = 0; o < octaves.length; o += 1) {
          extra += valueNoise(cx * octaves[o], cy * octaves[o], o + 1) * amplitude;
          amplitude *= 0.55;
        }
      }
      out[py * size + px] = Math.min(DEM_TOP, Math.max(1, (h + extra) * scale));
    }
  }
  return out;
};

// The tiles' encoding, for the raster-dem source: metres = (red * 65536 +
// green * 256 + blue) / 16, so a sixteenth of a metre to a million metres.
export const RELIEF_DEM_ENCODING = Object.freeze({ redFactor: 4096, greenFactor: 16, blueFactor: 1 / 16, baseShift: 0 });

export const encodeReliefDem = (heights) => {
  const rgba = new Uint8ClampedArray(heights.length * 4);
  for (let i = 0; i < heights.length; i += 1) {
    const v = Math.max(0, Math.min(16777215, Math.round(heights[i] * 16)));
    rgba[i * 4] = (v >> 16) & 255;
    rgba[i * 4 + 1] = (v >> 8) & 255;
    rgba[i * 4 + 2] = v & 255;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
};

// The grid the protocol draws from, and a number for its tile addresses, so a
// new relief is new tiles rather than cached old ones.
let current = null;
export const setReliefGrid = (grid) => {
  current = grid ? { grid, number: (current?.number ?? 0) + 1 } : null;
  return current?.number ?? 0;
};

export const reliefDemTileLoader = async (params) => {
  const match = /^ohdem:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(String(params?.url ?? ""));
  if (!match) throw new Error(`Bad relief tile URL: ${params?.url}`);
  const [z, x, y] = [Number(match[2]), Number(match[3]), Number(match[4])];
  const size = RELIEF_DEM_TILE_SIZE;
  const rgba = encodeReliefDem(reliefTileHeights(current?.grid, { z, x, y }, { size }));
  const canvas = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(size, size)
    : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(rgba, size, size), 0, 0);
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/png" })
    : await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return { data: await blob.arrayBuffer() };
};

// Whether the scenario's own painted picture, the one its relief belongs to, is
// what the map is showing (World.jsx publishes it). A player may pick another of
// the scenario's maps, or an Earth basemap, and the relief must not be laid over
// that. Kept here, import-free, so World.jsx and ReliefLayers.jsx share it
// without importing each other.
let paintingShown = false;
const paintingListeners = new Set();
export const publishPaintingShown = (shown) => {
  const next = Boolean(shown);
  if (next === paintingShown) return;
  paintingShown = next;
  for (const listener of paintingListeners) listener();
};
export const subscribePaintingShown = (listener) => {
  paintingListeners.add(listener);
  return () => paintingListeners.delete(listener);
};
export const getPaintingShown = () => paintingShown;
