/*! Open Historia — far-zoom geometry coarsening © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Builds the lowest-detail tier of region geometry, used only when the map is zoomed
// far out. The seed geometry is already coarse (tile-zoom 5), but at world view every
// one of its vertices is still uploaded and drawn while being far below one pixel —
// detail nobody can see, paid for on every frame.
//
// The reduction is a SNAP TO GRID, not ordinary line simplification, and that choice is
// the whole point. Douglas-Peucker (what a GeoJSON source's `tolerance` applies) thins
// each ring independently, so two regions sharing a border can keep different subsets
// of the vertices along it and the shared edge cracks open into sliver gaps — the exact
// reason the main source is pinned at tolerance 0. Snapping is a pure function of the
// coordinate itself: identical vertices round identically, so a shared border stays
// shared, and near-identical ones are welded together rather than pulled apart.
//
// Shapes that collapse below a drawable ring are dropped outright (specks and tiny
// islands), which is itself part of being the far-zoom tier.

const snap = (value, grid) => Math.round(value / grid) * grid;

// A ring keeps its winding and its closure; only redundant vertices go. A polygon ring
// needs 4 positions (3 distinct + the repeated first) to enclose any area at all.
const quantizeRing = (ring, grid) => {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const out = [];
  for (const point of ring) {
    const x = snap(point[0], grid);
    const y = snap(point[1], grid);
    const previous = out[out.length - 1];
    if (previous && previous[0] === x && previous[1] === y) continue;
    out.push([x, y]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (!first) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out.length >= 4 ? out : null;
};

// A polygon survives only if its outer ring does; holes that collapse are simply
// filled in, which at this zoom is invisible and cheaper than keeping them.
const quantizePolygon = (rings, grid) => {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const outer = quantizeRing(rings[0], grid);
  if (!outer) return null;
  const holes = [];
  for (let index = 1; index < rings.length; index += 1) {
    const hole = quantizeRing(rings[index], grid);
    if (hole) holes.push(hole);
  }
  return [outer, ...holes];
};

// Returns null when nothing drawable survives, so callers can drop the feature.
// Non-area geometry has no far-zoom fill to draw and is dropped for the same reason.
export const quantizeGeometry = (geometry, grid) => {
  if (!geometry || !grid) return null;
  if (geometry.type === "Polygon") {
    const coordinates = quantizePolygon(geometry.coordinates, grid);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const coordinates = [];
    for (const polygon of geometry.coordinates ?? []) {
      const quantized = quantizePolygon(polygon, grid);
      if (quantized) coordinates.push(quantized);
    }
    return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
  }
  return null;
};

// ~0.25° ≈ 28km at the equator: under two screen pixels at the zooms this tier is
// visible at, so the outline still reads as the right shape, while the vertex count
// (and the per-frame work at world view) drops sharply.
export const FAR_ZOOM_GRID_DEGREES = 0.25;

// id -> coarsened geometry. Keyed by id so the per-feature PROPERTIES (fill colour,
// stripes) can be re-attached later without redoing any coordinate maths: colours
// change on most turns, geometry almost never does.
export const buildCoarseGeometryById = (featureCollection, grid = FAR_ZOOM_GRID_DEGREES) => {
  const byId = new Map();
  for (const feature of featureCollection?.features ?? []) {
    const id = feature?.properties?.id;
    if (id == null) continue;
    const geometry = quantizeGeometry(feature.geometry, grid);
    if (geometry) byId.set(String(id), geometry);
  }
  return byId;
};
