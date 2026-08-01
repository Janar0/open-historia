/*! Open Historia — tactical control sectors and prolonged battle overlay © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer, Popup, useMap } from "react-map-gl/maplibre";
import polygonClipping from "polygon-clipping";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import { controlSlicePolygon, hexagonPolygon, smoothClosedRing } from "./controlGeometry.js";
import { clipRingToRegion, useRegionClipGeometry } from "./useRegionClipGeometry.js";
import { dismissRegionPopup } from "../Selection/Regions.jsx";

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

// Follow the real gradient when the AI supplied several cells (the side with
// greater control is the secured rear; the cut advances toward lower-control
// cells). A stable id-derived bearing keeps single-cell/flat sectors from
// changing shape between renders.
const sectorBearing = (sector, cells) => {
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
  const operations = [];
  const labels = [];

  for (const sector of sectors) {
    if (!sector?.name) continue;
    const allCells = Array.isArray(sector.cells) && sector.cells.length > 0
      ? sector.cells
      : [{ ...sector, id: `${sector.id}-cell-legacy`, name: sector.name }];
    const cells = leafCells(allCells);
    const bearing = sectorBearing(sector, cells);
    const regionClip = regionClips.get(String(sector.regionId ?? ""));
    const controlledPolygons = [];
    const operationPolygons = [];
    let contested = false;
    let weightedControl = 0;
    let validCells = 0;

    for (const [cellIndex, cell] of cells.entries()) {
      const geometry = cellGeometry(cell, sector);
      if (!geometry) continue;
      const control = cellControl(cell, sector);
      const cellIsContested = isContested(cell, sector);
      const ownerCode = cell.ownerCode || sector.ownerCode;
      const fill = colorForOwner(ownerCode, colorMap);
      const fullRing = smoothClosedRing(hexagonPolygon(geometry), 0.08);
      const fullPolygons = clipRingToRegion(fullRing, regionClip);
      operationPolygons.push(...fullPolygons.map((polygon) => [polygon]));

      const controlledRing = controlSlicePolygon(geometry, control, bearing);
      const clipped = clipRingToRegion(controlledRing, regionClip);
      if (clipped.length) {
        controlledPolygons.push(...clipped.map((polygon) => [polygon]));
        fills.push({
          type: "Feature",
          id: cell.id || `${sector.id}-cell-${cellIndex + 1}`,
          geometry: { type: "MultiPolygon", coordinates: clipped },
          properties: {
            fill,
            opacity: cellIsContested ? 0.46 : 0.56,
            sectorId: sector.id,
            cellId: cell.id || `${sector.id}-cell-${cellIndex + 1}`,
            sectorName: sector.name,
            cellName: cell.name || "",
            regionId: sector.regionId,
            ownerCode,
            contestedBy: Array.isArray(cell.contestedBy || sector.contestedBy)
              ? (cell.contestedBy || sector.contestedBy).join(", ")
              : cell.contestedBy || sector.contestedBy || "",
            control: Math.round(control),
            status: cell.status || sector.status || "contested",
            note: cell.note || sector.note || "",
          },
        });
      }
      contested ||= cellIsContested;
      weightedControl += control;
      validCells += 1;
    }

    const controlled = unionPolygons(controlledPolygons);
    const operational = unionPolygons(operationPolygons);
    const fill = colorForOwner(cells[0]?.ownerCode || sector.ownerCode, colorMap);
    if (controlled.length) {
      fronts.push({
        type: "Feature",
        id: `${sector.id}-front`,
        geometry: { type: "MultiLineString", coordinates: multilineFromMultiPolygon(controlled) },
        properties: { fill, outline: contested ? "#f4f1de" : fill, contested },
      });
    }
    if (operational.length) {
      operations.push({
        type: "Feature",
        id: `${sector.id}-operation`,
        geometry: { type: "MultiLineString", coordinates: multilineFromMultiPolygon(operational) },
        properties: { fill },
      });
    }
    const lng = Number(sector.center?.lng);
    const lat = Number(sector.center?.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      const parentControl = Number(sector.control);
      const control = Number.isFinite(parentControl)
        ? parentControl
        : validCells ? weightedControl / validCells : 0;
      labels.push({
        type: "Feature",
        id: `${sector.id}-label`,
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { label: `${sector.name} · ${Math.round(control)}%`, fill },
      });
    }
  }

  const collection = (features) => ({ type: "FeatureCollection", features });
  return { fills: collection(fills), fronts: collection(fronts), operations: collection(operations), labels: collection(labels) };
};

const ControlSectors = () => {
  const { controlSectors } = useWorldState();
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const [selectedCell, setSelectedCell] = useState(null);
  const regionIds = useMemo(() => controlSectors.map((sector) => sector.regionId), [controlSectors]);
  const regionClips = useRegionClipGeometry(regionIds);

  useEffect(() => {
    getNationColors().then(setColorMap).catch(() => {});
  }, []);

  const data = useMemo(
    () => (controlSectors.length ? buildData(controlSectors, colorMap, regionClips) : {
      fills: EMPTY_FEATURE_COLLECTION,
      fronts: EMPTY_FEATURE_COLLECTION,
      operations: EMPTY_FEATURE_COLLECTION,
      labels: EMPTY_FEATURE_COLLECTION,
    }),
    [controlSectors, colorMap, regionClips],
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

  if (!data.fills.features.length && !data.operations.features.length) return null;

  return (
    <>
      <Source id="control-sectors-source" type="geojson" data={data.fills}>
        <Layer
          id="control-sectors-fill"
          type="fill"
          paint={{ "fill-color": ["get", "fill"], "fill-opacity": ["get", "opacity"] }}
        />
      </Source>
      <Source id="control-sector-operations-source" type="geojson" data={data.operations}>
        <Layer
          id="control-sector-operations"
          type="line"
          minzoom={6}
          paint={{
            "line-color": ["get", "fill"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.2, 10, 0.42],
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.7, 11, 1.25],
            "line-dasharray": [2, 2.5],
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
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.16, 9, 0.32, 13, 0.44],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 9, 3.8, 13, 5.4],
            "line-blur": 1.4,
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="control-sector-fronts"
          type="line"
          paint={{
            "line-color": ["get", "outline"],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.48, 9, 0.78, 13, 0.94],
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 9, 1.5, 13, 2.2],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="control-sector-labels-source" type="geojson" data={data.labels}>
        <Layer
          id="control-sectors-labels"
          type="symbol"
          minzoom={5.5}
          layout={{
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 12],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          }}
          paint={{
            "text-color": "#fffaf0",
            "text-halo-color": "rgba(18, 24, 31, 0.9)",
            "text-halo-width": 1.5,
          }}
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
            <div style={{ fontSize: "13px", fontWeight: 800 }}>{selectedCell.properties.cellName || selectedCell.properties.sectorName}</div>
            {selectedCell.properties.cellName && (
              <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>{selectedCell.properties.sectorName}</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 9px", fontSize: "11px", marginTop: "8px" }}>
              <span style={{ color: "#64748b" }}>Controller</span><strong>{selectedCell.properties.ownerCode}</strong>
              {selectedCell.properties.contestedBy && <><span style={{ color: "#64748b" }}>Opposition</span><strong>{selectedCell.properties.contestedBy}</strong></>}
              <span style={{ color: "#64748b" }}>Status</span><strong>{selectedCell.properties.status}</strong>
              <span style={{ color: "#64748b" }}>Region</span><span>{selectedCell.properties.regionId}</span>
            </div>
            <div style={{ height: "6px", overflow: "hidden", background: "#e2e8f0", borderRadius: "999px", marginTop: "9px" }}>
              <div style={{ width: `${selectedCell.properties.control}%`, height: "100%", background: selectedCell.properties.fill || "#64748b" }} />
            </div>
            <div style={{ color: "#475569", fontSize: "10px", marginTop: "3px", textAlign: "right" }}>{selectedCell.properties.control}% controlled</div>
            {selectedCell.properties.note && <div style={{ borderTop: "1px solid #e2e8f0", color: "#475569", fontSize: "11px", lineHeight: 1.4, marginTop: "7px", paddingTop: "7px" }}>{selectedCell.properties.note}</div>}
          </div>
        </Popup>
      )}
    </>
  );
};

export default ControlSectors;
