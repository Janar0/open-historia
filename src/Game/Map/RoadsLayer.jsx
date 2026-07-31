/*! Open Historia — optional close-zoom roads and settlement overlay © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

// The political map remains the game's authoritative layer. This optional raster
// overlay supplies modern road geometry and dense settlement labels only when the
// camera is close enough for them to be useful; it does not alter game state.
const ROAD_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const RoadsLayer = () => {
  const enabled = useMapSetting(MAP_SETTING_KEYS.showRoads);
  if (!enabled) return null;

  return (
    <Source
      id="detailed-roads-source"
      type="raster"
      tiles={[ROAD_TILE_TEMPLATE]}
      tileSize={256}
      minzoom={7}
      maxzoom={19}
      attribution="© OpenStreetMap contributors"
    >
      <Layer
        id="detailed-roads-layer"
        type="raster"
        minzoom={7}
        paint={{
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.08, 9, 0.2, 12, 0.42, 16, 0.58],
          "raster-fade-duration": 0,
          "raster-saturation": -0.45,
          "raster-contrast": 0.12,
          "raster-brightness-min": 0.08,
          "raster-brightness-max": 0.9,
        }}
      />
    </Source>
  );
};

export default RoadsLayer;
