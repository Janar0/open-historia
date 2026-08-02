/*! Open Historia — tactical-front continuity checks © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";

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

export const tacticalProjectPoint = (originCandidate, pointCandidate, bearingDeg) => {
  const origin = tacticalCoordinates(originCandidate);
  const candidate = tacticalCoordinates(pointCandidate);
  if (!origin || !candidate) return null;
  const radians = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const eastKm = (candidate.lng - origin.lng) * 111.32
    * Math.max(0.08, Math.cos((origin.lat * Math.PI) / 180));
  const northKm = (candidate.lat - origin.lat) * 111.32;
  return {
    forwardKm: eastKm * Math.sin(radians) + northKm * Math.cos(radians),
    rightKm: eastKm * Math.cos(radians) - northKm * Math.sin(radians),
  };
};

export const tacticalEntryPoint = (anchor, targetGeometry, insetKm = 2) => {
  const boundary = tacticalNearestBoundaryPoint(anchor, targetGeometry);
  if (!boundary) return null;
  const point = tacticalOffsetPoint(boundary, boundary.bearingDeg, Math.max(0.5, Number(insetKm) || 2));
  return point ? { ...point, boundary, bearingDeg: boundary.bearingDeg } : null;
};

export const tacticalGeometryContainsPoint = (geometry, candidate) => {
  const coordinates = tacticalCoordinates(candidate);
  if (!geometry || !coordinates) return false;
  try {
    return booleanPointInPolygon(point([coordinates.lng, coordinates.lat]), geometry, { ignoreBoundary: false });
  } catch {
    return false;
  }
};

export const deriveTacticalBorderSector = ({ sector, targetRegion, anchor, excludedGeometries = [] }) => {
  if (!sector?.id || !targetRegion?.id || !targetRegion?.geometry) return null;
  const rawRadius = Number(sector.radiusKm) || 9;
  const cellRadiusKm = Math.max(2.5, Math.min(5, rawRadius * 0.38));
  const boundary = tacticalNearestBoundaryPoint(anchor, targetRegion.geometry);
  if (!boundary) return null;
  const isExclusiveTargetPoint = (candidate) => (
    tacticalGeometryContainsPoint(targetRegion.geometry, candidate)
    && !excludedGeometries.some((geometry) => tacticalGeometryContainsPoint(geometry, candidate))
  );
  const initialInsetKm = cellRadiusKm * 0.9 + 1;
  let entry = null;
  for (let insetKm = initialInsetKm; insetKm <= 30; insetKm += 1.5) {
    const candidate = tacticalOffsetPoint(boundary, boundary.bearingDeg, insetKm);
    if (!candidate || !isExclusiveTargetPoint(candidate)) continue;
    entry = { ...candidate, boundary, bearingDeg: boundary.bearingDeg };
    break;
  }
  if (!entry) return null;
  const advanceBearing = ((entry.bearingDeg % 360) + 360) % 360;
  // The first contact is a compact bridgehead across the border, not a thin
  // arrow aimed at a remote objective. Later events extend this connected
  // patch forward one cell at a time.
  const centers = [-1, 1]
    .map((side) => tacticalOffsetPoint(entry, advanceBearing + 90, side * cellRadiusKm * 0.72))
    .filter((center) => center && isExclusiveTargetPoint(center));
  if (!centers.length) centers.push(entry);
  const control = Math.max(12, Math.min(35, Number(sector.control) || 24));
  const cells = centers.map((center, index) => ({
    id: `${sector.id}-entry-${index + 1}`,
    depth: 1,
    ownerCode: sector.ownerCode,
    ...(sector.contestedBy ? { contestedBy: sector.contestedBy } : {}),
    control,
    center: { lng: center.lng, lat: center.lat },
    radiusKm: cellRadiusKm,
    status: "assault",
    note: sector.note,
  }));
  const frontWidthKm = Math.round(cellRadiusKm * 2.4 * 10) / 10;
  const advanceDepthKm = Math.round(Math.max(
    frontWidthKm,
    ...cells.map((cell) => tacticalDistanceKm(boundary, cell) + radius(cell) * 1.05),
  ) * 10) / 10;
  return {
    ...sector,
    regionId: targetRegion.id,
    center: {
      lng: cells.reduce((sum, cell) => sum + cell.center.lng, 0) / cells.length,
      lat: cells.reduce((sum, cell) => sum + cell.center.lat, 0) / cells.length,
    },
    frontOrigin: { lng: boundary.lng, lat: boundary.lat },
    frontBearing: advanceBearing,
    frontWidthKm,
    advanceDepthKm,
    radiusKm: cellRadiusKm * 2,
    control,
    status: "assault",
    cells,
  };
};

const tacticalLeafCells = (sector) => {
  const cells = Array.isArray(sector?.cells) ? sector.cells : [];
  const parentIds = new Set(cells.map((cell) => cell?.parentCellId).filter(Boolean));
  return cells.filter((cell) => cell?.id && !parentIds.has(cell.id));
};

// Older saves know the stable direction but predate explicit border-entry
// geometry. Collapse their old sideways cell cloud into the same directed
// corridor so loading an existing game does not resurrect the bubble renderer.
export const inferTacticalFrontGeometry = (sector) => {
  const bearing = Number(sector?.frontBearing);
  const leaves = tacticalLeafCells(sector).filter((cell) => tacticalCoordinates(cell));
  if (!Number.isFinite(bearing) || !leaves.length) return null;
  const averageRadiusKm = leaves.reduce((sum, cell) => sum + radius(cell), 0) / leaves.length;
  const suppliedCenter = tacticalCoordinates(sector.center);
  const center = suppliedCenter || {
    lng: leaves.reduce((sum, cell) => sum + tacticalCoordinates(cell).lng, 0) / leaves.length,
    lat: leaves.reduce((sum, cell) => sum + tacticalCoordinates(cell).lat, 0) / leaves.length,
  };
  const projections = leaves.map((cell) => tacticalProjectPoint(center, cell, bearing));
  const rearProjectionKm = Math.min(...projections.map((entry) => entry.forwardKm));
  const frontOrigin = tacticalOffsetPoint(center, bearing, rearProjectionKm - averageRadiusKm * 1.05);
  if (!frontOrigin) return null;
  const frontWidthKm = Math.round(Math.max(2, Math.min(60, averageRadiusKm * 2.4)) * 10) / 10;
  const advanceDepthKm = Math.round(Math.max(
    frontWidthKm * 1.2,
    ...leaves.map((cell) => {
      const projection = tacticalProjectPoint(frontOrigin, cell, bearing);
      return projection.forwardKm + radius(cell) * 1.05;
    }),
  ) * 10) / 10;
  return {
    frontOrigin,
    frontBearing: ((bearing % 360) + 360) % 360,
    frontWidthKm,
    advanceDepthKm,
  };
};

const clampControlChange = (before, after, delta) => {
  const previous = Math.max(0, Math.min(100, Number(before) || 0));
  const requested = Math.max(0, Math.min(100, Number(after) || 0));
  return Math.round(Math.max(previous - delta, Math.min(previous + delta, requested)));
};

// Reconcile a model-authored snapshot with the persistent front. Existing map
// cells are physical places: their ids cannot teleport, disappear without an
// explicit remove, or flip from 20% to 100% in one event. New ground is admitted
// only as a small number of cells immediately beside the previous footprint.
export const boundTacticalSectorEvolution = (previousSector, candidateSector, {
  maxControlDelta = 18,
  maxNewCells = 3,
  maxAdvanceKm = 28,
  removedCellIds = [],
} = {}) => {
  const previousCells = Array.isArray(previousSector?.cells) ? previousSector.cells : [];
  const candidateCells = Array.isArray(candidateSector?.cells) ? candidateSector.cells : [];
  if (!previousCells.length || !candidateCells.length) return candidateSector;

  const explicitlyRemoved = new Set(removedCellIds.map(String));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const cell of previousCells) {
      if (cell?.parentCellId && explicitlyRemoved.has(String(cell.parentCellId)) && !explicitlyRemoved.has(String(cell.id))) {
        explicitlyRemoved.add(String(cell.id));
        expanded = true;
      }
    }
  }

  const previousById = new Map(previousCells.map((cell) => [String(cell.id), cell]));
  const admitted = [];
  const admittedIds = new Set();
  const existingLeaves = tacticalLeafCells(previousSector);
  const averageRadius = existingLeaves.length
    ? existingLeaves.reduce((sum, cell) => sum + Math.max(0.5, Number(cell.radiusKm) || 0.5), 0) / existingLeaves.length
    : 5;
  const newRadiusLimit = Math.max(2.5, Math.min(8, averageRadius * 1.2));
  const inferredFront = inferTacticalFrontGeometry(previousSector);
  const frontOrigin = tacticalCoordinates(previousSector.frontOrigin) || inferredFront?.frontOrigin;
  const frontBearing = Number.isFinite(Number(previousSector.frontBearing))
    ? Number(previousSector.frontBearing)
    : Number(candidateSector.frontBearing);
  const frontWidthKm = Math.max(2, Number(previousSector.frontWidthKm)
    || Number(candidateSector.frontWidthKm)
    || inferredFront?.frontWidthKm
    || averageRadius * 2.4);
  const previousDepthKm = Math.max(frontWidthKm, Number(previousSector.advanceDepthKm)
    || Math.max(0, ...previousCells.map((cell) => {
      const projection = frontOrigin && Number.isFinite(frontBearing)
        ? tacticalProjectPoint(frontOrigin, cell, frontBearing)
        : null;
      return projection ? projection.forwardKm + radius(cell) : 0;
    })));
  let newCellCount = 0;

  for (const requested of candidateCells) {
    if (!requested?.id || explicitlyRemoved.has(String(requested.id)) || admittedIds.has(String(requested.id))) continue;
    const previous = previousById.get(String(requested.id));
    // Models occasionally reuse the old cell id while moving its coordinates
    // forward. Treat that as a new captured piece instead of silently snapping
    // it back to the old location forever. Existing cells remain immutable; the
    // moved copy receives a stable coordinate-derived id and is then subject to
    // the same continuity/advance bounds as any other new cell.
    const movedExistingCell = previous
      && !previous.parentCellId
      && tacticalDistanceKm(previous, requested) > Math.max(2.5, radius(previous) * 0.75);
    const admissionId = movedExistingCell
      ? `${requested.id}-advance-${Math.round(Number(requested.center?.lng ?? 0) * 1000)}-${Math.round(Number(requested.center?.lat ?? 0) * 1000)}`
      : requested.id;
    const admissionRadius = Math.min(newRadiusLimit, Math.max(2.5, Number(requested.radiusKm) || newRadiusLimit));
    const admissionCandidate = { ...requested, id: admissionId, radiusKm: admissionRadius };
    const reachesOldFront = existingLeaves.some((oldCell) => (
      tacticalDistanceKm(oldCell, admissionCandidate)
        <= maxAdvanceKm + radius(oldCell) + radius(admissionCandidate)
    ));
    const projection = frontOrigin && Number.isFinite(frontBearing)
      ? tacticalProjectPoint(frontOrigin, admissionCandidate, frontBearing)
      : null;
    const staysInsideFront = !projection || (
      projection.forwardKm >= -radius(admissionCandidate) * 0.25
      && projection.forwardKm <= previousDepthKm + maxAdvanceKm + radius(admissionCandidate)
      && Math.abs(projection.rightKm) <= frontWidthKm / 2 + radius(admissionCandidate) * 0.65
    );
    const canAdmitMovedExisting = movedExistingCell
      && newCellCount < maxNewCells
      && reachesOldFront
      && staysInsideFront;
    if (previous && !canAdmitMovedExisting) {
      const control = clampControlChange(previous.control, requested.control, maxControlDelta);
      const contestedBy = control < 75
        ? requested.contestedBy ?? previous.contestedBy ?? candidateSector.contestedBy
        : requested.contestedBy;
      admitted.push({
        ...requested,
        id: previous.id,
        center: previous.center,
        radiusKm: previous.radiusKm,
        depth: previous.depth,
        ...(previous.parentCellId ? { parentCellId: previous.parentCellId } : { parentCellId: undefined }),
        control,
        ...(contestedBy ? { contestedBy } : { contestedBy: undefined }),
        status: control < 75
          ? requested.status === "assault" ? "assault" : "contested"
          : requested.status,
      });
      admittedIds.add(String(previous.id));
      continue;
    }
    if (newCellCount >= maxNewCells) continue;
    const bounded = {
      ...requested,
      id: admissionId,
      radiusKm: admissionRadius,
      control: Math.min(35, Math.max(5, Math.round(Number(requested.control) || 20))),
      ...(requested.contestedBy ?? candidateSector.contestedBy
        ? { contestedBy: requested.contestedBy ?? candidateSector.contestedBy }
        : {}),
      status: "assault",
    };
    if (!reachesOldFront) continue;
    if (!staysInsideFront) continue;
    admitted.push(bounded);
    admittedIds.add(String(bounded.id));
    newCellCount += 1;
  }

  for (const previous of previousCells) {
    if (explicitlyRemoved.has(String(previous.id)) || admittedIds.has(String(previous.id))) continue;
    admitted.push(previous);
    admittedIds.add(String(previous.id));
  }
  if (!admitted.length) return candidateSector;
  const leaves = tacticalLeafCells({ cells: admitted });
  const weighted = leaves.map((cell) => ({ cell, weight: Math.max(0.25, radius(cell) ** 2) }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const center = totalWeight > 0 ? {
    lng: weighted.reduce((sum, entry) => sum + Number(entry.cell.center?.lng) * entry.weight, 0) / totalWeight,
    lat: weighted.reduce((sum, entry) => sum + Number(entry.cell.center?.lat) * entry.weight, 0) / totalWeight,
  } : previousSector.center;
  const advanceDepthKm = frontOrigin && Number.isFinite(frontBearing)
    ? Math.max(previousDepthKm, ...leaves.map((cell) => {
      const projection = tacticalProjectPoint(frontOrigin, cell, frontBearing);
      return projection ? projection.forwardKm + radius(cell) * 1.05 : 0;
    }))
    : Number(previousSector.advanceDepthKm ?? candidateSector.advanceDepthKm);
  return {
    ...candidateSector,
    id: previousSector.id,
    name: previousSector.name,
    ownerCode: previousSector.ownerCode,
    battleId: previousSector.battleId || candidateSector.battleId,
    startedAt: previousSector.startedAt || candidateSector.startedAt,
    frontOrigin: previousSector.frontOrigin ?? candidateSector.frontOrigin ?? inferredFront?.frontOrigin,
    frontBearing: previousSector.frontBearing ?? candidateSector.frontBearing,
    frontWidthKm,
    advanceDepthKm: Number.isFinite(advanceDepthKm) ? Math.round(advanceDepthKm * 10) / 10 : undefined,
    center,
    cells: admitted,
  };
};

export const tacticalGeometrySpanKm = (geometry) => {
  const coordinates = geometryRings(geometry).flat();
  const usable = coordinates
    .map(([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) }))
    .filter(({ lng, lat }) => Number.isFinite(lng) && Number.isFinite(lat));
  if (!usable.length) return 0;
  const lngs = usable.map(({ lng }) => lng);
  const lats = usable.map(({ lat }) => lat);
  return tacticalDistanceKm(
    { lng: Math.min(...lngs), lat: Math.min(...lats) },
    { lng: Math.max(...lngs), lat: Math.max(...lats) },
  );
};

export const tacticalFrontSpanKm = (cells) => {
  const usable = (cells || []).filter((cell) => tacticalCoordinates(cell));
  let span = 0;
  for (let left = 0; left < usable.length; left += 1) {
    for (let right = left + 1; right < usable.length; right += 1) {
      span = Math.max(span, tacticalDistanceKm(usable[left], usable[right]));
    }
  }
  return span;
};

export const tacticalRegionCoverageGate = (sector, regionGeometry) => {
  const leaves = tacticalLeafCells(sector);
  const regionSpanKm = tacticalGeometrySpanKm(regionGeometry);
  const frontSpanKm = tacticalFrontSpanKm(leaves);
  const averageRadiusKm = leaves.length
    ? leaves.reduce((sum, cell) => sum + radius(cell), 0) / leaves.length
    : 0;
  const requiredSpanKm = Math.min(120, Math.max(12, regionSpanKm * 0.22));
  const requiredCells = Math.min(9, Math.max(3, Math.ceil(requiredSpanKm / Math.max(5, averageRadiusKm * 2))));
  const securedCells = leaves.filter((cell) => Number(cell.control) >= 75 && cell.status === "held").length;
  const requiredSecuredCells = Math.max(2, Math.ceil(leaves.length * 0.7));
  return {
    secured: Boolean(regionSpanKm)
      && Number(sector?.control) >= 85
      && sector?.status === "held"
      && leaves.length >= requiredCells
      && securedCells >= requiredSecuredCells
      && frontSpanKm + averageRadiusKm * 2 >= requiredSpanKm,
    cellCount: leaves.length,
    securedCells,
    requiredCells,
    requiredSecuredCells,
    frontSpanKm,
    requiredSpanKm,
    regionSpanKm,
  };
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

// When a partial GM request is converted from a region transfer, the model may
// return the same region again without supplying a new cell coordinate. Give
// the persistent front one deterministic next step instead of replaying the
// original entry strip forever.
export const deriveNextTacticalCell = (sector, regionGeometry, { id } = {}) => {
  const leaves = tacticalLeafCells(sector).filter((cell) => tacticalCoordinates(cell));
  if (!leaves.length) return null;
  const inferred = inferTacticalFrontGeometry(sector);
  const frontOrigin = tacticalCoordinates(sector?.frontOrigin) || inferred?.frontOrigin;
  const frontBearing = Number.isFinite(Number(sector?.frontBearing))
    ? Number(sector.frontBearing)
    : inferred?.frontBearing;
  if (!frontOrigin || !Number.isFinite(frontBearing)) return null;

  const projections = leaves
    .map((cell) => tacticalProjectPoint(frontOrigin, cell, frontBearing))
    .filter(Boolean);
  if (!projections.length) return null;
  const frontMostKm = Math.max(...projections.map((entry) => entry.forwardKm));
  const averageRadiusKm = leaves.reduce((sum, cell) => sum + radius(cell), 0) / leaves.length;
  const stepKm = Math.max(3, Math.min(10, averageRadiusKm * 1.35));
  const candidate = tacticalOffsetPoint(frontOrigin, frontBearing, frontMostKm + stepKm);
  if (!candidate || (regionGeometry && !tacticalGeometryContainsPoint(regionGeometry, candidate))) return null;
  if (leaves.some((cell) => tacticalDistanceKm(cell, candidate) < Math.max(2, averageRadiusKm * 0.55))) return null;

  return {
    id: id || `${sector.id || "sector"}-advance-${leaves.length + 1}`,
    depth: 1,
    ownerCode: sector.ownerCode,
    ...(sector.contestedBy ? { contestedBy: sector.contestedBy } : {}),
    control: Math.max(5, Math.min(35, Math.round(Number(sector.control) || 20))),
    center: { lng: candidate.lng, lat: candidate.lat },
    radiusKm: Math.max(2.5, Math.min(8, averageRadiusKm)),
    status: "assault",
    ...(sector.note ? { note: sector.note } : {}),
  };
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
