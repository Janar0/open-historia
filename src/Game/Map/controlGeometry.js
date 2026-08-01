/*! Open Historia — tactical hex geometry helpers © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

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
export const controlSlicePolygon = ({ lng, lat, radiusKm }, control, bearingDeg = 0) => {
  const percentage = Math.max(0, Math.min(100, Number(control) || 0));
  if (percentage <= 0) return null;
  const ring = smoothClosedRing(hexagonPolygon({ lng, lat, radiusKm }), 0.08);
  if (percentage >= 100) return ring;

  const radians = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const normal = [Math.sin(radians), Math.cos(radians)];
  const projections = ring.slice(0, -1).map((point) => {
    const [x, y] = localPoint(point, lat);
    return x * normal[0] + y * normal[1];
  });
  let low = Math.min(...projections);
  let high = Math.max(...projections);
  const targetArea = planarRingArea(ring, lat) * (percentage / 100);
  let clipped = ring;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const threshold = (low + high) / 2;
    const candidate = clipRingAtProjection(ring, lat, normal, threshold);
    const area = candidate ? planarRingArea(candidate, lat) : 0;
    if (area > targetArea) low = threshold;
    else high = threshold;
    clipped = candidate;
  }
  return clipped;
};

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
