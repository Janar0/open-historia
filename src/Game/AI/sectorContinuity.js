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

export const tacticalConnectionLimitKm = (left, right) => Math.min(
  90,
  Math.max(12, (radius(left) + radius(right)) * 1.8 + 8),
);

export const tacticalCellsAreConnected = (cells) => {
  const usable = (cells || []).filter((cell) => Number.isFinite(Number(cell?.center?.lng ?? cell?.lng))
    && Number.isFinite(Number(cell?.center?.lat ?? cell?.lat)));
  if (usable.length < 2) return true;
  const reached = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const index = queue.shift();
    for (let candidate = 0; candidate < usable.length; candidate += 1) {
      if (reached.has(candidate)) continue;
      if (tacticalDistanceKm(usable[index], usable[candidate]) > tacticalConnectionLimitKm(usable[index], usable[candidate])) continue;
      reached.add(candidate);
      queue.push(candidate);
    }
  }
  return reached.size === usable.length;
};

export const hasTacticalAnchor = (cells, anchors) => {
  const targets = cells?.length ? cells : [];
  for (const target of targets) {
    for (const anchor of anchors || []) {
      if (tacticalDistanceKm(target, anchor) <= tacticalConnectionLimitKm(target, anchor)) return true;
    }
  }
  return false;
};
