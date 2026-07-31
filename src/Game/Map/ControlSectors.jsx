/*! Open Historia — tactical control sectors and prolonged battle overlay © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import polygonClipping from "polygon-clipping";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import { hexagonPolygon, smoothClosedRing } from "./controlGeometry.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
const TACTICAL_PALETTE = [
  "#ef9f45",
  "#e76f51",
  "#d95d8a",
  "#8c7ae6",
  "#4ea8de",
  "#2a9d8f",
  "#8ab17d",
  "#c9a227",
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

const buildFeatureCollection = (sectors, colorMap) => ({
  type: "FeatureCollection",
  features: sectors.flatMap((sector) => {
    if (!sector?.name) return [];
    const allCells = Array.isArray(sector.cells) && sector.cells.length > 0
      ? sector.cells
      : [{ ...sector, id: `${sector.id}-cell-legacy`, name: sector.name }];
    const cells = leafCells(allCells);

    return cells.flatMap((cell, cellIndex) => {
      const center = cell?.center && typeof cell.center === "object" ? cell.center : cell;
      const lng = Number(center?.lng);
      const lat = Number(center?.lat);
      const radiusKm = Number(cell?.radiusKm ?? sector.radiusKm);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(radiusKm)) return [];

      const ownerCode = cell.ownerCode || sector.ownerCode;
      const fill = colorForOwner(ownerCode, colorMap);
      const contested = Boolean(cell.contestedBy || sector.contestedBy)
        || ["assault", "contested", "encircled"].includes(cell.status || sector.status);
      const control = Number.isFinite(Number(cell.control))
        ? Math.max(0, Math.min(100, Number(cell.control)))
        : Math.max(0, Math.min(100, Number(sector.control) || 0));
      const label = cell.name || (cellIndex === Math.floor(cells.length / 2) ? sector.name : "");
      return [{
        type: "Feature",
        id: cell.id || `${sector.id}-cell-${cellIndex + 1}`,
        geometry: { type: "Polygon", coordinates: [hexagonPolygon({ lng, lat, radiusKm })] },
        properties: {
          fill,
          outline: contested ? "#f4f1de" : fill,
          label: label ? `${label} · ${Math.round(control)}%` : "",
          opacity: contested ? 0.14 + control / 500 : 0.2 + control / 360,
          status: cell.status || sector.status || "contested",
          sectorId: sector.id,
          cellId: cell.id || `${sector.id}-cell-${cellIndex + 1}`,
        },
      }];
    });
  }),
});

const buildBoundaryFeatureCollection = (sectors, colorMap) => ({
  type: "FeatureCollection",
  features: sectors.flatMap((sector) => {
    if (!sector?.name) return [];
    const allCells = Array.isArray(sector.cells) && sector.cells.length > 0
      ? sector.cells
      : [{ ...sector, id: `${sector.id}-cell-legacy`, name: sector.name }];
    const cells = leafCells(allCells);
    const polygons = cells.map((cell) => {
      const center = cell?.center && typeof cell.center === "object" ? cell.center : cell;
      const lng = Number(center?.lng);
      const lat = Number(center?.lat);
      const radiusKm = Number(cell?.radiusKm ?? sector.radiusKm);
      return Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(radiusKm)
        ? [hexagonPolygon({ lng, lat, radiusKm })]
        : null;
    }).filter(Boolean);
    if (!polygons.length) return [];

    let merged;
    try {
      merged = polygons.length === 1 ? polygons : polygonClipping.union(...polygons);
    } catch {
      merged = polygons;
    }
    const ownerCode = cells[0]?.ownerCode || sector.ownerCode;
    const fill = colorForOwner(ownerCode, colorMap);
    return merged.map((polygon, index) => ({
      type: "Feature",
      id: `${sector.id}-boundary-${index + 1}`,
      geometry: {
        type: "MultiLineString",
        coordinates: polygon.map((ring) => smoothClosedRing(ring)),
      },
      properties: {
        fill,
        outline: cells.some((cell) => cell.contestedBy || ["assault", "contested", "encircled"].includes(cell.status))
          ? "#f4f1de"
          : fill,
      },
    }));
  }),
});

const ControlSectors = () => {
  const { controlSectors } = useWorldState();
  const [colorMap, setColorMap] = useState({});

  useEffect(() => {
    getNationColors().then(setColorMap).catch(() => {});
  }, []);

  const data = useMemo(
    () => (controlSectors.length ? buildFeatureCollection(controlSectors, colorMap) : EMPTY_FEATURE_COLLECTION),
    [controlSectors, colorMap],
  );
  const boundaryData = useMemo(
    () => (controlSectors.length ? buildBoundaryFeatureCollection(controlSectors, colorMap) : EMPTY_FEATURE_COLLECTION),
    [controlSectors, colorMap],
  );

  if (!data.features.length) return null;

  return (
    <>
      <Source id="control-sectors-source" type="geojson" data={data}>
        <Layer
          id="control-sectors-fill"
          type="fill"
          paint={{
            "fill-color": ["get", "fill"],
            "fill-opacity": ["get", "opacity"],
          }}
        />
        <Layer
          id="control-sectors-outline"
          type="line"
          paint={{
            "line-color": ["get", "outline"],
            "line-dasharray": [2, 1],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.18, 7, 0.4, 12, 0.72],
            "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 7, 2.2, 12, 3],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 0.55, 10, 0.12],
          }}
        />
        <Layer
          id="control-sectors-labels"
          type="symbol"
          minzoom={5.5}
          filter={["!=", ["get", "label"], ""]}
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
      {boundaryData.features.length > 0 && (
        <Source id="control-sector-boundaries-source" type="geojson" data={boundaryData}>
          <Layer
            id="control-sector-boundaries"
            type="line"
            paint={{
              "line-color": ["get", "outline"],
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.48, 7, 0.78, 12, 0.96],
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 8, 2.5, 12, 4],
              "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 1.3, 8, 0.5, 12, 0.15],
            }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </Source>
      )}
    </>
  );
};

export default ControlSectors;
