/*! Open Historia — operational frontage geometry © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

const KM_PER_DEGREE = 111.32;

const pointOf = (value) => {
  const center = value?.center && typeof value.center === "object" ? value.center : value;
  const lng = Number(center?.lng);
  const lat = Number(center?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
};

const radiusOf = (cell, fallback = 4) => Math.max(1, Number(cell?.radiusKm) || fallback);

export const offsetFrontPoint = (center, distanceKm, bearingDeg) => {
  const point = pointOf(center);
  if (!point) return null;
  const bearing = (Number(bearingDeg) * Math.PI) / 180;
  const latOffset = (Math.cos(bearing) * Number(distanceKm || 0)) / KM_PER_DEGREE;
  const cosLat = Math.max(0.08, Math.cos((point.lat * Math.PI) / 180));
  const lngOffset = (Math.sin(bearing) * Number(distanceKm || 0)) / (KM_PER_DEGREE * cosLat);
  return { lng: point.lng + lngOffset, lat: point.lat + latOffset };
};

export const projectFrontPoint = (center, origin, bearingDeg) => {
  const point = pointOf(center);
  const base = pointOf(origin);
  if (!point || !base) return null;
  const cosLat = Math.max(0.08, Math.cos((base.lat * Math.PI) / 180));
  const east = (point.lng - base.lng) * KM_PER_DEGREE * cosLat;
  const north = (point.lat - base.lat) * KM_PER_DEGREE;
  const bearing = (Number(bearingDeg) * Math.PI) / 180;
  return {
    forward: east * Math.sin(bearing) + north * Math.cos(bearing),
    lateral: east * Math.cos(bearing) - north * Math.sin(bearing),
  };
};

const pointAtProjection = (origin, bearing, forward, lateral) => {
  const forwardPoint = offsetFrontPoint(origin, forward, bearing);
  return forwardPoint ? offsetFrontPoint(forwardPoint, lateral, bearing + 90) : null;
};

const closeRing = (points) => {
  if (!Array.isArray(points) || points.length < 3 || points.some((point) => !point)) return null;
  return [...points, points[0]];
};

const coordinatePoint = (coordinate) => (
  Array.isArray(coordinate) && coordinate.length >= 2
    ? { lng: Number(coordinate[0]), lat: Number(coordinate[1]) }
    : null
);

// Keep the contact line as the authoritative anchor for every secondary
// tactical layer. Offsetting the line in the same local projection prevents
// support/defence bands from drifting away when the front is diagonal.
export const buildParallelFrontLine = (line, distanceKm, bearingDeg) => {
  if (!Array.isArray(line) || line.length < 2) return [];
  return line
    .map(coordinatePoint)
    .filter(Boolean)
    .map((point) => offsetFrontPoint(point, distanceKm, bearingDeg))
    .filter(Boolean)
    .map((point) => [point.lng, point.lat]);
};

// A narrow combat zone makes the battle legible as a real contact rather than
// a red outline floating at the edge of a large captured polygon. The rear
// and enemy depths are deliberately asymmetric: the held ground gets a little
// more room for reserves, while the hostile side only receives a thin danger
// band beyond the line.
export const buildCombatBand = (line, bearingDeg, rearDepthKm = 2.6, enemyDepthKm = 1.6) => {
  const rear = buildParallelFrontLine(line, -Math.abs(Number(rearDepthKm) || 2.6), bearingDeg);
  const enemy = buildParallelFrontLine(line, Math.abs(Number(enemyDepthKm) || 1.6), bearingDeg);
  const ring = closeRing([
    ...rear,
    ...enemy.reverse(),
  ].map(coordinatePoint));
  return ring ? ring.map((point) => [point.lng, point.lat]) : null;
};

// Build the operational occupied ground as a tapered bridgehead rather than a
// union of round bubbles. The individual cells remain authoritative in state;
// this is the map's military envelope: rear line, flanks, and a jagged contact
// edge that can carry the front teeth and attack arrows.
export const buildOperationalEnvelope = (cells, sector, bearingDeg) => {
  const origin = pointOf(sector?.frontOrigin || sector?.center || cells?.[0]);
  if (!origin || !Array.isArray(cells) || !cells.length) return null;
  const entries = cells.map((cell) => {
    const center = pointOf(cell);
    const projection = center ? projectFrontPoint(center, origin, bearingDeg) : null;
    return center && projection ? { cell, center, projection, radiusKm: radiusOf(cell, sector?.radiusKm) } : null;
  }).filter(Boolean);
  if (!entries.length) return null;

  const minForward = Math.min(...entries.map((entry) => entry.projection.forward));
  const maxForward = Math.max(...entries.map((entry) => entry.projection.forward));
  const minLateral = Math.min(...entries.map((entry) => entry.projection.lateral - entry.radiusKm * 0.7));
  const maxLateral = Math.max(...entries.map((entry) => entry.projection.lateral + entry.radiusKm * 0.7));
  const lateralCenter = (minLateral + maxLateral) / 2;
  const averageRadius = entries.reduce((sum, entry) => sum + entry.radiusKm, 0) / entries.length;
  const declaredWidth = Number(sector?.frontWidthKm);
  const occupiedSpan = Math.max(0, maxLateral - minLateral);
  const frontHalfWidth = Math.max(
    4.2,
    // `frontWidthKm` describes the whole theatre frontage. It must not be
    // copied verbatim to the local contact edge: doing that pushed the red
    // line several kilometres beyond the lead cell and made the front appear
    // to have detached from its formations.
    Math.min(8.5, Math.max(occupiedSpan * 0.5, Number.isFinite(declaredWidth) ? declaredWidth * 0.28 : 0)),
  );
  const rearHalfWidth = Math.max(3.2, Math.min(frontHalfWidth * 0.86, averageRadius * 1.35));
  const rearDepth = minForward - averageRadius * 0.7;
  const contactDepth = maxForward + averageRadius * 0.58;
  const middleDepth = rearDepth + (contactDepth - rearDepth) * 0.62;
  const leftRear = pointAtProjection(origin, bearingDeg, rearDepth, lateralCenter - rearHalfWidth);
  const leftMiddle = pointAtProjection(
    origin,
    bearingDeg,
    middleDepth,
    Math.min(lateralCenter - rearHalfWidth * 0.92, minLateral + averageRadius * 0.2),
  );
  const leftContact = pointAtProjection(origin, bearingDeg, contactDepth, lateralCenter - frontHalfWidth);
  const contactTip = pointAtProjection(origin, bearingDeg, contactDepth + Math.min(1.8, averageRadius * 0.24), lateralCenter);
  const rightContact = pointAtProjection(origin, bearingDeg, contactDepth, lateralCenter + frontHalfWidth);
  const rightMiddle = pointAtProjection(
    origin,
    bearingDeg,
    middleDepth,
    Math.max(lateralCenter + rearHalfWidth * 0.92, maxLateral - averageRadius * 0.2),
  );
  const rightRear = pointAtProjection(origin, bearingDeg, rearDepth, lateralCenter + rearHalfWidth);
  const ring = closeRing([leftRear, leftMiddle, leftContact, contactTip, rightContact, rightMiddle, rightRear]);
  const contactLine = [leftContact, contactTip, rightContact].filter(Boolean).map((point) => [point.lng, point.lat]);
  const leftFlank = [leftRear, leftMiddle, leftContact].filter(Boolean).map((point) => [point.lng, point.lat]);
  const rightFlank = [rightRear, rightMiddle, rightContact].filter(Boolean).map((point) => [point.lng, point.lat]);
  const rearLine = [leftRear, rightRear].filter(Boolean).map((point) => [point.lng, point.lat]);
  if (!ring || contactLine.length < 2) return null;
  return {
    ring: ring.map((point) => [point.lng, point.lat]),
    contactLine,
    leftFlank,
    rightFlank,
    rearLine,
    lead: entries.reduce((best, entry) => (
      !best || entry.projection.forward > best.projection.forward ? entry : best
    ), null),
    rear: entries.reduce((best, entry) => (
      !best || entry.projection.forward < best.projection.forward ? entry : best
    ), null),
  };
};

export const buildOperationalRoute = (start, end, bearingDeg = 0, bendKm = 0) => {
  const left = pointOf(start);
  const right = pointOf(end);
  if (!left || !right) return null;
  const middle = {
    lng: (left.lng + right.lng) / 2,
    lat: (left.lat + right.lat) / 2,
  };
  const bend = bendKm ? offsetFrontPoint(middle, bendKm, bearingDeg + 90) : middle;
  return [[left.lng, left.lat], [bend.lng, bend.lat], [right.lng, right.lat]];
};

// A connected row of contested cells is the tactical contact rail: it anchors
// battle markers to the actual formations without pretending that the whole
// occupied corridor is one administrative border. Keep this separate from the
// short toothed leading contact used for the assault edge.
export const buildEngagementRail = (cells, origin, bearingDeg = 0, lateralOffsetKm = 0.7) => {
  if (!Array.isArray(cells) || cells.length < 2) return null;
  const entries = cells.map((cell) => {
    const center = pointOf(cell);
    const projection = center && projectFrontPoint(center, origin, bearingDeg);
    return center && projection ? { center, projection } : null;
  }).filter(Boolean).sort((left, right) => left.projection.forward - right.projection.forward);
  const rail = entries.map(({ center }) => {
    const point = offsetFrontPoint(center, lateralOffsetKm, Number(bearingDeg) + 90);
    return point ? [point.lng, point.lat] : null;
  }).filter(Boolean);
  return rail.length > 1 ? rail : null;
};

export const buildEngagementRailTeeth = (rail, bearingDeg = 0) => {
  if (!Array.isArray(rail) || rail.length < 2) return [];
  const teeth = [];
  for (let index = 0; index < rail.length - 1; index += 1) {
    const start = rail[index];
    const end = rail[index + 1];
    const distance = Math.hypot(
      (Number(end[0]) - Number(start[0])) * 111.32 * Math.max(0.08, Math.cos((Number(start[1]) * Math.PI) / 180)),
      (Number(end[1]) - Number(start[1])) * 111.32,
    );
    const count = Math.max(1, Math.floor(distance / 5.2));
    for (let toothIndex = 1; toothIndex <= count; toothIndex += 1) {
      const ratio = toothIndex / (count + 1);
      const point = [
        Number(start[0]) + (Number(end[0]) - Number(start[0])) * ratio,
        Number(start[1]) + (Number(end[1]) - Number(start[1])) * ratio,
      ];
      const tip = offsetFrontPoint(
        { lng: point[0], lat: point[1] },
        Math.min(1.35, Math.max(0.8, distance / 10)),
        bearingDeg,
      );
      if (tip) teeth.push([point, [tip.lng, tip.lat]]);
    }
  }
  return teeth;
};
