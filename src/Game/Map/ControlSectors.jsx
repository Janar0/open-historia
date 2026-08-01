/*! Open Historia — tactical control sectors and prolonged battle overlay © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer, Popup, useMap } from "react-map-gl/maplibre";
import polygonClipping from "polygon-clipping";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import { smoothClosedRing, tacticalAreaPolygon, tacticalBreakthroughPolygon } from "./controlGeometry.js";
import { clipRingToRegion, useRegionClipGeometry } from "./useRegionClipGeometry.js";
import { dismissRegionPopup } from "../Selection/Regions.jsx";
import { inferTacticalFrontGeometry, tacticalConnectedComponents } from "../AI/sectorContinuity.js";

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

const multilineFromMultiPolygon = (multiPolygon) => multiPolygon
  .flatMap((polygon) => polygon.map((ring) => smoothClosedRing(ring, 0.12)));

const buildData = (sectors, colorMap, regionClips) => {
  const fills = [];
  const fronts = [];

  for (const sector of sectors) {
    if (!sector?.name) continue;
    const allCells = Array.isArray(sector.cells) && sector.cells.length > 0
      ? sector.cells
      : [{ ...sector, id: `${sector.id}-cell-legacy`, name: sector.name }];
    const cells = leafCells(allCells);
    const bearing = sectorBearing(sector, cells);
    const regionClip = regionClips.get(String(sector.regionId ?? ""));
    const footprintPolygons = [];
    const inferredFront = Number.isFinite(Number(sector.frontBearing))
      ? inferTacticalFrontGeometry({ ...sector, cells, frontBearing: bearing })
      : null;
    const frontOriginValue = sector.frontOrigin || inferredFront?.frontOrigin;
    const frontOrigin = frontOriginValue && typeof frontOriginValue === "object"
      ? { lng: Number(frontOriginValue.lng), lat: Number(frontOriginValue.lat) }
      : null;
    const frontWidthKm = Number(sector.frontWidthKm ?? inferredFront?.frontWidthKm);
    const advanceDepthKm = Number(sector.advanceDepthKm ?? inferredFront?.advanceDepthKm);
    const hasDirectedShape = Number.isFinite(frontOrigin?.lng)
      && Number.isFinite(frontOrigin?.lat)
      && Number.isFinite(frontWidthKm)
      && Number.isFinite(advanceDepthKm);
    let contested = false;
    let weightedControl = 0;
    let totalWeight = 0;

    if (hasDirectedShape) {
      const breakthrough = tacticalBreakthroughPolygon({
        origin: frontOrigin,
        bearingDeg: bearing,
        widthKm: frontWidthKm,
        depthKm: advanceDepthKm,
      });
      const clipped = clipRingToRegion(breakthrough, regionClip);
      footprintPolygons.push(...clipped.map((polygon) => [polygon]));
    }

    for (const [cellIndex, cell] of cells.entries()) {
      const geometry = cellGeometry(cell, sector);
      if (!geometry) continue;
      const control = cellControl(cell, sector);
      const cellIsContested = isContested(cell, sector);
      if (!hasDirectedShape) {
        const displayGeometry = {
          ...geometry,
          radiusKm: geometry.radiusKm * 1.08,
          bearingDeg: bearing,
          ...(cells.length === 1 ? { depthScale: 0.72, frontScale: 1.35 } : {}),
        };
        const fullRing = smoothClosedRing(tacticalAreaPolygon(displayGeometry, cell.id || `${sector.id}-${cellIndex}`), 0.1);
        const clipped = clipRingToRegion(fullRing, regionClip);
        if (clipped.length) footprintPolygons.push(...clipped.map((polygon) => [polygon]));
      }
      contested ||= cellIsContested;
      const weight = Math.max(0.25, geometry.radiusKm ** 2);
      weightedControl += control * weight;
      totalWeight += weight;
    }

    const footprint = unionPolygons(footprintPolygons);
    const sectorControl = totalWeight > 0 ? weightedControl / totalWeight : Number(sector.control) || 0;
    const fill = colorForOwner(cells[0]?.ownerCode || sector.ownerCode, colorMap);
    if (footprint.length) {
      fills.push({
        type: "Feature",
        id: `${sector.id}-controlled-area`,
        geometry: { type: "MultiPolygon", coordinates: footprint },
        properties: {
          fill,
          opacity: contested ? 0.64 : 0.72,
          sectorId: sector.id,
          sectorName: sector.name,
          regionId: sector.regionId,
          ownerCode: cells[0]?.ownerCode || sector.ownerCode,
          contestedBy: Array.isArray(sector.contestedBy) ? sector.contestedBy.join(", ") : sector.contestedBy || "",
          control: Math.round(sectorControl),
          status: sector.status || "contested",
          note: sector.note || "",
        },
      });
      fronts.push({
        type: "Feature",
        id: `${sector.id}-front`,
        geometry: { type: "MultiLineString", coordinates: multilineFromMultiPolygon(footprint) },
        properties: { fill, outline: contested ? "#ff7868" : fill, contested },
      });
    }
  }

  const collection = (features) => ({ type: "FeatureCollection", features });
  return { fills: collection(fills), fronts: collection(fronts) };
};

const ControlSectors = () => {
  const { controlSectors } = useWorldState();
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const [selectedCell, setSelectedCell] = useState(null);
  const [battlePulse, setBattlePulse] = useState(false);
  const displaySectors = useMemo(() => prepareDisplaySectors(controlSectors), [controlSectors]);
  const regionIds = useMemo(() => displaySectors.map((sector) => sector.regionId), [displaySectors]);
  const regionClips = useRegionClipGeometry(regionIds);

  useEffect(() => {
    getNationColors().then(setColorMap).catch(() => {});
  }, []);

  useEffect(() => {
    if (!displaySectors.some((sector) => isContested(null, sector))) return undefined;
    const timer = window.setInterval(() => setBattlePulse((current) => !current), 2200);
    return () => window.clearInterval(timer);
  }, [displaySectors]);

  const data = useMemo(
    () => (displaySectors.length ? buildData(displaySectors, colorMap, regionClips) : {
      fills: EMPTY_FEATURE_COLLECTION,
      fronts: EMPTY_FEATURE_COLLECTION,
    }),
    [displaySectors, colorMap, regionClips],
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
            <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>Controlled territory</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 9px", fontSize: "11px", marginTop: "8px" }}>
              {selectedCell.properties.contestedBy && <><span style={{ color: "#64748b" }}>Opposition</span><strong>{selectedCell.properties.contestedBy}</strong></>}
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
