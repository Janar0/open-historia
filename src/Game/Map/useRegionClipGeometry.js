/*! Open Historia — loaded-region geometry for clipping tactical overlays © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import polygonClipping from "polygon-clipping";

const asMultiPolygon = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

const featureRegionId = (feature) => String(
  feature?.properties?.GID_1
    ?? feature?.properties?.id
    ?? feature?.id
    ?? "",
).trim();

const queryRegion = (map, sourceId, regionId, sourceLayer) => {
  if (!map.getSource(sourceId)) return [];
  try {
    const options = {
      filter: ["any",
        ["==", ["get", "GID_1"], regionId],
        ["==", ["get", "id"], regionId],
      ],
      ...(sourceLayer ? { sourceLayer } : {}),
    };
    return map.querySourceFeatures(sourceId, options)
      .filter((feature) => featureRegionId(feature) === regionId);
  } catch {
    return [];
  }
};

const mergeRegionFeatures = (features) => {
  const geometries = features.flatMap((feature) => asMultiPolygon(feature.geometry));
  if (!geometries.length) return null;
  try {
    return polygonClipping.union(...geometries.map((polygon) => [polygon]));
  } catch {
    return geometries;
  }
};

const clipSignature = (clips) => {
  const parts = [];
  for (const [regionId, multiPolygon] of clips) {
    let points = 0;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    let checksum = 0;
    for (const polygon of multiPolygon) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          points += 1;
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
          checksum += lng * 31 + lat * 17;
        }
      }
    }
    parts.push([regionId, multiPolygon.length, points, minLng, minLat, maxLng, maxLat, Math.round(checksum * 1e4)]);
  }
  return JSON.stringify(parts);
};

// Vector regions arrive tile-by-tile, so the clip cache follows source-data and
// settled camera events. Until the containing region is loaded callers simply
// render their original geometry; there is no tactical-overlay flicker.
export const useRegionClipGeometry = (regionIds) => {
  const maps = useMap();
  const map = maps?.current?.getMap?.() ?? maps?.current;
  const idsKey = useMemo(
    () => [...new Set((regionIds || []).map((value) => String(value ?? "").trim()).filter(Boolean))].sort().join("\u0000"),
    [regionIds],
  );
  const [clips, setClips] = useState(() => new Map());
  const signatureRef = useRef("");

  useEffect(() => {
    if (!map || !idsKey) {
      setClips(new Map());
      signatureRef.current = "";
      return undefined;
    }
    const ids = idsKey.split("\u0000");
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = new Map();
        for (const regionId of ids) {
          const stock = queryRegion(map, "regions-source", regionId, "regions");
          const custom = queryRegion(map, "custom-regions-source", regionId);
          const merged = mergeRegionFeatures([...stock, ...custom]);
          if (merged?.length) next.set(regionId, merged);
        }
        const signature = clipSignature(next);
        if (signature !== signatureRef.current) {
          signatureRef.current = signature;
          setClips(next);
        }
      });
    };
    refresh();
    const onSourceData = (event) => {
      if (["regions-source", "custom-regions-source"].includes(event.sourceId)) refresh();
    };
    map.on("idle", refresh);
    map.on("sourcedata", onSourceData);
    map.on("moveend", refresh);
    return () => {
      cancelAnimationFrame(frame);
      map.off("idle", refresh);
      map.off("sourcedata", onSourceData);
      map.off("moveend", refresh);
    };
  }, [idsKey, map]);

  return clips;
};

export const clipRingToRegion = (ring, regionGeometry) => {
  if (!ring || !regionGeometry?.length) return ring ? [[ring]] : [];
  try {
    return polygonClipping.intersection([[ring]], regionGeometry);
  } catch {
    return [[ring]];
  }
};
