/*! Open Historia — tactical hex geometry helpers © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import polygonClipping from "polygon-clipping";

export const hexagonPolygon = ({ lng, lat, radiusKm }) => {
  const safeLat = Math.max(-84, Math.min(84, Number(lat)));
  const safeRadius = Math.max(0.05, Number(radiusKm) || 0.05);
  const latRadius = safeRadius / 111.32;
  const lngRadius = safeRadius / (111.32 * Math.max(0.08, Math.cos((safeLat * Math.PI) / 180)));
  const coordinates = [];
  for (let index = 0; index <= 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2 + Math.PI / 6;
    coordinates.push([
      Math.max(-180, Math.min(180, Number(lng) + lngRadius * Math.cos(angle))),
      Math.max(-84, Math.min(84, safeLat + latRadius * Math.sin(angle))),
    ]);
  }
  return coordinates;
};

// Rendering cells as literal hexes exposed the simulation grid and made a
// front look like a board game.  This deterministic, slightly uneven ring is
// used only for presentation; authoritative centers/radii remain unchanged.
export const tacticalAreaPolygon = ({
  lng,
  lat,
  radiusKm,
  bearingDeg = 0,
  depthScale = 1,
  frontScale = 1,
}, seed = "") => {
  const safeLat = Math.max(-84, Math.min(84, Number(lat)));
  const safeRadius = Math.max(0.05, Number(radiusKm) || 0.05);
  const latRadius = safeRadius / 111.32;
  const lngRadius = safeRadius / (111.32 * Math.max(0.08, Math.cos((safeLat * Math.PI) / 180)));
  let hash = 2166136261;
  for (const character of `${seed}:${lng}:${lat}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const coordinates = [];
  const vertices = 20;
  const bearing = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const normal = [Math.sin(bearing), Math.cos(bearing)];
  const tangent = [Math.cos(bearing), -Math.sin(bearing)];
  const safeDepth = Math.max(0.45, Math.min(1.4, Number(depthScale) || 1));
  const safeFront = Math.max(0.7, Math.min(2.2, Number(frontScale) || 1));
  for (let index = 0; index <= vertices; index += 1) {
    const angle = (index / vertices) * Math.PI * 2;
    // Two low-frequency waves keep adjacent vertices smooth while preventing
    // the perfect-circle "bubble" look.
    const phase = ((hash % 360) * Math.PI) / 180;
    const wobble = 1 + Math.sin(angle * 3 + phase) * 0.045 + Math.cos(angle * 5 - phase * 0.7) * 0.025;
    const alongFront = Math.cos(angle) * safeFront;
    const throughFront = Math.sin(angle) * safeDepth;
    const east = tangent[0] * alongFront + normal[0] * throughFront;
    const north = tangent[1] * alongFront + normal[1] * throughFront;
    coordinates.push([
      Math.max(-180, Math.min(180, Number(lng) + lngRadius * wobble * east)),
      Math.max(-84, Math.min(84, safeLat + latRadius * wobble * north)),
    ]);
  }
  return coordinates;
};

const localPoint = ([lng, lat], centerLat) => [
  lng * Math.max(0.08, Math.cos((centerLat * Math.PI) / 180)),
  lat,
];

const planarRingArea = (ring, centerLat) => {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [ax, ay] = localPoint(ring[index], centerLat);
    const [bx, by] = localPoint(ring[index + 1], centerLat);
    twiceArea += ax * by - bx * ay;
  }
  return Math.abs(twiceArea) / 2;
};

const planarMultiPolygonArea = (multiPolygon, centerLat) => (multiPolygon || []).reduce(
  (total, polygon) => total + (polygon || []).reduce((area, ring, ringIndex) => (
    area + planarRingArea(ring, centerLat) * (ringIndex === 0 ? 1 : -1)
  ), 0),
  0,
);

const closeRing = (points) => {
  if (!Array.isArray(points) || points.length < 3) return null;
  const ring = [...points];
  const first = ring[0];
  const last = ring.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring;
};

const clipRingAtProjection = (ring, centerLat, normal, threshold) => {
  const source = ring.slice(0, -1);
  const score = (point) => {
    const [x, y] = localPoint(point, centerLat);
    return x * normal[0] + y * normal[1];
  };
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[(index + 1) % source.length];
    const currentScore = score(current);
    const nextScore = score(next);
    const currentInside = currentScore >= threshold;
    const nextInside = nextScore >= threshold;
    if (currentInside) output.push(current);
    if (currentInside === nextInside) continue;
    const denominator = nextScore - currentScore;
    const ratio = denominator === 0 ? 0 : (threshold - currentScore) / denominator;
    output.push([
      current[0] + (next[0] - current[0]) * ratio,
      current[1] + (next[1] - current[1]) * ratio,
    ]);
  }
  return closeRing(output);
};

// Turns a tactical control percentage into actual occupied AREA. Previously a
// 55% cell painted the entire cell at a slightly lower opacity, so three cells
// read as one translucent capsule. This clips the cell along a stable front
// bearing and binary-searches the cut until the visible polygon has the requested
// share of the original area. The state stays percentage-based and deterministic.
export const controlSliceRing = (ring, control, bearingDeg = 0, centerLat = 0) => {
  const percentage = Math.max(0, Math.min(100, Number(control) || 0));
  if (percentage <= 0) return null;
  if (percentage >= 100) return ring;

  const radians = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const normal = [Math.sin(radians), Math.cos(radians)];
  const projections = ring.slice(0, -1).map((point) => {
    const [x, y] = localPoint(point, centerLat);
    return x * normal[0] + y * normal[1];
  });
  let low = Math.min(...projections);
  let high = Math.max(...projections);
  const targetArea = planarRingArea(ring, centerLat) * (percentage / 100);
  let clipped = ring;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const threshold = (low + high) / 2;
    const candidate = clipRingAtProjection(ring, centerLat, normal, threshold);
    const area = candidate ? planarRingArea(candidate, centerLat) : 0;
    if (area > targetArea) low = threshold;
    else high = threshold;
    clipped = candidate;
  }
  return clipped;
};

// Cut the already-unioned tactical footprint once. Cutting each source cell
// independently can reopen gaps between touching cells and reveal the hidden
// grid. A single half-plane keeps the visible advance territorial and coherent.
export const controlSliceMultiPolygon = (multiPolygon, control, bearingDeg = 0, centerLat = 0) => {
  const percentage = Math.max(0, Math.min(100, Number(control) || 0));
  if (percentage <= 0 || !multiPolygon?.length) return [];
  if (percentage >= 100) return multiPolygon;
  const cosLat = Math.max(0.08, Math.cos((centerLat * Math.PI) / 180));
  const radians = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const normal = [Math.sin(radians), Math.cos(radians)];
  const tangent = [-normal[1], normal[0]];
  const points = multiPolygon.flat(2);
  const projected = points.map((point) => {
    const local = localPoint(point, centerLat);
    return {
      normal: local[0] * normal[0] + local[1] * normal[1],
      tangent: local[0] * tangent[0] + local[1] * tangent[1],
    };
  });
  let low = Math.min(...projected.map((entry) => entry.normal));
  let high = Math.max(...projected.map((entry) => entry.normal));
  const tangentLow = Math.min(...projected.map((entry) => entry.tangent));
  const tangentHigh = Math.max(...projected.map((entry) => entry.tangent));
  const span = Math.max(high - low, tangentHigh - tangentLow, 0.01) * 4 + 1;
  const targetArea = planarMultiPolygonArea(multiPolygon, centerLat) * (percentage / 100);
  const fromLocal = (projection, sideways) => {
    const x = normal[0] * projection + tangent[0] * sideways;
    const y = normal[1] * projection + tangent[1] * sideways;
    return [x / cosLat, y];
  };
  let clipped = multiPolygon;
  for (let iteration = 0; iteration < 22; iteration += 1) {
    const threshold = (low + high) / 2;
    const mask = [[[
      fromLocal(threshold, tangentLow - span),
      fromLocal(high + span, tangentLow - span),
      fromLocal(high + span, tangentHigh + span),
      fromLocal(threshold, tangentHigh + span),
      fromLocal(threshold, tangentLow - span),
    ]]];
    try {
      clipped = polygonClipping.intersection(multiPolygon, mask);
    } catch {
      return multiPolygon;
    }
    const area = planarMultiPolygonArea(clipped, centerLat);
    if (area > targetArea) low = threshold;
    else high = threshold;
  }
  return clipped;
};

export const controlSlicePolygon = ({ lng, lat, radiusKm }, control, bearingDeg = 0) =>
  controlSliceRing(
    smoothClosedRing(hexagonPolygon({ lng, lat, radiusKm }), 0.08),
    control,
    bearingDeg,
    lat,
  );

// Chaikin smoothing is deliberately visual: the exact control cells and their
// references remain sharp in the state, while their rendered edges stop looking
// like a computer-generated honeycomb on the map. `passes` stays capped so a
// malformed/very detailed ring cannot explode into a huge GeoJSON payload.
export const smoothClosedRing = (ring, ratio = 0.14, passes = 1) => {
  if (!Array.isArray(ring) || ring.length < 4) return ring;
  const source = ring.slice(0, -1);
  const cut = Math.max(0.05, Math.min(0.24, ratio));
  let points = source;
  const iterations = Math.max(1, Math.min(2, Math.trunc(Number(passes) || 1)));
  for (let pass = 0; pass < iterations; pass += 1) {
    const output = [];
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      output.push([
        current[0] + (next[0] - current[0]) * cut,
        current[1] + (next[1] - current[1]) * cut,
      ]);
      output.push([
        next[0] - (next[0] - current[0]) * cut,
        next[1] - (next[1] - current[1]) * cut,
      ]);
    }
    points = output;
  }
  points.push(points[0]);
  return points;
};
