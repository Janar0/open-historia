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
