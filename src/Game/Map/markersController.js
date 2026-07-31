/*! Open Historia — player map markers and AI identification queue © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import {
  normalizeMarkerEntry,
  readActionsState,
  readGameData,
  readWorldState,
  writeActionsState,
  writeWorldState,
} from "../../runtime/gameState.js";

let interactionMode = { kind: "idle" };
const listeners = new Set();

const emit = () => {
  for (const listener of [...listeners]) {
    try {
      listener(interactionMode);
    } catch (error) {
      console.error("map marker listener failed:", error);
    }
  }
};

export const subscribeMarkerMode = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getMarkerInteractionMode = () => interactionMode;

export const setMarkerInteractionMode = (next) => {
  interactionMode = next && next.kind ? next : { kind: "idle" };
  emit();
};

export const clearMarkerInteractionMode = () => setMarkerInteractionMode({ kind: "idle" });

const queueMarkerForAI = async (marker) => {
  try {
    const actions = await readActionsState({ force: true });
    actions.push({
      id: marker.id,
      kind: "action",
      source: "map-marker",
      status: "planned",
      title: `Identify map marker: ${marker.name}`,
      text:
        `The player placed map marker ${marker.name} (id ${marker.id}) at ` +
        `lat ${marker.lat.toFixed(4)}, lng ${marker.lng.toFixed(4)}. ` +
        "Treat it as an observation or intended point on the map. Identify, rename, classify, or annotate it with markerOps when the surrounding context makes that possible; do not invent a duplicate nearby.",
    });
    await writeActionsState(actions);
  } catch (error) {
    console.error("Failed to queue map marker for AI:", error);
  }
};

export const placePlayerMarker = async ({ name, kind = "point", lng, lat }) => {
  const [world, game] = await Promise.all([
    readWorldState({ force: true }),
    readGameData({ force: true }),
  ]);
  const marker = normalizeMarkerEntry({
    name,
    kind,
    lng,
    lat,
    ownerCode: game.country || "PLAYER",
    source: "player",
    status: "pending",
    note: "Player-placed point awaiting AI identification.",
  });
  if (!marker) return null;
  await writeWorldState({ ...world, markers: [...world.markers, marker] });
  await queueMarkerForAI(marker);
  return marker;
};

export const removePlayerMarker = async (markerId) => {
  const id = String(markerId ?? "").trim();
  if (!id) return false;
  const world = await readWorldState({ force: true });
  const marker = world.markers.find((entry) => entry.id === id);
  if (!marker || marker.source !== "player") return false;
  await writeWorldState({ ...world, markers: world.markers.filter((entry) => entry.id !== id) });
  return true;
};
