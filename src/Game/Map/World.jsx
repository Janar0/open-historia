/*! Open Historia — portions (troop system integration + globe sun/stars) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map from "react-map-gl/maplibre";
import Nations from "./Nations";
import ControlSectors from "./ControlSectors.jsx";
import TerritoryFragments from "./TerritoryFragments.jsx";
import RoadsLayer from "./RoadsLayer.jsx";
import { useCustomBackground } from "./useCustomBackground.js";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import Cities from "./Cities";
import Units from "./Units";
import UnitPopup from "../Selection/Units";
import MarkersLayer from "./MarkersLayer.jsx";
import FeaturePopup from "../Selection/Features.jsx";
import OperationalFrontRail from "./OperationalFrontRail.jsx";
import {
  DEFAULT_BASEMAP_ID,
  TERRAIN_TILE_TEMPLATE,
  basemapMaxZoom,
  basemapProtocolTemplate,
  ensureBasemapProtocol,
  esriTileTemplate,
  loadRegionCatalog,
} from "../../runtime/assets.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";
import { loadGameDetails, useLibraryState } from "../../runtime/library.js";
import { useWorldState } from "./useWorldState.js";

// The high-res source goes through the ohbase protocol so ESRI's "Map Data
// Not Yet Available" placeholders get replaced with upscaled ancestor tiles.
ensureBasemapProtocol();

// Grading applied to whichever ESRI basemap is picked: cap brightness so it
// sits against the dark UI, with a little desaturation/contrast that suits both
// the satellite imagery and the paler cartographic styles.
const SATELLITE_PAINT = {
  "raster-resampling": "linear",
  "raster-saturation": -0.15,
  "raster-contrast": 0.08,
  "raster-brightness-min": 0.02,
  "raster-brightness-max": 0.78,
};

// Once a live front exists the basemap becomes terrain for a staff map, not the
// main visual. Desaturate and lower it so the contact line, counters, and
// operational fills carry the information instead of a pastel satellite wash.
const OPERATIONAL_SATELLITE_PAINT = {
  ...SATELLITE_PAINT,
  "raster-saturation": -0.86,
  "raster-contrast": 0.28,
  "raster-brightness-min": 0,
  "raster-brightness-max": 0.42,
};

// Full-map image corners (TL, TR, BR, BL). The flat mercator map only reaches
// ±85.0511° (the projection limit), but the globe shows all the way to the poles
// — so on the globe the image stretches nearly to ±90° to cover the pole caps.
// NOT exactly ±90: mercatorYfromLat(±90) is ±Infinity, which makes MapLibre's
// ImageSource.setCoordinates throw — so we stop a hair short (the custom-bg-base
// layer fills the negligible remaining sliver).
const WORLD_IMAGE_COORDS_FLAT = [
  [-180, 85.0511],
  [180, 85.0511],
  [180, -85.0511],
  [-180, -85.0511],
];
const WORLD_IMAGE_COORDS_GLOBE = [
  [-180, 89.9],
  [180, 89.9],
  [180, -89.9],
  [-180, -89.9],
];

const buildWorldStyle = (basemapId, customBg, backgroundDeclared, isGlobe, operationalMode = false) => {
  // A custom uploaded map replaces the ESRI basemap entirely — no satellite or
  // terrain tiles load at all (saves those requests), the uploaded map is the
  // base layer, and the regions/labels from <Nations> paint on top of it.
  if (customBg?.kind === "image" && customBg.imageUrl) {
    return {
      version: 8,
      sources: {
        "custom-bg": {
          type: "image",
          url: customBg.imageUrl,
          coordinates: isGlobe ? WORLD_IMAGE_COORDS_GLOBE : WORLD_IMAGE_COORDS_FLAT,
        },
      },
      layers: [
        // Solid base beneath the image so no edge/pole ever shows a transparent hole.
        { id: "custom-bg-base", type: "background", paint: { "background-color": "#0b1a2b" } },
        { id: "custom-bg-layer", type: "raster", source: "custom-bg", paint: { "raster-fade-duration": 0 } },
      ],
      sky: { "atmosphere-blend": 0 },
    };
  }
  if (customBg?.kind === "vector" && customBg.geojson) {
    return {
      version: 8,
      sources: { "custom-bg-vec": { type: "geojson", data: customBg.geojson } },
      layers: [
        { id: "custom-bg-sea", type: "background", paint: { "background-color": "#0b1a2b" } },
        // A fill layer only draws (Multi)Polygons, so no geometry-type filter is
        // needed — and the old "Polygon"-only filter silently dropped the dissolved
        // MultiPolygon biomes, so the basemap rendered nothing. Each feature carries
        // its own biome colour in `fill`.
        { id: "custom-bg-fill", type: "fill", source: "custom-bg-vec", paint: { "fill-color": ["coalesce", ["get", "fill"], "#33435c"] } },
        { id: "custom-bg-line", type: "line", source: "custom-bg-vec", paint: { "line-color": "rgba(0,0,0,0.18)", "line-width": 0.4 } },
      ],
      sky: { "atmosphere-blend": 0 },
    };
  }
  // A background is declared but its payload hasn't loaded yet — show a neutral
  // placeholder (no ESRI/terrain sources) so a custom-map game never flashes
  // satellite Earth or fires basemap tile requests it won't use.
  if (backgroundDeclared) {
    return {
      version: 8,
      sources: {},
      layers: [{ id: "custom-bg-loading", type: "background", paint: { "background-color": "#0b1a2b" } }],
      sky: { "atmosphere-blend": 0 },
    };
  }
  return {
  version: 8,
  sources: {
    "satellite-lowres": {
      type: "raster",
      // Levels 0-2 always have real data — no placeholder handling needed.
      tiles: [esriTileTemplate(basemapId)],
      tileSize: 256,
      maxzoom: 2,
    },
    satellite: {
      type: "raster",
      tiles: [basemapProtocolTemplate(basemapId)],
      tileSize: 256,
      maxzoom: basemapMaxZoom(basemapId),
    },
    "terrain-source": {
      type: "raster-dem",
      tiles: [
        TERRAIN_TILE_TEMPLATE,
      ],
      encoding: "terrarium",
      maxzoom: 5,
      tileSize: 256,
    },
    "operational-veil": {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-180, 85.0511],
            [180, 85.0511],
            [180, -85.0511],
            [-180, -85.0511],
            [-180, 85.0511],
          ]],
        },
        properties: {},
      },
    },
  },
  layers: [
    {
      id: "satellite-lowres-layer",
      type: "raster",
      source: "satellite-lowres",
      paint: operationalMode ? OPERATIONAL_SATELLITE_PAINT : SATELLITE_PAINT,
    },
    {
      id: "satellite-layer",
      type: "raster",
      source: "satellite",
      paint: operationalMode ? OPERATIONAL_SATELLITE_PAINT : SATELLITE_PAINT,
    },
    {
      id: "hills",
      type: "hillshade",
      source: "terrain-source",
      paint: {
        "hillshade-exaggeration": 0.1,
        "hillshade-shadow-color": "#000",
      },
    },
    {
      id: "operational-veil",
      type: "fill",
      source: "operational-veil",
      paint: {
        "fill-color": "#0a1726",
        "fill-opacity": operationalMode ? 0.16 : 0,
      },
    },
  ],
  // MapLibre's uniform atmosphere is off; GlobeEffects supplies directional
  // surface light instead. Transparent space lets the stars and sun show.
  sky: {
    "atmosphere-blend": 0,
  },
  };
};

const collectGeometryCoordinates = (value, output) => {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  ) {
    output.push([Number(value[0]), Number(value[1])]);
    return;
  }
  value.forEach((child) => collectGeometryCoordinates(child, output));
};

const geometryCenter = (geometry) => {
  const coordinates = [];
  collectGeometryCoordinates(geometry?.coordinates, coordinates);
  if (!coordinates.length) return null;

  const totals = coordinates.reduce(
    (sum, [lng, lat]) => ({ lng: sum.lng + lng, lat: sum.lat + lat }),
    { lng: 0, lat: 0 },
  );
  return {
    lng: totals.lng / coordinates.length,
    lat: totals.lat / coordinates.length,
  };
};

const distanceKmBetweenPoints = (left, right) => {
  if (!left || !right) return Infinity;
  const lat = (Number(left.lat) + Number(right.lat)) / 2;
  const east = (Number(right.lng) - Number(left.lng)) * 111.32
    * Math.max(0.08, Math.cos((lat * Math.PI) / 180));
  const north = (Number(right.lat) - Number(left.lat)) * 111.32;
  return Math.hypot(east, north);
};

function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {
  const hasReportedInitialIdleRef = useRef(false);
  const focusedGameRef = useRef("");
  const [loading, setLoading] = useState(false);
  const loadTimerRef = useRef(null);
  const { activeGameId, activeGame } = useLibraryState();
  const { controlSectors } = useWorldState();
  const viewStateRef = useRef({
    longitude: 0,
    latitude: 0,
    zoom: 3.5,
    bearing: 0,
    pitch: 0,
  });
  // A custom uploaded map (image or vector) replaces the ESRI basemap; otherwise
  // the world is fixed to the ocean preset (the in-game basemap picker was removed).
  // `declared` flips on from the light world.json poll (before the heavy payload)
  // so the map drops ESRI immediately rather than flashing satellite Earth.
  const { background: customBg, declared: bgDeclared, basemap: worldBasemap } = useCustomBackground();
  const isGlobe = projection === "globe";
  const roadsEnabled = useMapSetting(MAP_SETTING_KEYS.showRoads);
  const mapProjection = useMemo(() => ({ type: projection }), [projection]);
  const focusPlayerCountry = useCallback(() => {
    const map = mapRef?.current?.getMap?.();
    if (!map || !activeGameId) return Promise.resolve(false);

    const playerCountry = activeGame?.country
      ? Promise.resolve(activeGame.country)
      : loadGameDetails(activeGameId).then((details) => details?.game?.country);
    return playerCountry
      .then((countryValue) => {
        const country = String(countryValue ?? "").trim();
        if (!country) return null;
        const sectorCells = controlSectors.flatMap((sector) => (
          Array.isArray(sector?.cells) ? sector.cells : []
        ));
        const tacticalCenters = controlSectors.flatMap((sector) => {
          const cells = Array.isArray(sector?.cells) ? sector.cells : [];
          // Once a theatre has a tactical cell grid, frame the contact itself.
          // Including the original border entry in the fit kept the leading
          // cell and its front line at the bottom edge of the screen. The
          // entry remains in the state and in the command logic; it should not
          // decide the player's operational viewport.
          const points = sectorCells.length
            ? cells
            : [sector?.frontOrigin, sector?.center, sector];
          return points.map((cell) => {
            const center = cell?.center && typeof cell.center === "object" ? cell.center : cell;
            const lng = Number(center?.lng);
            const lat = Number(center?.lat);
            return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
          }).filter(Boolean);
        });
        if (tacticalCenters.length) {
          const minLng = Math.min(...tacticalCenters.map((point) => point.lng));
          const maxLng = Math.max(...tacticalCenters.map((point) => point.lng));
          const minLat = Math.min(...tacticalCenters.map((point) => point.lat));
          const maxLat = Math.max(...tacticalCenters.map((point) => point.lat));
          const center = {
            lng: (minLng + maxLng) / 2,
            lat: (minLat + maxLat) / 2,
          };
          const leadCenters = controlSectors.map((sector) => {
            const cells = Array.isArray(sector?.cells) ? sector.cells : [];
            const lastCell = cells.at(-1);
            const point = lastCell?.center && typeof lastCell.center === "object" ? lastCell.center : lastCell;
            const lng = Number(point?.lng);
            const lat = Number(point?.lat);
            return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
          }).filter(Boolean);
          // Keep the whole connected corridor in frame, but bias the viewport
          // toward the newest contact. Centering on the arithmetic midpoint
          // left the live lead cell at the bottom edge after each advance.
          const leadCenter = leadCenters.length
            ? {
                lng: leadCenters.reduce((sum, point) => sum + point.lng, 0) / leadCenters.length,
                lat: leadCenters.reduce((sum, point) => sum + point.lat, 0) / leadCenters.length,
              }
            : null;
          const focusCenter = leadCenter
            ? {
                lng: center.lng + (leadCenter.lng - center.lng) * 0.24,
                lat: center.lat + (leadCenter.lat - center.lat) * 0.24,
              }
            : center;
          const longitudeSpan = maxLng - minLng;
          const latitudeSpan = maxLat - minLat;
          const spanFloor = controlSectors.length === 1 ? 0.18 : 0.42;
          const span = Math.max(spanFloor, longitudeSpan, latitudeSpan);
          const zoomCap = controlSectors.length === 1 ? 10.5 : 9.6;
          const focusSignature = controlSectors.map((sector) => ({
            id: sector.id,
            frontOrigin: sector.frontOrigin,
            center: sector.center,
            cells: (Array.isArray(sector.cells) ? sector.cells : []).map((cell) => ({
              id: cell.id,
              center: cell.center,
              depth: cell.depth,
              status: cell.status,
              control: cell.control,
            })),
          }));
          const focusKey = `${activeGameId}:${country.toLowerCase()}:front:${JSON.stringify(focusSignature)}`;
          const currentCenter = map.getCenter?.();
          const currentZoom = Number(map.getZoom?.() ?? 0);
          const focusStillVisible = currentZoom >= Math.max(7.4, zoomCap - 2)
            && distanceKmBetweenPoints(currentCenter, center) <= Math.max(48, span * 111.32 * 2.5);
          // A world/style reload can reset MapLibre's camera without changing
          // the sector signature. Do not trust the old focus key in that case:
          // the active front must remain on screen after a turn resolves.
          if (focusedGameRef.current === focusKey && focusStillVisible) return true;
          focusedGameRef.current = focusKey;
          const viewSpan = span * (controlSectors.length === 1 ? 0.84 : 0.9);
          map.flyTo({
            center: [focusCenter.lng, focusCenter.lat],
            // A tactical theatre needs the close operational scale used by the
            // reference maps. A single active front gets a closer view; a
            // multi-sector theatre keeps enough operational depth in frame.
            // The full cell span includes the secured rear. Use a tighter
            // operational window so the leading contact and formations stay
            // readable after the front grows instead of shrinking into a
            // theatre-wide overview.
            zoom: Math.max(8.2, Math.min(zoomCap, zoomCap - Math.log2(viewSpan / spanFloor))),
            duration: 850,
            essential: true,
          });
          return { focused: true };
        }
        return loadRegionCatalog().then((catalog) => ({ catalog, country }));
      })
      .then((result) => {
        if (!result) return false;
        if (result.focused) return true;
        const { catalog, country } = result;
        const focusKey = `${activeGameId}:${country.toLowerCase()}`;
        if (focusedGameRef.current === focusKey) return true;
        const countryKey = country.toLowerCase();
        const centers = (Array.isArray(catalog) ? catalog : [])
          .filter((region) => String(region?.country ?? "").trim().toLowerCase() === countryKey)
          .map((region) => geometryCenter(region.geometry))
          .filter(Boolean);
        if (!centers.length) return false;

        const center = centers.reduce(
          (sum, point) => ({ lng: sum.lng + point.lng, lat: sum.lat + point.lat }),
          { lng: 0, lat: 0 },
        );
        focusedGameRef.current = focusKey;
        map.flyTo({
          center: [center.lng / centers.length, center.lat / centers.length],
          zoom: Math.max(3.5, Math.min(4.15, map.getZoom?.() ?? 3.5)),
          duration: 650,
          essential: true,
        });
        return true;
      })
      .catch(() => false);
  }, [activeGame?.country, activeGameId, controlSectors, mapRef]);
  const styleUsesGlobeCoords = customBg?.kind === "image" && isGlobe;
  const worldStyle = useMemo(
    () => buildWorldStyle(
      worldBasemap || DEFAULT_BASEMAP_ID,
      customBg,
      bgDeclared,
      styleUsesGlobeCoords,
      controlSectors.length > 0,
    ),
    [bgDeclared, controlSectors.length, customBg, styleUsesGlobeCoords, worldBasemap],
  );
  // Globe terrain is unsupported by MapLibre and can leave its shader cache invalid
  // when projections change. Keep the setting enabled and restore it on flat maps.
  const terrain = useMemo(
    () =>
      terrainEnabled && controlSectors.length === 0 && !isGlobe && !customBg && !bgDeclared
        ? {
            source: "terrain-source",
            exaggeration: 15,
          }
        : null,
    [terrainEnabled, controlSectors.length, isGlobe, customBg, bgDeclared],
  );
  // Render at reduced pixel density when zoomed far out: the whole-world view
  // draws every region, border and label at once, and full native resolution
  // there spends frames on detail nobody can see at that scale. Hysteresis
  // (re-sharpen at 5, soften below 4.5) prevents flapping at the boundary.
  const pixelRatioModeRef = useRef(null);
  const applyDynamicPixelRatio = useCallback((zoom) => {
    const map = mapRef?.current?.getMap?.();
    if (!map || typeof map.setPixelRatio !== "function") return;
    const mode = zoom <= 4.5 ? "low" : zoom >= 5 ? "native" : pixelRatioModeRef.current;
    if (!mode || mode === pixelRatioModeRef.current) return;
    pixelRatioModeRef.current = mode;
    const native = window.devicePixelRatio || 1;
    map.setPixelRatio(mode === "low" ? Math.min(native, 1) * 0.75 : native);
  }, [mapRef]);

  const handleMove = useCallback(({ viewState }) => {
    viewStateRef.current = viewState;
    applyDynamicPixelRatio(viewState.zoom);
  }, [applyDynamicPixelRatio]);
  const handleIdle = useCallback(() => {
    // The soft ratio applies from the very first frame settled at world zoom —
    // not only after the player first moves the camera.
    applyDynamicPixelRatio(viewStateRef.current?.zoom ?? 0);
    if (hasReportedInitialIdleRef.current) return;
    hasReportedInitialIdleRef.current = true;
    focusPlayerCountry();
    onInitialIdle?.();
    setLoading(false);
  }, [applyDynamicPixelRatio, focusPlayerCountry, onInitialIdle]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    let attempts = 0;
    const retryFocus = () => {
      if (cancelled) return;
      Promise.resolve(focusPlayerCountry()).then((focused) => {
        if (cancelled || focused || attempts >= 20) return;
        attempts += 1;
        retryTimer = window.setTimeout(retryFocus, 350);
      });
    };
    retryFocus();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [focusPlayerCountry]);
  const handleLoading = useCallback(() => {
    setLoading(true);
    clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => setLoading(false), 8000);
  }, []);

  return (
    // Stars and the single projected sun sit behind the transparent MapLibre
    // canvas, so the globe itself provides correct sun occlusion.
    <div
      id="oh-globe-space"
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: "#000",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {isGlobe && (
        <canvas
          id="oh-globe-stars"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      )}
      {isGlobe && (
        <div
          id="oh-globe-sun"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 88,
            height: 88,
            borderRadius: "50%",
            pointerEvents: "none",
            opacity: 0,
            background: "radial-gradient(circle, #fff 0 7%, #fff6cf 8% 12%, rgba(255,219,142,0.8) 15%, rgba(255,185,93,0.26) 31%, rgba(255,154,65,0.07) 52%, transparent 72%)",
            filter: "drop-shadow(0 0 12px rgba(255,218,145,0.75))",
            willChange: "transform, opacity, filter",
          }}
        />
      )}
      <Map
        key={projection}
        ref={mapRef}
        initialViewState={viewStateRef.current}
        minZoom={2.25}
        maxZoom={16}
        doubleClickZoom={false}
        maxBounds={[
          [-Infinity, -80],
          [Infinity, 85],
        ]}
        cursor="default"
        attributionControl={roadsEnabled ? { compact: true } : false}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        dragPan
        fadeDuration={0}
        collectResourceTiming={false}
        crossSourceCollisions={false}
        renderWorldCopies
        // Cap MapLibre's per-source out-of-view tile-retention cache. Left unset it
        // sizes dynamically to ~(ceil(w/tileSize)+1)*(ceil(h/tileSize)+1)*5 tiles PER
        // source — ~270 at 1080p but ~800 at a 3840x2160 desktop viewport, and
        // renderWorldCopies feeds successive wrapped world-copy tiles into it as you
        // pan E/W, so retained GPU textures climb until the tab OOMs. 256 caps the 4K
        // case ~3x while barely trimming 1080p, and is a no-op on phone-sized viewports
        // (dynamic size there is well under 256). In-view tiles live in a separate
        // structure and are never evicted by this, so it never re-fetches what's on
        // screen. Orthogonal to applyDynamicPixelRatio (which bounds framebuffer pixels).
        maxTileCacheSize={256}
        projection={mapProjection}
        terrain={terrain}
        mapStyle={worldStyle}
        onIdle={handleIdle}
        onLoading={handleLoading}
        onMove={handleMove}
      >
        <Nations isGlobe={isGlobe} />
        <RoadsLayer />
        <ControlSectors />
        <TerritoryFragments />
        <Cities />
        <MarkersLayer />
        <Units />
        <GlobeEffects active={isGlobe} />
        <RegionPopup />
        <CountryInfoPanel />
        <UnitPopup />
        <FeaturePopup />
      </Map>
      <OperationalFrontRail />
      {isGlobe && (
        <canvas
          id="oh-globe-lighting"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      )}
      {loading && (
        <div style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 5,
          background: "rgba(0,0,0,0.6)",
          color: "#aab",
          padding: "6px 14px",
          borderRadius: 20,
          fontSize: 13,
          pointerEvents: "none",
          transition: "opacity 0.3s",
          backdropFilter: "blur(4px)",
        }}>
          Loading tiles…
        </div>
      )}
    </div>
  );
}

export default World;
