/*! Open Historia — cell-backed subregion and secession overlay © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import polygonClipping from "polygon-clipping";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import { hexagonPolygon, smoothClosedRing } from "./controlGeometry.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
const FALLBACK_COLORS = ["#f59e0b", "#22c55e", "#38bdf8", "#e879f9", "#fb7185", "#a3e635"];

const hashString = (value) => {
  let hash = 0;
  for (const character of String(value ?? "")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
};

const colorForOwner = (ownerCode, colors) => {
  const rgb = colors[String(ownerCode ?? "").trim()];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  return FALLBACK_COLORS[hashString(ownerCode) % FALLBACK_COLORS.length];
};

const buildData = (fragments, sectors, colors) => {
  const cells = new Map();
  for (const sector of sectors) {
    for (const cell of sector.cells || []) {
      const center = cell.center && typeof cell.center === "object" ? cell.center : cell;
      const lng = Number(center?.lng);
      const lat = Number(center?.lat);
      const radiusKm = Number(cell.radiusKm);
      if (Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(radiusKm)) {
        cells.set(`${sector.id}:${cell.id}`, { lng, lat, radiusKm });
      }
    }
  }

  const fills = [];
  const borders = [];
  for (const fragment of fragments) {
    if (fragment.status === "dissolved") continue;
    const polygons = fragment.cellRefs.map((ref) => {
      const cell = cells.get(ref);
      return cell ? [hexagonPolygon(cell)] : null;
    }).filter(Boolean);
    if (!polygons.length) continue;
    let merged;
    try {
      merged = polygons.length === 1 ? polygons : polygonClipping.union(...polygons);
    } catch {
      merged = polygons;
    }
    const fill = colorForOwner(fragment.ownerCode, colors);
    const commonProperties = {
      fill,
      outline: fill,
      label: `${fragment.name} · ${fragment.ownerCode}`,
      kind: fragment.kind,
      fragmentId: fragment.id,
    };
    fills.push({
      type: "Feature",
      id: `${fragment.id}-fill`,
      geometry: { type: "MultiPolygon", coordinates: merged },
      properties: commonProperties,
    });
    borders.push({
      type: "Feature",
      id: `${fragment.id}-border`,
      geometry: {
        type: "MultiLineString",
        coordinates: merged.flatMap((polygon) => polygon.map((ring) => smoothClosedRing(ring))),
      },
      properties: commonProperties,
    });
  }
  return {
    fills: { type: "FeatureCollection", features: fills },
    borders: { type: "FeatureCollection", features: borders },
  };
};

const TerritoryFragments = () => {
  const { controlSectors, territoryFragments } = useWorldState();
  const [colors, setColors] = useState({});

  useEffect(() => {
    getNationColors().then(setColors).catch(() => {});
  }, []);

  const data = useMemo(
    () => (territoryFragments.length ? buildData(territoryFragments, controlSectors, colors) : {
      fills: EMPTY_FEATURE_COLLECTION,
      borders: EMPTY_FEATURE_COLLECTION,
    }),
    [controlSectors, territoryFragments, colors],
  );

  if (!data.fills.features.length) return null;

  return (
    <>
      <Source id="territory-fragments-source" type="geojson" data={data.fills}>
        <Layer
          id="territory-fragments-fill"
          type="fill"
          paint={{
            "fill-color": ["get", "fill"],
            "fill-opacity": 0.18,
          }}
        />
      </Source>
      <Source id="territory-fragment-borders-source" type="geojson" data={data.borders}>
        <Layer
          id="territory-fragment-borders"
          type="line"
          paint={{
            "line-color": ["get", "outline"],
            "line-opacity": 0.95,
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.4, 8, 2.8, 13, 4],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 10, 0.2],
          }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
        <Layer
          id="territory-fragment-labels"
          type="symbol"
          minzoom={5.2}
          layout={{
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 12],
            "text-allow-overlap": false,
          }}
          paint={{
            "text-color": "#fffaf0",
            "text-halo-color": "rgba(18, 24, 31, 0.95)",
            "text-halo-width": 1.6,
          }}
        />
      </Source>
    </>
  );
};

export default TerritoryFragments;
