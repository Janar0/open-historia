/*! Open Historia — relief and rivers over a painted scenario map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A painted map (world.background.kind "image") whose scenario ships a relief
// (relief.json, scripts/relief/build-relief.mjs) gets lit hills and the rivers
// and lakes that follow them, over the political colours and under the borders
// and names (mapLayerOrder.js). The hills are a MapLibre hillshade over DEM
// tiles made in the browser from the scenario's heightmap (reliefDem.js), so
// they stay sharp at any zoom; the water is vector. Settings → Map "Painted"
// (the scenario terrain choice) switches it off, as it does a vector scenario's
// relief tiles. A scenario without a relief shows exactly what it did.

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { addProtocol } from "maplibre-gl";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { MAP_SETTING_KEYS, useMapSettingValue } from "../../runtime/mapSettings.js";
import { wantsScenarioTerrain } from "./scenarioTerrain.js";
import { useWorldBackground } from "./useWorldState.js";
import { useLayerOrder } from "./useLayerOrder.js";
import { RELIEF_DEM_ENCODING, RELIEF_DEM_PROTOCOL, RELIEF_DEM_TILE_SIZE, decodeReliefPixels, reliefDemTileLoader, setReliefGrid } from "./reliefDem.js";

let protocolRegistered = false;
const ensureProtocol = () => {
  if (protocolRegistered) return;
  addProtocol(RELIEF_DEM_PROTOCOL, reliefDemTileLoader);
  protocolRegistered = true;
};

// The political fills' lighter ramp while the relief shows (Nations.jsx reads
// it like a vector scenario's): a touch more of the painting under the colours.
export const PAINTED_RELIEF_FILL_OPACITY = Object.freeze([[1.5, 0.44], [3.75, 0.5], [6, 0.54], [10, 0.56], [14, 0.56]]);
let painted = null;
const listeners = new Set();
const publish = (next) => {
  if (painted === next) return;
  painted = next;
  for (const listener of listeners) listener();
};
export const subscribePaintedRelief = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getPaintedRelief = () => painted;
export const usePaintedRelief = () => useSyncExternalStore(subscribePaintedRelief, getPaintedRelief, getPaintedRelief);

// No lake layer: the painting draws its lakes, and a vector lake laid over one
// never sat exactly on it (the relief only flattens the ground under them).
const LAYERS = ["relief-hillshade", "relief-rivers"];

// The heightmap's packed pixels, read without the browser's colour management
// (which would shift the bytes the metres are packed in).
const decodeHeightmap = async (relief) => {
  const blob = await (await fetch(relief.heightmap)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  return {
    width: bitmap.width,
    height: bitmap.height,
    bounds: relief.bounds,
    data: decodeReliefPixels(pixels, Number(relief.maxMetres) || 6000),
  };
};

// Wider where more water gathers (`flow`, 0..1), and with the zoom.
const RIVER_WIDTH = ["interpolate", ["linear"], ["zoom"],
  2, ["+", 0.5, ["*", 1, ["get", "flow"]]],
  4, ["+", 0.9, ["*", 2, ["get", "flow"]]],
  6, ["+", 1.3, ["*", 3.5, ["get", "flow"]]],
  9, ["+", 2, ["*", 6, ["get", "flow"]]],
  12, ["+", 3, ["*", 10, ["get", "flow"]]],
];

const ReliefLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const { background } = useWorldBackground();
  const wanted = wantsScenarioTerrain(useMapSettingValue(MAP_SETTING_KEYS.scenarioTerrain));
  const painting = background?.kind === "image";
  const key = painting ? JSON.stringify(background) : "";
  const [state, setState] = useState({ key: "", relief: null, tiles: 0 });

  useEffect(() => {
    if (!key) {
      setState({ key: "", relief: null, tiles: 0 });
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const relief = await readJson(JSON_URLS.reliefData, { defaultValue: null, force: true });
        if (cancelled || relief?.kind !== "relief" || !relief.heightmap) {
          if (!cancelled) setState({ key, relief: null, tiles: 0 });
          return;
        }
        const grid = await decodeHeightmap(relief);
        if (cancelled) return;
        ensureProtocol();
        setState({ key, relief, tiles: setReliefGrid(grid) });
      } catch (error) {
        console.warn("[map] the scenario's relief could not be read; the painting shows alone.", error?.message || error);
        if (!cancelled) setState({ key, relief: null, tiles: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [key]);

  const shown = Boolean(wanted && state.relief && state.key === key);
  useEffect(() => {
    publish(shown ? { fillOpacity: PAINTED_RELIEF_FILL_OPACITY } : null);
    return () => publish(null);
  }, [shown]);
  useLayerOrder(map, LAYERS, shown);

  if (!shown) return null;
  const { relief } = state;
  return (
    <>
      <Source
        key={state.tiles}
        id="relief-dem"
        type="raster-dem"
        tiles={[`${RELIEF_DEM_PROTOCOL}://${state.tiles}/{z}/{x}/{y}`]}
        tileSize={RELIEF_DEM_TILE_SIZE}
        encoding="custom"
        redFactor={RELIEF_DEM_ENCODING.redFactor}
        greenFactor={RELIEF_DEM_ENCODING.greenFactor}
        blueFactor={RELIEF_DEM_ENCODING.blueFactor}
        baseShift={RELIEF_DEM_ENCODING.baseShift}
        maxzoom={11}
      >
        <Layer
          id="relief-hillshade"
          type="hillshade"
          paint={{
            "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 4, 0.55, 7, 0.7, 11, 0.8],
            "hillshade-illumination-direction": 315,
            "hillshade-shadow-color": "rgba(52, 36, 22, 0.75)",
            "hillshade-highlight-color": "rgba(255, 246, 222, 0.55)",
            "hillshade-accent-color": "rgba(70, 52, 34, 0.5)",
          }}
        />
      </Source>
      <Source id="relief-water-rivers" type="geojson" data={relief.rivers ?? { type: "FeatureCollection", features: [] }}>
        <Layer
          id="relief-rivers"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": "#3d6a88",
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.7, 5, 0.9, 9, 0.95],
            "line-width": RIVER_WIDTH,
          }}
        />
      </Source>
    </>
  );
};

export default ReliefLayers;
