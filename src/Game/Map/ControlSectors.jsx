/*! Open Historia — tactical control sectors and prolonged battle overlay © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Marker, Source, Layer, Popup, useMap } from "react-map-gl/maplibre";
import polygonClipping from "polygon-clipping";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import { controlSliceRing, smoothClosedRing, tacticalAreaPolygon } from "./controlGeometry.js";
import {
  buildCombatBand,
  buildEngagementRail,
  buildEngagementRailTeeth,
  buildOperationalEnvelope,
  buildOperationalRoute,
  buildParallelFrontLine,
} from "./frontGeometry.js";
import { clipRingToRegion, useRegionClipGeometry } from "./useRegionClipGeometry.js";
import { dismissRegionPopup } from "../Selection/Regions.jsx";
import { tacticalConnectedComponents } from "../AI/sectorContinuity.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
const TACTICAL_PALETTE = [
  "#ef9f45", "#e76f51", "#d95d8a", "#8c7ae6",
  "#4ea8de", "#2a9d8f", "#8ab17d", "#c9a227",
];

const hashString = (value) => {
  let hash = 0;
  for (const character of String(value ?? "")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
};

const colorForOwner = (ownerCode, colorMap) => {
  const rgb = colorMap[String(ownerCode ?? "").trim()];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  return TACTICAL_PALETTE[hashString(ownerCode) % TACTICAL_PALETTE.length];
};

const leafCells = (cells) => {
  const parentIds = new Set(cells.map((cell) => cell.parentCellId).filter(Boolean));
  return cells.filter((cell) => !parentIds.has(cell.id));
};

const cellGeometry = (cell, sector) => {
  const center = cell?.center && typeof cell.center === "object" ? cell.center : cell;
  const lng = Number(center?.lng);
  const lat = Number(center?.lat);
  const radiusKm = Number(cell?.radiusKm ?? sector.radiusKm);
  return Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(radiusKm)
    ? { lng, lat, radiusKm }
    : null;
};

const cellControl = (cell, sector) => Number.isFinite(Number(cell.control))
  ? Math.max(0, Math.min(100, Number(cell.control)))
  : Math.max(0, Math.min(100, Number(sector.control) || 0));

const isContested = (cell, sector) => Boolean(cell?.contestedBy || sector.contestedBy)
  || ["assault", "contested", "encircled"].includes(cell?.status || sector.status);

const controlTint = (control) => {
  const value = Math.max(0, Math.min(100, Number(control) || 0));
  if (value >= 68) return "#78b88d";
  if (value >= 50) return "#c5a165";
  return "#cf716d";
};

const clippedMultiPolygon = (clipped) => ({
  type: "MultiPolygon",
  coordinates: clipped,
});

const offsetCoordinate = (center, distanceKm, bearingDeg) => {
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const bearing = (Number(bearingDeg) * Math.PI) / 180;
  const latOffset = (Math.cos(bearing) * distanceKm) / 111.32;
  const cosLat = Math.max(0.08, Math.cos((lat * Math.PI) / 180));
  const lngOffset = (Math.sin(bearing) * distanceKm) / (111.32 * cosLat);
  return [lng + lngOffset, lat + latOffset];
};

const displayGroupKey = (sector) => [sector?.regionId, sector?.ownerCode, sector?.name]
  .map((value) => String(value ?? "").trim().toLocaleLowerCase())
  .join("|");

// Models occasionally create five new ids for one named advance. Preserve
// distinct named fronts, but present exact duplicates as one front and discard
// detached components from that presentation.  This is deliberately visual:
// historical saves and cell references are not silently rewritten here.
const prepareDisplaySectors = (sectors) => {
  const groups = new Map();
  for (const sector of sectors) {
    const key = displayGroupKey(sector);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sector);
  }
  return Array.from(groups.values()).map((group) => {
    if (group.length === 1) return group[0];
    const entries = group.flatMap((sector) => {
      const allCells = Array.isArray(sector.cells) && sector.cells.length > 0
        ? sector.cells
        : [{ ...sector, id: `${sector.id}-cell-legacy`, name: sector.name }];
      return leafCells(allCells).map((cell) => {
        const geometry = cellGeometry(cell, sector);
        return geometry ? { cell, sector, center: { lng: geometry.lng, lat: geometry.lat }, radiusKm: geometry.radiusKm } : null;
      }).filter(Boolean);
    });
    const connected = tacticalConnectedComponents(entries)[0] || [];
    if (!connected.length) return group[0];
    const weight = connected.reduce((sum, entry) => sum + Math.max(0.25, entry.radiusKm ** 2), 0);
    const average = (key) => connected.reduce((sum, entry) => sum + entry.center[key] * Math.max(0.25, entry.radiusKm ** 2), 0) / weight;
    return {
      ...group[0],
      cells: connected.map((entry) => entry.cell),
      center: { lng: average("lng"), lat: average("lat") },
      control: Math.round(connected.reduce((sum, entry) => (
        sum + cellControl(entry.cell, entry.sector) * Math.max(0.25, entry.radiusKm ** 2)
      ), 0) / weight),
      note: group.map((sector) => sector.note).filter(Boolean).at(-1) || group[0].note,
    };
  });
};

// Follow the real gradient when the AI supplied several cells (the side with
// greater control is the secured rear; the cut advances toward lower-control
// cells). A stable id-derived bearing keeps single-cell/flat sectors from
// changing shape between renders.
const sectorBearing = (sector, cells) => {
  if (Number.isFinite(Number(sector.frontBearing))) return Number(sector.frontBearing);
  const usable = cells.map((cell) => ({ cell, geometry: cellGeometry(cell, sector), control: cellControl(cell, sector) }))
    .filter((entry) => entry.geometry);
  if (usable.length > 1) {
    const average = usable.reduce((sum, entry) => sum + entry.control, 0) / usable.length;
    const cosLat = Math.max(0.08, Math.cos((Number(sector.center?.lat) * Math.PI) / 180));
    let east = 0;
    let north = 0;
    for (const entry of usable) {
      const weight = entry.control - average;
      east += (entry.geometry.lng - Number(sector.center?.lng)) * cosLat * weight;
      north += (entry.geometry.lat - Number(sector.center?.lat)) * weight;
    }
    if (Math.hypot(east, north) > 1e-7) return (Math.atan2(east, north) * 180) / Math.PI;
  }
  return hashString(sector.id) % 360;
};

const unionPolygons = (polygons) => {
  if (!polygons.length) return [];
  try {
    return polygons.length === 1 ? polygons[0] : polygonClipping.union(...polygons);
  } catch {
    return polygons.flat();
  }
};

// Extract only the outward-facing part of the occupied footprint. Drawing the
// full union outline makes every rear edge look like a second front; drawing
// cell centres makes the line float through controlled ground. The leading
// ring segments are the actual territorial contact edge.
const buildFootprintFrontLines = (multiPolygon, origin, bearing) => {
  if (!multiPolygon?.length || !origin) return [];
  const rings = multiPolygon.flatMap((polygon) => (polygon || []).slice(0, 1));
  const entries = rings.flatMap((ring) => ring.slice(0, -1).map((point, index) => {
    const next = ring[(index + 1) % (ring.length - 1)];
    const midpoint = {
      lng: (point[0] + next[0]) / 2,
      lat: (point[1] + next[1]) / 2,
    };
    const projection = localProjection(midpoint, origin, bearing);
    return projection ? { ring, index, point, next, projection } : null;
  }).filter(Boolean));
  if (!entries.length) return [];
  const maxForward = Math.max(...entries.map((entry) => entry.projection.forward));
  const minForward = Math.min(...entries.map((entry) => entry.projection.forward));
  // Only the leading edge is the active contact. A broad threshold included
  // the two side shoulders of the footprint and rendered a U-shaped outline
  // instead of a front line.
  const threshold = maxForward - Math.max(2.5, (maxForward - minForward) * 0.14);
  const lines = [];
  for (const ring of rings) {
    let current = [];
    for (let index = 0; index < ring.length - 1; index += 1) {
      const point = ring[index];
      const next = ring[index + 1];
      const midpoint = { lng: (point[0] + next[0]) / 2, lat: (point[1] + next[1]) / 2 };
      const projection = localProjection(midpoint, origin, bearing);
      if (projection && projection.forward >= threshold) {
        if (!current.length) current.push(point);
        current.push(next);
      } else if (current.length > 1) {
        lines.push(current);
        current = [];
      }
    }
    if (current.length > 1) lines.push(current);
  }
  return lines.filter((line) => line.length > 1);
};

const multilineFromMultiPolygon = (multiPolygon) => multiPolygon
  .flatMap((polygon) => polygon.map((ring) => smoothClosedRing(ring, 0.12)));

const localProjection = (center, origin, bearingDeg) => {
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  const originLat = Number(origin?.lat);
  const originLng = Number(origin?.lng);
  if (![lat, lng, originLat, originLng].every(Number.isFinite)) return null;
  const cosLat = Math.max(0.08, Math.cos((originLat * Math.PI) / 180));
  const east = (lng - originLng) * 111.32 * cosLat;
  const north = (lat - originLat) * 111.32;
  const bearing = (Number(bearingDeg) * Math.PI) / 180;
  return {
    forward: east * Math.sin(bearing) + north * Math.cos(bearing),
    lateral: east * Math.cos(bearing) - north * Math.sin(bearing),
  };
};

// Tactical cells are often village-sized and therefore do not overlap even
// when the simulation considers them one connected advance.  A narrow
// corridor between neighbouring cells makes the occupied ground read as a
// continuous theatre instead of a row of translucent bubbles.  The corridor
// is only a visual footprint; the authoritative capture still lives in the
// individual cell/region state.
const bearingBetween = (left, right) => {
  const lat = (Number(left?.lat) + Number(right?.lat)) / 2;
  const east = (Number(right?.lng) - Number(left?.lng)) * 111.32
    * Math.max(0.08, Math.cos((lat * Math.PI) / 180));
  const north = (Number(right?.lat) - Number(left?.lat)) * 111.32;
  return (Math.atan2(east, north) * 180) / Math.PI;
};

const corridorRing = (left, right, halfWidthKm, paddingKm) => {
  const bearing = bearingBetween(left, right);
  const start = offsetCoordinate(left, -paddingKm, bearing);
  const end = offsetCoordinate(right, paddingKm, bearing);
  const leftStart = start && offsetCoordinate({ lng: start[0], lat: start[1] }, halfWidthKm, bearing + 90);
  const rightStart = start && offsetCoordinate({ lng: start[0], lat: start[1] }, halfWidthKm, bearing - 90);
  const leftEnd = end && offsetCoordinate({ lng: end[0], lat: end[1] }, halfWidthKm, bearing + 90);
  const rightEnd = end && offsetCoordinate({ lng: end[0], lat: end[1] }, halfWidthKm, bearing - 90);
  return leftStart && rightStart && leftEnd && rightEnd
    ? [leftStart, leftEnd, rightEnd, rightStart, leftStart]
    : null;
};

const buildCellCorridors = (cells, sector) => {
  const origin = sector.frontOrigin || sector.center || cells[0]?.center || cells[0];
  const entries = cells.map((cell) => {
    const geometry = cellGeometry(cell, sector);
    const projection = geometry && origin ? localProjection(geometry, origin, sectorBearing(sector, cells)) : null;
    return geometry && projection ? { cell, geometry, projection } : null;
  }).filter(Boolean).sort((left, right) => left.projection.lateral - right.projection.lateral);
  const corridors = [];
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    const distance = distanceKmBetween(
      [previous.geometry.lng, previous.geometry.lat],
      [current.geometry.lng, current.geometry.lat],
    );
    const maxGap = Math.max(24, (previous.geometry.radiusKm + current.geometry.radiusKm) * 2.8);
    if (distance > maxGap) continue;
    const controlFactor = Math.max(
      0.45,
      Math.min(1, Math.min(cellControl(previous.cell, sector), cellControl(current.cell, sector)) / 100),
    );
    const halfWidth = Math.max(
      2.8,
      Math.min(8.5, Math.min(previous.geometry.radiusKm, current.geometry.radiusKm) * (0.48 + controlFactor * 0.28)),
    );
    const padding = Math.max(2.5, Math.min(8, Math.min(previous.geometry.radiusKm, current.geometry.radiusKm) * 0.75));
    const ring = corridorRing(previous.geometry, current.geometry, halfWidth, padding);
    if (ring) corridors.push(ring);
  }
  return corridors;
};

// Turn the simulation's connected advance into one military-map contact line.
// Cells describe the occupied corridor and can be staggered diagonally (a
// village-by-village advance), so joining every cell centre creates a false
// zig-zag through the rear. The contact is the outer envelope of that whole
// corridor: one jagged line at its most advanced depth, across its frontage.
const buildContinuousFrontLines = (lineCells, sector, bearing) => {
  const origin = sector.frontOrigin || sector.center || lineCells[0]?.center || lineCells[0];
  const entries = lineCells.map((cell) => {
    const geometry = cellGeometry(cell, sector);
    const projection = geometry ? localProjection(geometry, origin, bearing) : null;
    if (!geometry || !projection) return null;
    return {
      geometry,
      projection,
    };
  }).filter(Boolean);
  if (!entries.length) return [];

  const leadingDepth = Math.max(...entries.map((entry) => (
    // Keep the contact on the visible edge of the leading occupied cell. A
    // larger synthetic inset makes the front appear to have moved beyond its
    // own unit counter.
    entry.projection.forward + entry.geometry.radiusKm * 0.92
  )));
  // Only cells that actually reach the leading edge belong to this frontage.
  // Including the whole depth corridor stretched the line far outside the
  // occupied patch, especially when villages were listed along an advance
  // axis rather than as a parallel battle line.
  const frontageDepth = Math.max(
    4,
    Math.max(...entries.map((entry) => entry.geometry.radiusKm)) * 0.8,
  );
  const frontageEntries = entries.filter((entry) => (
    entry.projection.forward + entry.geometry.radiusKm * 1.08
      >= leadingDepth - frontageDepth
  ));
  const minLateral = Math.min(...frontageEntries.map((entry) => (
    entry.projection.lateral - entry.geometry.radiusKm * 0.7
  )));
  const maxLateral = Math.max(...frontageEntries.map((entry) => (
    entry.projection.lateral + entry.geometry.radiusKm * 0.7
  )));
  // Do not invent a theatre-wide frontage for a single narrow contact. The
  // minimum used to be 12 km, which pushed the red line well outside the
  // occupied cell and made one flank look like it had detached and moved
  // away. Let the cell radius define the minimum readable combat width.
  const declaredFrontage = Number(sector.frontWidthKm);
  const frontageCenter = (minLateral + maxLateral) / 2;
  const occupiedSpan = Math.max(0, maxLateral - minLateral);
  const targetSpan = Number.isFinite(declaredFrontage)
    ? Math.max(occupiedSpan, declaredFrontage)
    : occupiedSpan;
  const span = Math.max(
    6,
    Math.min(14, occupiedSpan * 1.35 || 6, targetSpan),
  );
  const pointCount = Math.max(4, Math.min(10, Math.ceil(span / 4)));
  // Keep the line visibly irregular, but do not let one random sample drag a
  // flank kilometres forward and make it look detached from the footprint.
  const wobble = Math.min(1.1, Math.max(0.45, span * 0.035));
  const line = [];
  for (let index = 0; index <= pointCount; index += 1) {
    const ratio = index / pointCount;
    const lateral = frontageCenter - span / 2 + span * ratio;
    const seed = hashString(`${sector.id}:contact:${index}`);
    const forward = leadingDepth + ((seed % 5) - 2) * wobble * 0.26;
    const base = offsetCoordinate(origin, forward, bearing);
    const point = base && offsetCoordinate(
      { lng: base[0], lat: base[1] },
      lateral,
      bearing + 90,
    );
    if (point) line.push(point);
  }
  return line.length > 1 ? [line] : [];
};

const distanceKmBetween = (left, right) => {
  const lat = (Number(left?.[1]) + Number(right?.[1])) / 2;
  const east = (Number(right?.[0]) - Number(left?.[0])) * 111.32 * Math.max(0.08, Math.cos((lat * Math.PI) / 180));
  const north = (Number(right?.[1]) - Number(left?.[1])) * 111.32;
  return Math.hypot(east, north);
};

// A theatre may contain several clipped polygons when village cells are close
// but not mathematically overlapping. Keep those pieces as one frontage: order
// them across the line and bridge their nearest endpoints instead of exposing
// a series of unrelated islands to the player.
const connectFrontLineSegments = (lines, origin, bearing) => {
  if (lines.length <= 1 || !origin) return lines;
  const oriented = lines.map((line) => {
    const first = localProjection({ lng: line[0][0], lat: line[0][1] }, origin, bearing);
    const last = localProjection({ lng: line.at(-1)[0], lat: line.at(-1)[1] }, origin, bearing);
    return first && last && first.lateral <= last.lateral ? line : [...line].reverse();
  }).sort((left, right) => {
    const leftProjection = localProjection({ lng: left[0][0], lat: left[0][1] }, origin, bearing);
    const rightProjection = localProjection({ lng: right[0][0], lat: right[0][1] }, origin, bearing);
    return (leftProjection?.lateral ?? 0) - (rightProjection?.lateral ?? 0);
  });
  const connected = [...oriented[0]];
  for (const line of oriented.slice(1)) {
    const previous = connected.at(-1);
    const next = line[0];
    if (previous && next && distanceKmBetween(previous, next) > 0.2) {
      const midpoint = {
        lng: (previous[0] + next[0]) / 2,
        lat: (previous[1] + next[1]) / 2,
      };
      const projection = localProjection(midpoint, origin, bearing);
      const wobble = projection
        ? offsetCoordinate(midpoint, Math.min(4.5, Math.max(1.5, distanceKmBetween(previous, next) * 0.08)), bearing)
        : null;
      if (wobble) connected.push(wobble);
      connected.push(next);
    }
    connected.push(...line.slice(1));
  }
  return [connected];
};

// HOI4-style teeth make the contact line read as a front, not as a selection
// outline. They point into the opposing side along the sector's attack axis.
const buildFrontTeeth = (lines, bearing) => lines.flatMap((line) => {
  const teeth = [];
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    const length = distanceKmBetween(start, end);
    // A short local sector still needs to read as a contact line at the
    // tactical zoom. One tooth per ten kilometres disappeared on the QA
    // frontage, so keep a compact, regular row of teeth instead.
    const count = Math.max(3, Math.floor(length / 2.6));
    for (let toothIndex = 1; toothIndex <= count; toothIndex += 1) {
      const ratio = toothIndex / (count + 1);
      const point = {
        lng: start[0] + (end[0] - start[0]) * ratio,
        lat: start[1] + (end[1] - start[1]) * ratio,
      };
      const tip = offsetCoordinate(point, Math.min(1.8, Math.max(1.05, length / 8)), bearing);
      if (tip) teeth.push([ [point.lng, point.lat], tip ]);
    }
  }
  return teeth;
});

// Reuse the loaded region geometry for the contact segment itself. A synthetic
// perpendicular dash marks the entry axis, but the actual boundary is what
// makes a theatre map legible at a glance. Walk a short distance on both sides
// of the nearest boundary vertex so the contact line follows the real country
// or administrative border instead of floating across the cell.
const buildBoundaryContactLine = (origin, regionClip, widthKm) => {
  if (!origin || !regionClip?.length) return null;
  const originLng = Number(origin.lng);
  const originLat = Number(origin.lat);
  const cosLat = Math.max(0.08, Math.cos((originLat * Math.PI) / 180));
  let best = null;
  for (const polygon of regionClip) {
    for (const ring of polygon || []) {
      const source = ring.slice(0, -1);
      for (let index = 0; index < source.length; index += 1) {
        const start = source[index];
        const end = source[(index + 1) % source.length];
        const ax = (Number(start[0]) - originLng) * 111.32 * cosLat;
        const ay = (Number(start[1]) - originLat) * 111.32;
        const bx = (Number(end[0]) - originLng) * 111.32 * cosLat;
        const by = (Number(end[1]) - originLat) * 111.32;
        const vx = bx - ax;
        const vy = by - ay;
        const lengthSquared = vx * vx + vy * vy;
        const ratio = lengthSquared > 0
          ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / lengthSquared))
          : 0;
        const point = [
          Number(start[0]) + (Number(end[0]) - Number(start[0])) * ratio,
          Number(start[1]) + (Number(end[1]) - Number(start[1])) * ratio,
        ];
        const distance = Math.hypot(ax + vx * ratio, ay + vy * ratio);
        if (!best || distance < best.distance) best = { source, segmentIndex: index, point, distance };
      }
    }
  }
  if (!best || best.distance > Math.max(24, Math.min(45, widthKm * 0.6))) return null;
  const { source } = best;
  if (source.length < 3) return null;
  const halfWidth = Math.max(4, Math.min(32, widthKm * 0.5));
  const walk = (step) => {
    const points = [];
    let index = step > 0
      ? (best.segmentIndex + 1) % source.length
      : best.segmentIndex;
    let previous = best.point;
    let travelled = 0;
    for (let count = 0; count < 8 && travelled < halfWidth; count += 1) {
      const point = source[index];
      travelled += distanceKmBetween(previous, point);
      points.push(point);
      previous = point;
      index = (index + step + source.length) % source.length;
    }
    return points;
  };
  const previous = walk(-1).reverse();
  const next = walk(1);
  return [...previous, best.point, ...next];
};

// An operational arrow must join occupied ground to the leading contact. The
// border entry is useful for a quiet bridgehead, but using it as the arrow's
// start made a long cyan ray cross empty territory whenever the front had
// already moved several cells forward.
const attackAxisEndpoints = (sector, cells, bearing) => {
  const usable = cells
    .map((cell) => {
      const geometry = cellGeometry(cell, sector);
      const origin = sector.frontOrigin || sector.center || geometry;
      const projection = geometry && origin ? localProjection(geometry, origin, bearing) : null;
      return geometry && projection ? { geometry, projection } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.projection.forward - right.projection.forward);
  if (!usable.length) return null;

  const rear = usable[0];
  const lead = usable.at(-1);
  const rearInset = Math.min(2.2, Math.max(0.65, rear.geometry.radiusKm * (usable.length === 1 ? 0.58 : 0.24)));
  const leadInset = Math.min(3.2, Math.max(1.1, lead.geometry.radiusKm * (usable.length === 1 ? 0.72 : 0.62)));
  const start = offsetCoordinate(rear.geometry, rearInset, bearing);
  const tip = offsetCoordinate(lead.geometry, leadInset, bearing);
  return start && tip ? { start, tip } : null;
};

const interpolateLinePoint = (start, end, ratio) => {
  if (!start || !end) return null;
  return [
    start[0] + (end[0] - start[0]) * ratio,
    start[1] + (end[1] - start[1]) * ratio,
  ];
};

const numericUnitPoint = (unit) => {
  const lng = Number(unit?.lng);
  const lat = Number(unit?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
};

const buildArrowFromEndpoints = (start, tip, frontWidthKm = 24) => {
  if (!start || !tip) return null;
  const wing = Math.max(1.5, Math.min(8, Number(frontWidthKm || 24) * 0.13));
  const shaftHalfWidth = Math.max(1.25, Math.min(4.5, Number(frontWidthKm || 24) * 0.045));
  const bearing = bearingBetween(
    { lng: start[0], lat: start[1] },
    { lng: tip[0], lat: tip[1] },
  );
  const left = offsetCoordinate({ lng: tip[0], lat: tip[1] }, wing, bearing + 150);
  const right = offsetCoordinate({ lng: tip[0], lat: tip[1] }, wing, bearing + 210);
  const leftStart = offsetCoordinate({ lng: start[0], lat: start[1] }, shaftHalfWidth, bearing + 90);
  const rightStart = offsetCoordinate({ lng: start[0], lat: start[1] }, shaftHalfWidth, bearing - 90);
  const headBase = interpolateLinePoint(start, tip, 0.68);
  const leftHead = headBase && offsetCoordinate({ lng: headBase[0], lat: headBase[1] }, shaftHalfWidth, bearing + 90);
  const rightHead = headBase && offsetCoordinate({ lng: headBase[0], lat: headBase[1] }, shaftHalfWidth, bearing - 90);
  return left && right && leftStart && rightStart && leftHead && rightHead
    ? {
        line: [[start, tip], [left, tip, right]],
        body: [[leftStart, leftHead, tip, rightHead, rightStart, leftStart]],
      }
    : null;
};

const buildAttackArrow = (sector, cells, bearing) => {
  if (!isContested(null, sector)) return null;
  const endpoints = attackAxisEndpoints(sector, cells, bearing);
  if (!endpoints) return null;
  return buildArrowFromEndpoints(endpoints.start, endpoints.tip, sector.frontWidthKm)?.line || null;
};

const buildAttackArrowPolygon = (sector, cells, bearing) => {
  if (!isContested(null, sector)) return null;
  const endpoints = attackAxisEndpoints(sector, cells, bearing);
  if (!endpoints) return null;
  return buildArrowFromEndpoints(endpoints.start, endpoints.tip, sector.frontWidthKm)?.body || null;
};

// Army orders are anchored to the unit counter. If a formation is already at
// the leading cell, its order is a short push across the contact; it must not
// become another long ray from the border origin.
const buildUnitAttackArrow = (sector, unit, bearing) => {
  const point = numericUnitPoint(unit);
  if (!point || !isContested(null, sector)) return null;
  const length = Math.max(1.8, Math.min(3.4, Number(sector.advanceDepthKm) * 0.1 || 2.8));
  const start = offsetCoordinate(point, 0.8, bearing);
  const tip = offsetCoordinate(point, length, bearing);
  return start && tip ? buildArrowFromEndpoints(start, tip, sector.frontWidthKm) : null;
};

// A defending formation is also an order on the map: its short vector points
// back toward the contact instead of leaving the enemy side as an unexplained
// counter. Keep it deliberately shorter than the assault axis so the two
// directions read as local orders, not as disconnected strategic rays.
const buildUnitDefenseArrow = (sector, unit, bearing) => {
  const point = numericUnitPoint(unit);
  if (!point || !isContested(null, sector)) return null;
  const length = Math.max(1.6, Math.min(3, Number(sector.advanceDepthKm) * 0.08 || 2.4));
  const defensiveBearing = bearing + 180;
  const start = offsetCoordinate(point, 0.65, defensiveBearing);
  const tip = offsetCoordinate(point, length, defensiveBearing);
  return start && tip ? buildArrowFromEndpoints(start, tip, sector.frontWidthKm) : null;
};

// Keep the rendered contact line attached to the engine-derived border entry.
// Without this bridge a narrow cell frontier can look like a floating marker
// somewhere inside the country, even though the simulation has a real border
// origin and a connected advance behind it.
const buildFrontBridge = (sector, lines, bearing, regionClip) => {
  const origin = sector.frontOrigin;
  const originPoint = origin && offsetCoordinate(origin, 0, bearing);
  if (!originPoint || !lines.length) return null;
  const halfWidth = Math.max(
    2.5,
    Math.min(30, (Number(sector.frontWidthKm) || Number(sector.radiusKm) * 2.4 || 8) * 0.5),
  );
  const leftOrigin = offsetCoordinate(origin, halfWidth, bearing + 90);
  const rightOrigin = offsetCoordinate(origin, halfWidth, bearing - 90);
  if (!leftOrigin || !rightOrigin) return null;
  const boundaryLine = buildBoundaryContactLine(origin, regionClip, halfWidth * 2);
  const bridgePolygons = [];
  const approachLines = [];
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const ring = [leftOrigin, ...line, rightOrigin, leftOrigin];
    const clipped = regionClip?.length ? clipRingToRegion(ring, regionClip) : [[ring]];
    if (clipped.length) bridgePolygons.push(...clipped.map((polygon) => [polygon]));
    const middle = line[Math.floor(line.length / 2)];
    if (middle) approachLines.push([originPoint, middle]);
  }
  return bridgePolygons.length || approachLines.length
    ? { originPoint, bridgePolygons, approachLines, entryLine: [leftOrigin, rightOrigin], boundaryLine }
    : null;
};

const buildData = (sectors, colorMap, regionClips, units = []) => {
  const fills = [];
  const cellTerritories = [];
  const cellControlFills = [];
  const cellOutlines = [];
  const fronts = [];
  const frontLines = [];
  const frontTeeth = [];
  const engagementTeeth = [];
  const frontFlanks = [];
  const engagementRails = [];
  const cellBoundaries = [];
  const combatBands = [];
  const echelonLines = [];
  const bridgeheadFills = [];
  const frontApproaches = [];
  const frontOrigins = [];
  const frontEntryLines = [];
  const battlePoints = [];
  const attackArrows = [];
  const attackArrowBodies = [];
  const defenseArrows = [];
  const defenseArrowBodies = [];
  const supportRoutes = [];
  const reserveRoutes = [];
  const supplyNodes = [];
  const operationLabels = [];
  const frontLabels = [];
  const frontPolityLabels = [];

  for (const sector of sectors) {
    if (!sector?.name) continue;
    const allCells = Array.isArray(sector.cells) && sector.cells.length > 0
      ? sector.cells
      : [{ ...sector, id: `${sector.id}-cell-legacy`, name: sector.name }];
    const cells = leafCells(allCells);
    const bearing = sectorBearing(sector, cells);
    const regionClip = regionClips.get(String(sector.regionId ?? ""));
    const fill = colorForOwner(cells[0]?.ownerCode || sector.ownerCode, colorMap);
    const footprintPolygons = [];
    const cellPolygons = [];
    let contested = false;
    let weightedControl = 0;
    let totalWeight = 0;

    for (const [cellIndex, cell] of cells.entries()) {
      const geometry = cellGeometry(cell, sector);
      if (!geometry) continue;
      const control = cellControl(cell, sector);
      const cellIsContested = isContested(cell, sector);
      // The simulation cells are the authoritative occupied ground. Rendering
      // a synthetic arrow here hid their connected footprint behind a narrow
      // teardrop, which made every new advance look like the same artefact.
      // A lightly softened union preserves a territorial patch without
      // exposing a literal board-game grid.
      const displayGeometry = {
        ...geometry,
        radiusKm: geometry.radiusKm * 1.06,
        bearingDeg: bearing,
        ...(cells.length === 1 ? { depthScale: 0.96, frontScale: 1.1 } : {}),
      };
      // Keep the deterministic irregular vertices of the tactical patch. A
      // second smoothing pass turned every village-sized cell into a soft
      // bubble, which reads like a selection radius rather than occupied
      // ground on a military map.
      const fullRing = tacticalAreaPolygon(displayGeometry, cell.id || `${sector.id}-${cellIndex}`);
      const clipped = clipRingToRegion(fullRing, regionClip);
      if (clipped.length) {
        footprintPolygons.push(...clipped.map((polygon) => [polygon]));
        cellPolygons.push({ cell, clipped });
        cellTerritories.push({
          type: "Feature",
          id: `${sector.id}-cell-territory-${cell.id || cellIndex}`,
          geometry: clippedMultiPolygon(clipped),
          properties: {
            fill,
            opacity: cellIsContested ? 0.08 : 0.15,
            control: Math.round(control),
            outline: controlTint(control),
          },
        });
        const controlledRing = controlSliceRing(fullRing, control, bearing + 180, geometry.lat);
        const controlled = controlledRing ? clipRingToRegion(controlledRing, regionClip) : [];
        if (controlled.length) {
          cellControlFills.push({
            type: "Feature",
            id: `${sector.id}-cell-control-${cell.id || cellIndex}`,
            geometry: clippedMultiPolygon(controlled),
            properties: {
              fill: controlTint(control),
              opacity: cellIsContested ? 0.16 : 0.24,
              control: Math.round(control),
            },
          });
        }
        const outlineCoordinates = clipped.flatMap((polygon) => polygon.map((ring) => ring));
        if (outlineCoordinates.length) {
          cellOutlines.push({
            type: "Feature",
            id: `${sector.id}-cell-outline-${cell.id || cellIndex}`,
            geometry: { type: "MultiLineString", coordinates: outlineCoordinates },
            properties: { color: controlTint(control), control: Math.round(control) },
          });
        }
      }
      contested ||= cellIsContested;
      const weight = Math.max(0.25, geometry.radiusKm ** 2);
      weightedControl += control * weight;
      totalWeight += weight;
    }

    // Join adjacent village cells with a thin controlled-ground corridor so
    // the theatre has one readable footprint while its per-cell capture data
    // remains intact.
    for (const corridor of buildCellCorridors(cells, sector)) {
      const clipped = clipRingToRegion(corridor, regionClip);
      if (clipped.length) footprintPolygons.push(...clipped.map((polygon) => [polygon]));
    }

    // A live front is rendered as one tapered operational bridgehead. Keep the
    // cells for battle markers and state inspection, but do not let their round
    // individual fills become the visual shape of the war.
    const operationalEnvelope = contested
      ? buildOperationalEnvelope(cells, sector, bearing)
      : null;
    if (operationalEnvelope) {
      // The envelope is an operational reference for contact/echelons, not the
      // territory itself. Keep the actual cell union as the occupied ground;
      // painting this synthetic ring as the fill made every advance look like
      // one oversized wedge detached from its village-sized cells.
      for (const { cell } of cellPolygons) {
        const cellCenter = cellGeometry(cell, sector);
        const tickHalfWidth = Math.max(1.8, Math.min(4.2, (cellCenter?.radiusKm || 3.4) * 0.74));
        const tickStart = cellCenter && offsetCoordinate(cellCenter, tickHalfWidth, bearing + 90);
        const tickEnd = cellCenter && offsetCoordinate(cellCenter, tickHalfWidth, bearing - 90);
        if (!tickStart || !tickEnd) continue;
        cellBoundaries.push({
          type: "Feature",
          id: `${sector.id}-cell-boundary-${cell.id}`,
          geometry: {
            type: "LineString",
            coordinates: [tickStart, tickEnd],
          },
          properties: {
            color: cellControl(cell, sector) >= 70 ? "#c9e5ff" : "#ffb1a6",
            control: Math.round(cellControl(cell, sector)),
          },
        });
      }
    }

    const footprint = unionPolygons(footprintPolygons);
    const sectorControl = totalWeight > 0 ? weightedControl / totalWeight : Number(sector.control) || 0;
    const frontCells = cells.filter((cell) => isContested(cell, sector));
    const lineCells = frontCells.length > 0
      ? frontCells
      : cells.filter((cell) => cellControl(cell, sector) === Math.min(...cells.map((entry) => cellControl(entry, sector))));
    const cellFrontLines = buildContinuousFrontLines(lineCells, sector, bearing);
    const footprintFrontLines = buildFootprintFrontLines(footprint, sector.frontOrigin || sector.center, bearing);
    const continuousLines = connectFrontLineSegments(
      footprintFrontLines,
      sector.frontOrigin || sector.center,
      bearing,
    );
    // A contested sector already has an authoritative tactical contact: the
    // leading edge of its connected cells. The union outline also contains
    // rear shoulders and side arcs, which made the red front disappear in the
    // middle of a broad advance. Keep that outline for held sectors only.
    const frontGeometryLines = contested
      // The operational envelope supplies one continuous contact edge across
      // the actual frontage. Falling back to cell-derived geometry preserves
      // old saves that do not have enough coordinates for the envelope.
      ? (operationalEnvelope?.contactLine?.length > 1
        ? [operationalEnvelope.contactLine]
        : cellFrontLines)
      : (continuousLines.length ? continuousLines : cellFrontLines);
    const engagementRail = contested
      ? buildEngagementRail(
        frontCells,
        sector.frontOrigin || sector.center,
        bearing,
      )
      : null;
    if (engagementRail) {
      engagementRails.push({
        type: "Feature",
        id: `${sector.id}-engagement-rail`,
        geometry: { type: "LineString", coordinates: engagementRail },
        properties: { color: "#ff7868", sectorName: sector.name },
      });
      const railTeeth = buildEngagementRailTeeth(engagementRail, bearing);
      if (railTeeth.length) {
        engagementTeeth.push({
          type: "Feature",
          id: `${sector.id}-engagement-teeth`,
          geometry: { type: "MultiLineString", coordinates: railTeeth },
          properties: { color: "#ff7868", sectorName: sector.name, kind: "engagement" },
        });
      }
      const engagementBand = buildCombatBand(engagementRail, bearing, 1.25, 0.9);
      if (engagementBand) {
        combatBands.push({
          type: "Feature",
          id: `${sector.id}-engagement-band`,
          geometry: { type: "Polygon", coordinates: [engagementBand] },
          properties: { color: "#c7444e", kind: "engagement" },
        });
      }
    }
    if (contested && frontGeometryLines[0]?.length > 1) {
      const contact = frontGeometryLines[0];
      const combatBand = buildCombatBand(contact, bearing, 2.8, 1.7);
      if (combatBand) {
        combatBands.push({
          type: "Feature",
          id: `${sector.id}-combat-band`,
          geometry: { type: "Polygon", coordinates: [combatBand] },
          properties: { color: "#c7444e", kind: "contact" },
        });
      }
      const friendlyLine = buildParallelFrontLine(contact, -3.6, bearing);
      const enemyLine = buildParallelFrontLine(contact, 2.4, bearing);
      if (friendlyLine.length > 1) {
        echelonLines.push({
          type: "Feature",
          id: `${sector.id}-friendly-echelon`,
          geometry: { type: "LineString", coordinates: friendlyLine },
          properties: { color: "#63c7dc", dash: "friendly" },
        });
      }
      if (enemyLine.length > 1) {
        echelonLines.push({
          type: "Feature",
          id: `${sector.id}-enemy-echelon`,
          geometry: { type: "LineString", coordinates: enemyLine },
          properties: { color: "#ffb19f", dash: "enemy" },
        });
      }
    }
    // The operational envelope still supplies the contact and echelon
    // projection above, but its long side flanks are intentionally not drawn:
    // those administrative diagonals looked like a second front running off
    // into empty territory instead of the boundary of the connected cells.
    // Once contact is active, the cells and their local contact line are the
    // theatre. The old border-to-contact bridge was a second, long blue axis
    // that visually detached the battle from its actual units. Keep it for a
    // quiet/held sector, where it explains the route into a bridgehead.
    const bridge = contested ? null : buildFrontBridge(sector, frontGeometryLines, bearing, regionClip);
    if (bridge) {
      bridgeheadFills.push({
        type: "Feature",
        id: `${sector.id}-bridgehead-fill`,
        geometry: { type: "MultiPolygon", coordinates: bridge.bridgePolygons },
        properties: { color: fill, contested },
      });
      frontApproaches.push({
        type: "Feature",
        id: `${sector.id}-front-approach`,
        geometry: { type: "MultiLineString", coordinates: bridge.approachLines },
        // The approach is an operational route from the real border entry to
        // the combat line, not a second red front. Cyan keeps the distinction
        // visible in the same visual language as the attack arrow.
        properties: { color: contested ? "#38d8ff" : fill, contested },
      });
      frontOrigins.push({
        type: "Feature",
        id: `${sector.id}-front-origin`,
        geometry: { type: "Point", coordinates: bridge.originPoint },
        properties: { color: contested ? "#ff7868" : fill },
      });
      frontEntryLines.push({
        type: "Feature",
        id: `${sector.id}-front-entry-line`,
        geometry: { type: "LineString", coordinates: bridge.boundaryLine || bridge.entryLine },
        properties: { color: contested ? "#ff5148" : fill, contested },
      });
    }
    if (frontGeometryLines.length) {
      const contactLines = frontGeometryLines;
      frontLines.push({
        type: "Feature",
        id: `${sector.id}-front-line`,
        geometry: { type: "MultiLineString", coordinates: contactLines },
        properties: {
          color: contested ? "#ff7868" : fill,
          contested,
          sectorName: sector.name,
        },
      });
      frontTeeth.push({
        type: "Feature",
        id: `${sector.id}-front-teeth`,
        geometry: { type: "MultiLineString", coordinates: buildFrontTeeth(frontGeometryLines, bearing) },
        properties: { color: contested ? "#ff5148" : fill, contested },
      });
    }
    lineCells.forEach((cell, cellIndex) => {
      const geometry = cellGeometry(cell, sector);
      if (!geometry || !isContested(cell, sector)) return;
      battlePoints.push({
        type: "Feature",
        id: `${sector.id}-battle-${cell.id || cellIndex}`,
        geometry: { type: "Point", coordinates: [geometry.lng, geometry.lat] },
        properties: {
          color: "#ff7868",
          sectorName: sector.name,
          glyph: "⚔",
          control: Math.round(cellControl(cell, sector)),
        },
      });
    });
    const sectorUnits = units.filter((unit) => (
      String(unit?.sectorId || "") === String(sector.id || "")
      && Number(unit?.strength) > 0
      && numericUnitPoint(unit)
    ));
    const assaultUnits = sectorUnits.filter((unit) => (
      String(unit?.ownerCode || "").toLowerCase() === String(sector.ownerCode || "").toLowerCase()
      && ["infantry", "armor", "garrison"].includes(String(unit?.type || "infantry").toLowerCase())
    ));
    const supportUnits = sectorUnits.filter((unit) => (
      String(unit?.ownerCode || "").toLowerCase() === String(sector.ownerCode || "").toLowerCase()
      && String(unit?.type || "").toLowerCase() === "artillery"
    ));
    const reserveUnits = sectorUnits.filter((unit) => (
      String(unit?.ownerCode || "").toLowerCase() !== String(sector.ownerCode || "").toLowerCase()
      && (/reserve|резерв/i.test(String(unit?.name || "")) || String(unit?.status || "").toLowerCase() === "reserve")
    ));
    const unitArrows = assaultUnits
      .map((unit) => ({ unit, geometry: buildUnitAttackArrow(sector, unit, bearing) }))
      .filter((entry) => entry.geometry);
    const operationalArrows = unitArrows.length > 0
      ? unitArrows
      : [{ unit: null, geometry: (() => {
          const line = buildAttackArrow(sector, cells, bearing);
          const body = buildAttackArrowPolygon(sector, cells, bearing);
          return line && body ? { line, body } : null;
        })() }].filter((entry) => entry.geometry);
    operationalArrows.forEach(({ unit, geometry }, arrowIndex) => {
      attackArrows.push({
        type: "Feature",
        id: `${sector.id}-attack-arrow-${unit?.id || arrowIndex}`,
        geometry: { type: "MultiLineString", coordinates: geometry.line },
        properties: { color: "#38d8ff", unitId: unit?.id || "" },
      });
      attackArrowBodies.push({
        type: "Feature",
        id: `${sector.id}-attack-arrow-body-${unit?.id || arrowIndex}`,
        geometry: { type: "Polygon", coordinates: geometry.body },
        properties: { color: "#38d8ff", unitId: unit?.id || "" },
      });
    });
    sectorUnits
      .filter((unit) => (
        String(unit?.ownerCode || "").toLowerCase() !== String(sector.ownerCode || "").toLowerCase()
        && ["infantry", "armor", "garrison"].includes(String(unit?.type || "infantry").toLowerCase())
        && ["engaged", "moving", "pending"].includes(String(unit?.status || "").toLowerCase())
      ))
      .map((unit) => ({ unit, geometry: buildUnitDefenseArrow(sector, unit, bearing) }))
      .filter((entry) => entry.geometry)
      .forEach(({ unit, geometry }, arrowIndex) => {
        defenseArrows.push({
          type: "Feature",
          id: `${sector.id}-defense-arrow-${unit?.id || arrowIndex}`,
          geometry: { type: "MultiLineString", coordinates: geometry.line },
          properties: { color: "#ff9b86", unitId: unit?.id || "" },
        });
        defenseArrowBodies.push({
          type: "Feature",
          id: `${sector.id}-defense-arrow-body-${unit?.id || arrowIndex}`,
          geometry: { type: "Polygon", coordinates: geometry.body },
          properties: { color: "#ff9b86", unitId: unit?.id || "" },
        });
      });
    const leadCenter = operationalEnvelope?.lead?.center
      || cellGeometry(cells.at(-1), sector);
    const rearCenter = operationalEnvelope?.rear?.center
      || cellGeometry(cells[0], sector);
    if (contested && leadCenter) {
      supportUnits.forEach((unit) => {
        const route = buildOperationalRoute(unit, leadCenter, bearing, 1.6);
        if (!route) return;
        supportRoutes.push({
          type: "Feature",
          id: `${sector.id}-support-route-${unit.id}`,
          geometry: { type: "LineString", coordinates: route },
          properties: { color: "#ffd166", label: "FIRE SUPPORT" },
        });
      });
      reserveUnits.forEach((unit) => {
        const route = buildOperationalRoute(unit, rearCenter || leadCenter, bearing, -1.2);
        if (!route) return;
        reserveRoutes.push({
          type: "Feature",
          id: `${sector.id}-reserve-route-${unit.id}`,
          geometry: { type: "LineString", coordinates: route },
          properties: { color: "#ff8e7d", label: "RESERVE" },
        });
      });
      if (rearCenter && leadCenter) {
        // The supply axis must have two visible tactical anchors. Starting it
        // at the historical border origin left a blue ray entering from off
        // screen, which read as a detached artefact instead of logistics.
        const route = buildOperationalRoute(rearCenter, leadCenter, bearing, 0.8);
        if (route) {
          supportRoutes.push({
            type: "Feature",
            id: `${sector.id}-supply-route`,
            geometry: { type: "LineString", coordinates: route },
            properties: { color: "#55c6e8", label: "SUPPLY AXIS" },
          });
        }
      }
      const depotPoint = rearCenter && offsetCoordinate(rearCenter, 4.6, bearing + 90);
      if (depotPoint) {
        supplyNodes.push({
          type: "Feature",
          id: `${sector.id}-supply-depot`,
          geometry: { type: "Point", coordinates: depotPoint },
          properties: { glyph: "◇", label: "SUPPLY DEPOT", status: "OPEN", color: "#55c6e8", kind: "depot" },
        });
      }
      const axisRoute = rearCenter && buildOperationalRoute(rearCenter, leadCenter, bearing, 0);
      const axisPoint = axisRoute?.[1];
      if (axisPoint) {
        operationLabels.push({
          type: "Feature",
          id: `${sector.id}-assault-axis-label`,
          geometry: { type: "Point", coordinates: axisPoint },
          properties: { label: "ASSAULT AXIS", color: "#b8f3ff", rotation: 0 },
        });
      }
    }
    const labelCenter = sector.center || cellGeometry(cells[Math.floor(cells.length / 2)], sector);
    if (labelCenter) {
      const frontLabelPoint = contested
        ? offsetCoordinate(labelCenter, 5.2, bearing + 90)
        : [labelCenter.lng, labelCenter.lat];
      frontLabels.push({
        type: "Feature",
        id: `${sector.id}-front-label`,
        geometry: { type: "Point", coordinates: frontLabelPoint || [labelCenter.lng, labelCenter.lat] },
        properties: {
          // The command rail carries the full theatre name. A compact contact
          // label keeps the active battle marker and the assault-axis caption
          // readable at the close operational zoom.
          label: contested ? `FRONT  ·  ${Math.round(sectorControl)}%` : `${sector.name}  ·  ${Math.round(sectorControl)}%`,
        },
      });
      const anchor = contested ? labelCenter : (sector.frontOrigin || labelCenter);
      const ownerPoint = offsetCoordinate(
        anchor,
        Math.max(14, Number(sector.frontWidthKm || sector.radiusKm * 2) * 0.42),
        bearing + 180,
      );
      const enemyPoint = offsetCoordinate(
        anchor,
        Math.max(14, Number(sector.frontWidthKm || sector.radiusKm * 2) * 0.42),
        bearing,
      );
      if (ownerPoint && sector.ownerCode) {
        frontPolityLabels.push({
          type: "Feature",
          id: `${sector.id}-owner-label`,
          geometry: { type: "Point", coordinates: ownerPoint },
          properties: { label: String(sector.ownerCode).toUpperCase(), color: "#d7f1c6" },
        });
      }
      if (enemyPoint && sector.contestedBy) {
        frontPolityLabels.push({
          type: "Feature",
          id: `${sector.id}-enemy-label`,
          geometry: { type: "Point", coordinates: enemyPoint },
          properties: { label: String(Array.isArray(sector.contestedBy) ? sector.contestedBy[0] : sector.contestedBy).toUpperCase(), color: "#ffd2d2" },
        });
      }
    }
    if (footprint.length) {
      fills.push({
        type: "Feature",
        id: `${sector.id}-controlled-area`,
        geometry: { type: "MultiPolygon", coordinates: footprint },
          properties: {
          fill,
          opacity: contested ? 0.3 : 0.72,
          sectorId: sector.id,
          sectorName: sector.name,
          regionId: sector.regionId,
          ownerCode: cells[0]?.ownerCode || sector.ownerCode,
          contestedBy: Array.isArray(sector.contestedBy) ? sector.contestedBy.join(", ") : sector.contestedBy || "",
          control: Math.round(sectorControl),
          frontWidthKm: Number.isFinite(Number(sector.frontWidthKm)) ? Math.round(Number(sector.frontWidthKm)) : null,
          advanceDepthKm: Number.isFinite(Number(sector.advanceDepthKm)) ? Math.round(Number(sector.advanceDepthKm)) : null,
          frontBearing: Number.isFinite(Number(sector.frontBearing)) ? Math.round(Number(sector.frontBearing)) : null,
          status: sector.status || "contested",
          note: sector.note || "",
        },
      });
      // In a contested theatre the cell union can contain tiny visual seams
      // when village-sized cells do not overlap perfectly. Those seams read as
      // several fake fronts. The dedicated contact line below is authoritative
      // for combat; keep the footprint outline only for peaceful sectors.
      if (!contested) {
        fronts.push({
          type: "Feature",
          id: `${sector.id}-front`,
          geometry: { type: "MultiLineString", coordinates: multilineFromMultiPolygon(footprint) },
          properties: { fill, outline: fill, contested },
        });
      }
    }
  }

  const collection = (features) => ({ type: "FeatureCollection", features });
  return {
    fills: collection(fills),
    cellTerritories: collection(cellTerritories),
    cellControlFills: collection(cellControlFills),
    cellOutlines: collection(cellOutlines),
    fronts: collection(fronts),
    frontLines: collection(frontLines),
    frontTeeth: collection(frontTeeth),
    engagementTeeth: collection(engagementTeeth),
    frontFlanks: collection(frontFlanks),
    engagementRails: collection(engagementRails),
    cellBoundaries: collection(cellBoundaries),
    combatBands: collection(combatBands),
    echelonLines: collection(echelonLines),
    bridgeheadFills: collection(bridgeheadFills),
    frontApproaches: collection(frontApproaches),
    frontOrigins: collection(frontOrigins),
    frontEntryLines: collection(frontEntryLines),
    battlePoints: collection(battlePoints),
    attackArrows: collection(attackArrows),
    attackArrowBodies: collection(attackArrowBodies),
    defenseArrows: collection(defenseArrows),
    defenseArrowBodies: collection(defenseArrowBodies),
    supportRoutes: collection(supportRoutes),
    reserveRoutes: collection(reserveRoutes),
    supplyNodes: collection(supplyNodes),
    operationLabels: collection(operationLabels),
    frontLabels: collection(frontLabels),
    frontPolityLabels: collection(frontPolityLabels),
  };
};

const ControlSectors = () => {
  const { controlSectors, worldState } = useWorldState();
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const [selectedCell, setSelectedCell] = useState(null);
  const [battlePulse, setBattlePulse] = useState(false);
  const units = Array.isArray(worldState?.units) ? worldState.units : [];
  const displaySectors = useMemo(() => prepareDisplaySectors(controlSectors), [controlSectors]);
  const regionIds = useMemo(() => displaySectors.map((sector) => sector.regionId), [displaySectors]);
  const regionClips = useRegionClipGeometry(regionIds);
  const battleMarkers = useMemo(() => displaySectors.flatMap((sector) => {
    const rawCells = Array.isArray(sector.cells) && sector.cells.length > 0
      ? sector.cells
      : [{ ...sector, id: `${sector.id}-battle-cell` }];
    return leafCells(rawCells)
      .filter((cell) => isContested(cell, sector))
      .map((cell, index) => {
        const geometry = cellGeometry(cell, sector);
        if (!geometry) return null;
        return {
          ...geometry,
          id: `${sector.id}-battle-marker-${cell.id || index}`,
          name: sector.name,
          control: Math.round(cellControl(cell, sector)),
        };
      })
      .filter(Boolean);
  }), [displaySectors]);
  const commandMarkers = useMemo(() => displaySectors.map((sector) => {
    const rawCells = Array.isArray(sector.cells) && sector.cells.length > 0
      ? sector.cells
      : [{ ...sector, id: `${sector.id}-command-cell` }];
    const cells = leafCells(rawCells);
    const center = sector.center || cellGeometry(cells[Math.floor(cells.length / 2)], sector);
    if (!center) return null;
    const bearing = sectorBearing(sector, cells);
    const anchor = offsetCoordinate(
      center,
      Math.max(6, Number(sector.frontWidthKm || sector.radiusKm || 8) * 0.72),
      bearing + 180,
    ) || [center.lng, center.lat];
    const formations = units.filter((unit) => (
      String(unit?.sectorId || "") === String(sector.id || "")
      && Number(unit?.strength) > 0
    ));
    const strength = formations.reduce((sum, unit) => sum + (Number(unit.strength) || 0), 0);
    return {
      id: `${sector.id}-command-marker`,
      lng: anchor[0],
      lat: anchor[1],
      name: sector.name,
      owner: sector.ownerCode,
      status: String(sector.status || "contested").toUpperCase(),
      cells: cells.length,
      formations: formations.length,
      strength,
    };
  }).filter(Boolean), [displaySectors, units]);

  useEffect(() => {
    getNationColors().then(setColorMap).catch(() => {});
  }, []);

  useEffect(() => {
    if (!displaySectors.some((sector) => isContested(null, sector))) return undefined;
    const timer = window.setInterval(() => setBattlePulse((current) => !current), 2200);
    return () => window.clearInterval(timer);
  }, [displaySectors]);

  const data = useMemo(
    () => (displaySectors.length ? buildData(displaySectors, colorMap, regionClips, units) : {
      fills: EMPTY_FEATURE_COLLECTION,
      cellTerritories: EMPTY_FEATURE_COLLECTION,
      cellControlFills: EMPTY_FEATURE_COLLECTION,
      cellOutlines: EMPTY_FEATURE_COLLECTION,
      fronts: EMPTY_FEATURE_COLLECTION,
      frontLines: EMPTY_FEATURE_COLLECTION,
      frontTeeth: EMPTY_FEATURE_COLLECTION,
      engagementTeeth: EMPTY_FEATURE_COLLECTION,
      frontFlanks: EMPTY_FEATURE_COLLECTION,
      engagementRails: EMPTY_FEATURE_COLLECTION,
      cellBoundaries: EMPTY_FEATURE_COLLECTION,
      combatBands: EMPTY_FEATURE_COLLECTION,
      echelonLines: EMPTY_FEATURE_COLLECTION,
      bridgeheadFills: EMPTY_FEATURE_COLLECTION,
      frontApproaches: EMPTY_FEATURE_COLLECTION,
      frontOrigins: EMPTY_FEATURE_COLLECTION,
      frontEntryLines: EMPTY_FEATURE_COLLECTION,
      battlePoints: EMPTY_FEATURE_COLLECTION,
      attackArrows: EMPTY_FEATURE_COLLECTION,
      attackArrowBodies: EMPTY_FEATURE_COLLECTION,
      defenseArrows: EMPTY_FEATURE_COLLECTION,
      defenseArrowBodies: EMPTY_FEATURE_COLLECTION,
      supportRoutes: EMPTY_FEATURE_COLLECTION,
      reserveRoutes: EMPTY_FEATURE_COLLECTION,
      supplyNodes: EMPTY_FEATURE_COLLECTION,
      operationLabels: EMPTY_FEATURE_COLLECTION,
      frontLabels: EMPTY_FEATURE_COLLECTION,
      frontPolityLabels: EMPTY_FEATURE_COLLECTION,
    }),
    [displaySectors, colorMap, regionClips, units],
  );

  useEffect(() => {
    if (!map) return undefined;
    const competingLayers = ["units-fill", "markers-shapes", "cities-shapes", "cities-labels"];
    const sectorAt = (event) => {
      if (!map.getLayer("control-sectors-fill")) return null;
      const blockers = competingLayers.filter((id) => map.getLayer(id));
      if (blockers.length && map.queryRenderedFeatures(event.point, { layers: blockers }).length) return null;
      return map.queryRenderedFeatures(event.point, { layers: ["control-sectors-fill"] })[0] || null;
    };
    const onClick = (event) => {
      const feature = sectorAt(event);
      if (!feature) return;
      dismissRegionPopup();
      setSelectedCell({ lng: event.lngLat.lng, lat: event.lngLat.lat, properties: feature.properties || {} });
    };
    const onMove = (event) => {
      map.getCanvas().style.cursor = sectorAt(event) ? "pointer" : "";
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      if (map.getCanvas().style.cursor === "pointer") map.getCanvas().style.cursor = "";
    };
  }, [map]);

  if (!data.fills.features.length) return null;

  return (
    <>
      <Source id="control-sectors-source" type="geojson" data={data.fills}>
        <Layer
          id="control-sectors-fill"
          type="fill"
          paint={{ "fill-color": ["get", "fill"], "fill-opacity": ["get", "opacity"] }}
        />
      </Source>
      <Source id="control-sector-cell-territories-source" type="geojson" data={data.cellTerritories}>
        <Layer
          id="control-sector-cell-territories"
          type="fill"
          paint={{
            "fill-color": ["get", "fill"],
            "fill-opacity": ["get", "opacity"],
          }}
        />
      </Source>
      <Source id="control-sector-cell-control-source" type="geojson" data={data.cellControlFills}>
        <Layer
          id="control-sector-cell-control"
          type="fill"
          paint={{
            "fill-color": ["get", "fill"],
            "fill-opacity": ["get", "opacity"],
          }}
        />
      </Source>
      <Source id="control-sector-cell-outlines-source" type="geojson" data={data.cellOutlines}>
        <Layer
          id="control-sector-cell-outlines"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.2, 8, 0.42, 13, 0.7],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.45, 9, 0.9, 13, 1.35],
            "line-dasharray": [2.4, 1.6],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-cell-boundaries-source" type="geojson" data={data.cellBoundaries}>
        <Layer
          id="control-sector-cell-boundaries"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.12, 8, 0.28, 13, 0.52],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 9, 0.75, 13, 1.2],
            "line-dasharray": [1.2, 1.6],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-engagement-rails-source" type="geojson" data={data.engagementRails}>
        <Layer
          id="control-sector-engagement-rails-glow"
          type="line"
          paint={{
            "line-color": "#ff7868",
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.1, 8, 0.2, 13, 0.32],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 9, 3.5, 13, 5],
            "line-blur": 1.4,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-engagement-rails"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.24, 8, 0.48, 13, 0.7],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 1.15, 13, 1.8],
            "line-dasharray": [1.2, 1.5],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-engagement-teeth-source" type="geojson" data={data.engagementTeeth}>
        <Layer
          id="control-sector-engagement-teeth"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.32, 8, 0.62, 13, 0.82],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.85, 9, 1.8, 13, 2.6],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-combat-bands-source" type="geojson" data={data.combatBands}>
        <Layer
          id="control-sector-combat-band"
          type="fill"
          filter={["!=", ["get", "kind"], "engagement"]}
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.05, 8, 0.11, 13, 0.18],
          }}
        />
        <Layer
          id="control-sector-combat-band-edge"
          type="line"
          filter={["!=", ["get", "kind"], "engagement"]}
          paint={{
            "line-color": "#ffd2bd",
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.18, 8, 0.34, 13, 0.56],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.45, 9, 1.1, 13, 1.7],
            "line-dasharray": [0.8, 1.5],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-engagement-band"
          type="fill"
          filter={["==", ["get", "kind"], "engagement"]}
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.035, 8, 0.08, 13, 0.13],
          }}
        />
      </Source>
      <Source id="control-sector-echelon-lines-source" type="geojson" data={data.echelonLines}>
        <Layer
          id="control-sector-echelon-lines-glow"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": 0.16,
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 9, 4, 13, 6],
            "line-blur": 1.2,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-echelon-lines"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.24, 8, 0.5, 13, 0.82],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 1.15, 13, 1.8],
            "line-dasharray": [1.4, 1.5],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-fronts-source" type="geojson" data={data.fronts}>
        <Layer
          id="control-sector-fronts-glow"
          type="line"
          paint={{
            "line-color": ["get", "outline"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.12, 9, 0.26, 13, 0.4],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.8, 9, 3.2, 13, 4.8],
            "line-blur": 1.1,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-fronts"
          type="line"
          paint={{
            "line-color": ["get", "outline"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 0.82, 13, 0.96],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.7, 9, 1.35, 13, 2],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-battle-activity"
          type="line"
          filter={["==", ["get", "contested"], true]}
          paint={{
            "line-color": "#fff2cf",
            "line-opacity": battlePulse ? 0.68 : 0.28,
            "line-opacity-transition": { duration: 2000, delay: 0 },
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.65, 10, 1.15, 13, 1.55],
            "line-dasharray": [0.7, 2.8],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-bridgeheads-source" type="geojson" data={data.bridgeheadFills}>
        <Layer
          id="control-sector-bridgehead-glow"
          type="fill"
          beforeId="control-sector-front-lines-glow"
          paint={{
            "fill-color": ["get", "color"],
            // This is only the subdued operational footprint between the
            // border entry and contact line. Keep it under the red front so
            // the line cannot disappear into its own bridgehead shade.
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.03, 8, 0.06, 13, 0.11],
            "fill-outline-color": ["get", "color"],
          }}
        />
      </Source>
      <Source id="control-sector-front-approaches-source" type="geojson" data={data.frontApproaches}>
        <Layer
          id="control-sector-front-approaches-glow"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.16, 9, 0.32, 13, 0.48],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 9, 7, 13, 11],
            "line-blur": 1.7,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-front-approaches"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.65, 9, 0.88, 13, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.8, 9, 3.2, 13, 5],
            "line-dasharray": [0.9, 1.8],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-front-origins-source" type="geojson" data={data.frontOrigins}>
        <Layer
          id="control-sector-front-origin-halo"
          type="circle"
          paint={{
            "circle-color": ["get", "color"],
            "circle-opacity": 0.18,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 9, 9, 13, 13],
            "circle-blur": 0.4,
          }}
        />
        <Layer
          id="control-sector-front-origin"
          type="circle"
          paint={{
            "circle-color": "#f7fbff",
            "circle-opacity": 1,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.1, 9, 3.2, 13, 4.4],
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 1.1, 9, 1.8, 13, 2.5],
          }}
        />
      </Source>
      <Source id="control-sector-front-entry-lines-source" type="geojson" data={data.frontEntryLines}>
        <Layer
          id="control-sector-front-entry-lines-glow"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 9, 0.55, 13, 0.72],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 5, 9, 9, 13, 13],
            "line-blur": 1.3,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-front-entry-lines"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.82, 9, 0.98, 13, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.4, 9, 4.8, 13, 7],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-front-lines-source" type="geojson" data={data.frontLines}>
        <Layer
          id="control-sector-front-lines-glow"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.18, 9, 0.34, 13, 0.5],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 9, 7, 13, 10],
            "line-blur": 1.8,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-front-lines"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 9, 0.96, 13, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 9, 4.5, 13, 7],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-front-teeth-source" type="geojson" data={data.frontTeeth}>
        <Layer
          id="control-sector-front-teeth"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.72, 8, 0.96, 13, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.8, 9, 3.5, 13, 5.5],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-front-flanks-source" type="geojson" data={data.frontFlanks}>
        <Layer
          id="control-sector-front-flanks"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.22, 8, 0.48, 13, 0.7],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.75, 9, 1.4, 13, 2.4],
            "line-dasharray": [2.2, 1.3],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-battle-points-source" type="geojson" data={data.battlePoints}>
        <Layer
          id="control-sector-battle-points-halo"
          type="circle"
          paint={{
            "circle-color": "#ff7868",
            "circle-opacity": battlePulse ? 0.22 : 0.1,
            "circle-radius": battlePulse ? 8 : 4,
            "circle-blur": 0.45,
          }}
        />
        <Layer
          id="control-sector-battle-points"
          type="circle"
          paint={{
            "circle-color": "#fff2cf",
            "circle-opacity": 0.96,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.4, 9, 3.6, 13, 5],
            "circle-stroke-color": "#ff7868",
            "circle-stroke-width": 1.2,
          }}
        />
        <Layer
          id="control-sector-battle-glyphs"
          type="symbol"
          layout={{
            visibility: "none",
            "text-field": ["get", "glyph"],
            "text-font": ["Arial Unicode MS Bold", "Open Sans Bold", "sans-serif"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 8, 9, 12, 13, 16],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "#9d2526",
            "text-halo-width": 1.4,
          }}
        />
        <Layer
          id="control-sector-battle-strength"
          type="symbol"
          layout={{
            visibility: "none",
            "text-field": ["to-string", ["get", "control"]],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold", "sans-serif"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 7, 9, 10, 13, 13],
            "text-offset": [0, 1.35],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(25, 31, 42, 0.92)",
            "text-halo-width": 1.2,
          }}
        />
      </Source>
      <Source id="control-sector-support-routes-source" type="geojson" data={data.supportRoutes}>
        <Layer
          id="control-sector-support-routes-glow"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": 0.18,
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.2, 9, 4.5, 13, 7],
            "line-blur": 1.4,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-support-routes"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.46, 9, 0.78, 13, 0.94],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 9, 1.4, 13, 2.4],
            "line-dasharray": [0.8, 1.8],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-reserve-routes-source" type="geojson" data={data.reserveRoutes}>
        <Layer
          id="control-sector-reserve-routes"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.34, 9, 0.68, 13, 0.86],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 9, 1.5, 13, 2.6],
            "line-dasharray": [1.1, 1.4],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-supply-nodes-source" type="geojson" data={data.supplyNodes}>
        <Layer
          id="control-sector-supply-node-halo"
          type="circle"
          paint={{
            "circle-color": ["get", "color"],
            "circle-opacity": 0.18,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 9, 10, 13, 14],
            "circle-blur": 0.45,
          }}
        />
        <Layer
          id="control-sector-supply-node"
          type="circle"
          paint={{
            "circle-color": "#0d1c2b",
            "circle-opacity": 0.96,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 9, 4, 13, 5.5],
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 1.4,
          }}
        />
        <Layer
          id="control-sector-supply-node-labels"
          type="symbol"
          minzoom={7}
          layout={{
            "text-field": ["concat", ["get", "glyph"], "  ", ["get", "label"]],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold", "sans-serif"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 7, 10, 9, 13, 11],
            "text-offset": [1.4, 0],
            "text-anchor": "left",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": ["get", "color"],
            "text-halo-color": "rgba(7, 15, 28, 0.94)",
            "text-halo-width": 1.4,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 10, 0.82, 13, 0.96],
          }}
        />
      </Source>
      <Source id="control-sector-attack-arrows-source" type="geojson" data={data.attackArrows}>
        <Layer
          id="control-sector-attack-arrows-glow"
          type="line"
          beforeId="control-sector-front-lines-glow"
          paint={{
            "line-color": "#38d8ff",
            "line-opacity": 0.3,
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 9, 8, 13, 12],
            "line-blur": 2,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-attack-arrows"
          type="line"
          beforeId="control-sector-front-lines-glow"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.72, 9, 0.9, 13, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2, 9, 3.5, 13, 5],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-attack-arrow-bodies-source" type="geojson" data={data.attackArrowBodies}>
        <Layer
          id="control-sector-attack-arrow-body"
          type="fill"
          beforeId="control-sector-front-lines-glow"
          paint={{
            "fill-color": ["get", "color"],
            // Keep the operational arrow readable without washing out the
            // jagged contact line and the actual occupied-ground footprint.
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.03, 8, 0.07, 13, 0.14],
            "fill-outline-color": "#b8f3ff",
          }}
        />
      </Source>
      <Source id="control-sector-defense-arrows-source" type="geojson" data={data.defenseArrows}>
        <Layer
          id="control-sector-defense-arrows-glow"
          type="line"
          beforeId="control-sector-front-lines-glow"
          paint={{
            "line-color": "#ff9b86",
            "line-opacity": 0.26,
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 9, 6.5, 13, 9],
            "line-blur": 1.8,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-defense-arrows"
          type="line"
          beforeId="control-sector-front-lines-glow"
          paint={{
            "line-color": ["get", "color"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.66, 9, 0.88, 13, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.7, 9, 3, 13, 4.2],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-defense-arrow-bodies-source" type="geojson" data={data.defenseArrowBodies}>
        <Layer
          id="control-sector-defense-arrow-body"
          type="fill"
          beforeId="control-sector-front-lines-glow"
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.035, 8, 0.08, 13, 0.15],
            "fill-outline-color": "#ffd2bd",
          }}
        />
      </Source>
      <Source id="control-sector-operation-labels-source" type="geojson" data={data.operationLabels}>
        <Layer
          id="control-sector-operation-labels"
          type="symbol"
          minzoom={7}
          layout={{
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold", "sans-serif"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 7, 10, 10, 13, 12],
            "text-rotate": 0,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-letter-spacing": 0.12,
          }}
          paint={{
            "text-color": ["coalesce", ["get", "color"], "#b8f3ff"],
            "text-halo-color": "rgba(8, 18, 30, 0.92)",
            "text-halo-width": 1.6,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.42, 10, 0.86, 13, 1],
          }}
        />
      </Source>
      <Source id="control-sector-front-labels-source" type="geojson" data={data.frontLabels}>
        <Layer
          id="control-sector-front-labels"
          type="symbol"
          minzoom={5}
          layout={{
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 5, 9, 9, 12, 13, 15],
            "text-offset": [0, -1.5],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(7, 15, 28, 0.92)",
            "text-halo-width": 1.8,
          }}
        />
      </Source>
      <Source id="control-sector-front-polity-labels-source" type="geojson" data={data.frontPolityLabels}>
        <Layer
          id="control-sector-front-polity-labels"
          type="symbol"
          minzoom={6}
          layout={{
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold", "sans-serif"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 9, 18, 13, 24],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": ["get", "color"],
            "text-halo-color": "rgba(7, 15, 28, 0.94)",
            "text-halo-width": 2,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.45, 9, 0.82, 13, 0.94],
          }}
        />
      </Source>
      {commandMarkers
        .filter((command) => command.status !== "CONTESTED" && command.status !== "ASSAULT")
        .map((command) => (
        <Marker
          key={command.id}
          longitude={command.lng}
          latitude={command.lat}
          anchor="center"
        >
          <div
            aria-label={`${command.name}: ${command.status}, ${command.formations} formations, ${command.strength} strength`}
            style={{
              background: "rgba(7, 15, 28, 0.9)",
              border: "1px solid rgba(206, 226, 255, 0.42)",
              borderLeft: "3px solid #ff7868",
              borderRadius: "4px",
              boxShadow: "0 3px 12px rgba(0, 0, 0, 0.48)",
              color: "#f8fafc",
              fontFamily: "Arial, sans-serif",
              minWidth: "142px",
              padding: "5px 8px",
              pointerEvents: "none",
              transform: "translate(-50%, -50%)",
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", opacity: 0.8 }}>
              {String(command.owner || "FRONT").toUpperCase()} · {command.status}
            </div>
            <div style={{ fontSize: "12px", fontWeight: 800, marginTop: "2px" }}>{command.name}</div>
            <div style={{ color: "#9fdfff", fontSize: "10px", marginTop: "3px" }}>
              ⚔ {command.formations} formations · {command.cells} cells · {command.strength} strength
            </div>
          </div>
        </Marker>
        ))}
      {battleMarkers.map((battle) => (
        <Marker
          key={battle.id}
          longitude={battle.lng}
          latitude={battle.lat}
          anchor="center"
        >
          <div
            aria-label={`${battle.name}: contested battle, ${battle.control}% local control`}
            style={{
              alignItems: "center",
              background: "rgba(157, 37, 38, 0.94)",
              border: "1px solid rgba(255, 242, 207, 0.92)",
              borderRadius: "999px",
              boxShadow: battlePulse
                ? "0 0 0 3px rgba(255, 81, 72, 0.28), 0 2px 9px rgba(0, 0, 0, 0.65)"
                : "0 2px 9px rgba(0, 0, 0, 0.65)",
              color: "#fff2cf",
              display: "flex",
              fontFamily: "Arial, sans-serif",
              fontSize: "11px",
              fontWeight: 900,
              gap: "3px",
              lineHeight: 1,
              padding: "4px 6px",
              pointerEvents: "none",
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
              transform: `translate(-50%, -145%) scale(${battlePulse ? 1.06 : 1})`,
              transition: "box-shadow 0.4s ease, transform 0.4s ease",
              whiteSpace: "nowrap",
            }}
          >
            <span aria-hidden="true">⚔</span>
            <span>{battle.control}%</span>
          </div>
        </Marker>
      ))}
      {selectedCell && (
        <Popup
          longitude={selectedCell.lng}
          latitude={selectedCell.lat}
          anchor="bottom"
          closeButton
          closeOnClick={false}
          onClose={() => setSelectedCell(null)}
          offset={12}
        >
          <div style={{ minWidth: "210px", maxWidth: "280px", color: "#172033", fontFamily: "sans-serif" }}>
            <div style={{ fontSize: "13px", fontWeight: 800 }}>{selectedCell.properties.ownerCode}</div>
            <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>
              {selectedCell.properties.contestedBy || ["assault", "contested", "encircled"].includes(selectedCell.properties.status)
                ? "Contested front"
                : "Controlled ground"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 9px", fontSize: "11px", marginTop: "8px" }}>
              {selectedCell.properties.contestedBy && <><span style={{ color: "#64748b" }}>Opposition</span><strong>{selectedCell.properties.contestedBy}</strong></>}
              <span style={{ color: "#64748b" }}>Control</span><strong>{selectedCell.properties.control}%</strong>
              {selectedCell.properties.frontWidthKm !== null && <><span style={{ color: "#64748b" }}>Frontage</span><strong>{selectedCell.properties.frontWidthKm} km</strong></>}
              {selectedCell.properties.advanceDepthKm !== null && <><span style={{ color: "#64748b" }}>Depth</span><strong>{selectedCell.properties.advanceDepthKm} km</strong></>}
              {selectedCell.properties.frontBearing !== null && <><span style={{ color: "#64748b" }}>Axis</span><strong>{selectedCell.properties.frontBearing}°</strong></>}
              <span style={{ color: "#64748b" }}>Status</span><strong>{selectedCell.properties.status}</strong>
              <span style={{ color: "#64748b" }}>Region</span><span>{selectedCell.properties.regionId}</span>
            </div>
            {selectedCell.properties.note && <div style={{ borderTop: "1px solid #e2e8f0", color: "#475569", fontSize: "11px", lineHeight: 1.4, marginTop: "7px", paddingTop: "7px" }}>{selectedCell.properties.note}</div>}
          </div>
        </Popup>
      )}
    </>
  );
};

export default ControlSectors;
