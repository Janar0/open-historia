/*! Open Historia — tactical-front continuity checks © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

const EARTH_RADIUS_KM = 6371.0088;

export const tacticalDistanceKm = (left, right) => {
  const leftLng = Number(left?.lng ?? left?.center?.lng);
  const leftLat = Number(left?.lat ?? left?.center?.lat);
  const rightLng = Number(right?.lng ?? right?.center?.lng);
  const rightLat = Number(right?.lat ?? right?.center?.lat);
  if (![leftLng, leftLat, rightLng, rightLat].every(Number.isFinite)) return Infinity;
  const radians = Math.PI / 180;
  const dLat = (rightLat - leftLat) * radians;
  const dLng = (rightLng - leftLng) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(leftLat * radians) * Math.cos(rightLat * radians) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const radius = (cell) => Math.max(0.5, Number(cell?.radiusKm) || 0.5);

const tacticalCoordinates = (candidate) => {
  const center = candidate?.center && typeof candidate.center === "object" ? candidate.center : candidate;
  const lng = Number(center?.lng);
  const lat = Number(center?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
};

const geometryRings = (geometryLike) => {
  const geometry = geometryLike?.type === "Feature" ? geometryLike.geometry : geometryLike;
  if (geometry?.type === "Polygon") return geometry.coordinates || [];
  if (geometry?.type === "MultiPolygon") return (geometry.coordinates || []).flat();
  return [];
};

export const tacticalNearestBoundaryPoint = (candidate, geometry) => {
  const origin = tacticalCoordinates(candidate);
  if (!origin) return null;
  const kmPerLng = 111.32 * Math.max(0.08, Math.cos((origin.lat * Math.PI) / 180));
  let best = null;
  for (const ring of geometryRings(geometry)) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const left = ring[index];
      const right = ring[index + 1];
      if (!Array.isArray(left) || !Array.isArray(right)) continue;
      const ax = (Number(left[0]) - origin.lng) * kmPerLng;
      const ay = (Number(left[1]) - origin.lat) * 111.32;
      const bx = (Number(right[0]) - origin.lng) * kmPerLng;
      const by = (Number(right[1]) - origin.lat) * 111.32;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const ratio = lengthSquared > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
      const x = ax + dx * ratio;
      const y = ay + dy * ratio;
      const distanceKm = Math.hypot(x, y);
      if (!best || distanceKm < best.distanceKm) {
        best = {
          lng: origin.lng + x / kmPerLng,
          lat: origin.lat + y / 111.32,
          distanceKm,
          bearingDeg: (Math.atan2(x, y) * 180) / Math.PI,
        };
      }
    }
  }
  return best;
};

export const tacticalOffsetPoint = (candidate, bearingDeg, distanceKm) => {
  const origin = tacticalCoordinates(candidate);
  if (!origin) return null;
  const radians = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  return {
    lng: origin.lng + (Math.sin(radians) * distanceKm)
      / (111.32 * Math.max(0.08, Math.cos((origin.lat * Math.PI) / 180))),
    lat: origin.lat + (Math.cos(radians) * distanceKm) / 111.32,
  };
};

export const tacticalEntryPoint = (anchor, targetGeometry, insetKm = 2) => {
  const boundary = tacticalNearestBoundaryPoint(anchor, targetGeometry);
  if (!boundary) return null;
  const point = tacticalOffsetPoint(boundary, boundary.bearingDeg, Math.max(0.5, Number(insetKm) || 2));
  return point ? { ...point, boundary, bearingDeg: boundary.bearingDeg } : null;
};

export const tacticalConnectionLimitKm = (left, right) => Math.min(
  48,
  // Cells represent adjacent ground, not radio range.  The old 1.8x + 8 km
  // allowance let visibly separate hexes count as one "continuous" front.
  // A little tolerance is still needed for hand-authored coordinates and map
  // projection, but neighboring footprints now have to almost touch.
  Math.max(4, (radius(left) + radius(right)) * 1.12 + 1.5),
);

export const tacticalConnectedComponents = (cells) => {
  const usable = (cells || []).filter((cell) => Number.isFinite(Number(cell?.center?.lng ?? cell?.lng))
    && Number.isFinite(Number(cell?.center?.lat ?? cell?.lat)));
  const remaining = new Set(usable.map((_, index) => index));
  const components = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const reached = new Set([first]);
    const queue = [first];
    remaining.delete(first);
    while (queue.length) {
      const index = queue.shift();
      for (const candidate of Array.from(remaining)) {
        if (tacticalDistanceKm(usable[index], usable[candidate]) > tacticalConnectionLimitKm(usable[index], usable[candidate])) continue;
        reached.add(candidate);
        remaining.delete(candidate);
        queue.push(candidate);
      }
    }
    components.push(Array.from(reached).map((index) => usable[index]));
  }
  return components;
};

export const tacticalCellsAreConnected = (cells) => tacticalConnectedComponents(cells).length <= 1;

export const hasTacticalAnchor = (cells, anchors) => {
  const targets = cells?.length ? cells : [];
  for (const target of targets) {
    for (const anchor of anchors || []) {
      if (tacticalDistanceKm(target, anchor) <= tacticalConnectionLimitKm(target, anchor)) return true;
    }
  }
  return false;
};

export const groundSpawnIsFriendly = ({
  ownerCode,
  locationOwnerCode,
  hasRegionCatalog = true,
  isNewPolity = false,
}) => isNewPolity
  || !hasRegionCatalog
  || (String(ownerCode || "").trim().toLowerCase()
    === String(locationOwnerCode || "").trim().toLowerCase()
    && Boolean(String(locationOwnerCode || "").trim()));

export const hostileGroundMoveIsContinuous = (unit, destination, controlledCells, maxDistanceKm = 120) =>
  tacticalDistanceKm(unit, destination) <= maxDistanceKm
  && hasTacticalAnchor([destination], controlledCells);
