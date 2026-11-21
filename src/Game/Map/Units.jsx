/*! Open Historia — troop/unit map layer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Marker, Source, Layer } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { subscribeUnits, getUnits, startUnitsSync } from "./unitsController.js";
import { useWorldState } from "./useWorldState.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// On-map glyph per unit type (rendered via the same font stack as the city
// symbols, so they appear wherever those do).
const TYPE_GLYPH = {
  infantry: "✚",
  armor: "◇",
  air: "✈",
  naval: "⚓",
  artillery: "⊕",
  garrison: "▦",
};

const ownerShort = (ownerCode) => String(ownerCode || "FRONT")
  .replace(/[^a-z0-9]/gi, "")
  .slice(0, 3)
  .toUpperCase();

const ownerColorString = (colorMap, code) => {
  const rgb = colorMap[code];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const normalized = String(code ?? "").toUpperCase();
  if (normalized.length < 2) return "rgb(120, 120, 120)";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[normalized.length - 1]));
  return `rgb(${72 + a * 5}, ${72 + c * 5}, ${72 + b * 5})`;
};

const counterRing = (unit) => {
  const lat = Number(unit.lat);
  const lng = Number(unit.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cosLat = Math.max(0.08, Math.cos((lat * Math.PI) / 180));
  const halfWidth = 3.6 / (111.32 * cosLat);
  const halfHeight = 2.2 / 111.32;
  return [
    [lng - halfWidth, lat - halfHeight],
    [lng + halfWidth, lat - halfHeight],
    [lng + halfWidth, lat + halfHeight],
    [lng - halfWidth, lat + halfHeight],
    [lng - halfWidth, lat - halfHeight],
  ];
};

const tacticalMarkerShift = (unit, sectors) => {
  const name = String(unit.name || "").toLowerCase();
  const type = String(unit.type || "").toLowerCase();
  if (name.includes("reserve")) return [-26, -22];
  if (type === "artillery" || name.includes("battery")) return [24, -26];
  const sector = sectors.find((entry) => String(entry?.id || "") === String(unit?.sectorId || ""));
  const friendly = sector && String(sector.ownerCode || "").toLowerCase() === String(unit.ownerCode || "").toLowerCase();
  return friendly ? [0, 0] : [24, 26];
};

const Units = () => {
  const [units, setUnits] = useState(getUnits());
  const [colorMap, setColorMap] = useState({});
  const { controlSectors } = useWorldState();
  const tacticalMapMode = controlSectors.length > 0;

  useEffect(() => {
    const stop = startUnitsSync();
    const unsubscribe = subscribeUnits(() => setUnits(getUnits()));
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  useEffect(() => {
    getNationColors()
      .then(setColorMap)
      .catch((error) => console.error("Failed to load colors for units:", error));
  }, []);

  const data = useMemo(() => {
    if (!units.length) return EMPTY_FEATURE_COLLECTION;
    return {
      type: "FeatureCollection",
      features: units
        .filter((unit) => Number.isFinite(unit.lng) && Number.isFinite(unit.lat))
        .map((unit) => ({
          type: "Feature",
          id: unit.id,
          geometry: { type: "Point", coordinates: [unit.lng, unit.lat] },
          properties: {
            id: unit.id,
            name: unit.name,
            type: unit.type,
            ownerCode: unit.ownerCode,
            strength: unit.strength,
            status: unit.status,
            glyph: TYPE_GLYPH[unit.type] ?? "I",
            counterLabel: `${TYPE_GLYPH[unit.type] ?? "I"} ${unit.strength}`,
            rgb: ownerColorString(colorMap, unit.ownerCode),
          },
        })),
    };
  }, [units, colorMap]);

  const counterData = useMemo(() => ({
    type: "FeatureCollection",
    features: units.map((unit) => {
      const ring = counterRing(unit);
      return ring ? {
        type: "Feature",
        id: `${unit.id}-counter-plate`,
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          border: ownerColorString(colorMap, unit.ownerCode),
          plate: "#111b2b",
          status: unit.status,
        },
      } : null;
    }).filter(Boolean),
  }), [units, colorMap]);

  return (
    <>
      <Source id="units-tactical-counter-plates-source" type="geojson" data={counterData}>
        <Layer
          id="units-tactical-counter-plates"
          type="fill"
          layout={{ visibility: "none" }}
          paint={{
            "fill-color": ["get", "plate"],
            "fill-opacity": ["case", ["==", ["get", "status"], "pending"], 0.62, 0.94],
            "fill-outline-color": ["get", "border"],
          }}
        />
      </Source>
      <Source id="units-source" type="geojson" data={data}>
      <Layer
        id="units-fill"
        type="circle"
        layout={{ visibility: tacticalMapMode ? "none" : "visible" }}
        paint={{
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 7, 6, 11, 12, 16],
          "circle-color": ["get", "rgb"],
          // Pending (player-requested, not yet AI-resolved) units are translucent.
          "circle-opacity": ["case", ["==", ["get", "status"], "pending"], 0.32, 0.92],
          "circle-stroke-width": ["case", ["==", ["get", "status"], "pending"], 1.5, 2],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "status"], "pending"], "#93c5fd",
            ["==", ["get", "status"], "moving"], "#ffd24a",
            ["==", ["get", "status"], "engaged"], "#ff6b6b",
            "#ffffff",
          ],
          "circle-stroke-opacity": ["case", ["==", ["get", "status"], "pending"], 0.55, 1],
          "circle-pitch-alignment": "map",
        }}
      />
      <Layer
        id="units-tactical-counter-backs"
        type="symbol"
        minzoom={4}
        layout={{
          // The polygon plate below is the counter background. Keeping the
          // old block glyph hidden avoids a second, oversized symbol behind
          // the readable unit marker.
          visibility: "none",
          "text-field": "▰",
          "text-font": ["Arial Unicode MS Bold", "Open Sans Bold", "sans-serif"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 22, 8, 31, 13, 40],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        }}
        paint={{
          "text-color": ["get", "rgb"],
          "text-opacity": 0.92,
          "text-halo-color": "rgba(13, 20, 31, 0.92)",
          "text-halo-width": 3,
        }}
      />
      <Layer
        id="units-icons"
        type="symbol"
        layout={{
          visibility: tacticalMapMode ? "none" : "visible",
          "symbol-sort-key": ["-", ["get", "strength"]],
          "text-field": ["get", "glyph"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 13, 12, 18],
        }}
        paint={{
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.65)",
          "text-halo-width": 1,
          "text-opacity": ["case", ["==", ["get", "status"], "pending"], 0.5, 1],
        }}
      />
      <Layer
        id="units-strength"
        type="symbol"
        minzoom={3}
        layout={{
          visibility: tacticalMapMode ? "none" : "visible",
          "symbol-sort-key": ["-", ["get", "strength"]],
          "text-field": ["to-string", ["get", "strength"]],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-offset": [0, 1.35],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 8, 11, 12, 13],
        }}
        paint={{
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.85)",
          "text-halo-width": 1.2,
        }}
      />
      <Layer
        id="units-tactical-counter-label"
        type="symbol"
        minzoom={4}
        layout={{
          visibility: "none",
          "text-field": ["get", "counterLabel"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold", "sans-serif"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 14, 13, 18],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        }}
        paint={{
          "text-color": "#f8fafc",
          "text-halo-color": "rgba(8, 14, 25, 0.96)",
          "text-halo-width": 1.8,
        }}
      />
    </Source>
    {tacticalMapMode && units
      .filter((unit) => Number.isFinite(Number(unit.lng)) && Number.isFinite(Number(unit.lat)))
      .map((unit) => {
        const glyph = TYPE_GLYPH[unit.type] ?? "I";
        const border = ownerColorString(colorMap, unit.ownerCode);
        const [shiftX, shiftY] = tacticalMarkerShift(unit, controlSectors);
        return (
          <Marker
            key={`tactical-counter-${unit.id}`}
            longitude={Number(unit.lng)}
            latitude={Number(unit.lat)}
            anchor="center"
          >
            <div style={{ position: "relative", transform: `translate(${shiftX}px, ${shiftY}px) translateZ(0)` }}>
              <div
                aria-label={`${unit.name || unit.type}: ${glyph} ${unit.strength}`}
                title={unit.name || unit.type}
                style={{
                  alignItems: "center",
                  background: "rgba(9, 17, 29, 0.94)",
                  border: `2px solid ${border}`,
                  borderRadius: "3px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.16)",
                  color: "#f8fafc",
                  display: "flex",
                  fontFamily: "Arial, sans-serif",
                  fontSize: "12px",
                  fontWeight: 800,
                  flexDirection: "column",
                  gap: "1px",
                  justifyContent: "center",
                  letterSpacing: "0.02em",
                  minWidth: "48px",
                  padding: "3px 6px 2px",
                  pointerEvents: "none",
                  textShadow: "0 1px 2px rgba(0,0,0,0.9)",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ alignItems: "center", display: "flex", gap: "6px", lineHeight: 1 }}>
                  <span style={{ color: "#ffffff", fontSize: "13px" }}>{glyph}</span>
                  <span>{unit.strength}</span>
                </span>
                <span style={{ alignItems: "center", color: "#b8c9dd", display: "flex", fontSize: "7px", fontWeight: 900, justifyContent: "space-between", letterSpacing: "0.12em", lineHeight: 1, width: "100%" }}>
                  <span>{ownerShort(unit.ownerCode)}</span>
                  <span>{String(unit.status || "ready").toUpperCase()}</span>
                </span>
                  <span style={{ background: "rgba(255,255,255,0.16)", borderRadius: "999px", display: "block", height: "2px", overflow: "hidden", width: "100%" }}>
                  <span style={{ background: border, borderRadius: "inherit", display: "block", height: "100%", width: `${Math.max(12, Math.min(100, Number(unit.strength) || 0))}%` }} />
                </span>
              </div>
            </div>
          </Marker>
        );
      })}
    </>
  );
};

export default Units;
