# Relief and rivers for a painted scenario map

Date: 2026-11-23. Fork-only work (Janar0/open-historia), not for upstream.

## Intent

The owner plays a person-sized campaign (a princess in a small coastal kingdom) on the
Octagram scenario, whose map is one painted picture (2641×2035 px) stretched over the
whole world. Zoomed in on a country the size of Malukshure, the picture has no detail:
it used to break into coloured squares (fixed: the image layer now resamples linearly)
and now blurs. The owner wants **a sense of place**: relief you can feel (mountains,
hills, valleys) and rivers, crisp at any zoom, on top of the picture they already have.

Chosen approach (2 of 3 offered): real relief over the painting.

## Goals

- Hillshaded relief on painted (image-background) scenarios, sharp at every zoom from
  the whole continent down to a single province.
- Rivers and lakes as vector lines/areas that follow the relief, readable at close zoom.
- Mountains where the picture and the canon put them (Dwargon's peaks, the Kanaat
  ranges, the northern ice continent's ridges, the volcanoes), lowlands where it paints
  plains and forest (the Jura forest basin around Lake Siss).
- Works for the Octagram scenario on the owner's server, through the existing scenario
  asset pipeline, with nothing for a player to download separately.

## Non-goals

- No 3D terrain mesh, no change to the Earth (stock) maps or vector/FMG backgrounds.
- No gameplay effect: the war engine's terrain, movement and supply are untouched.
- No new cities or region borders (a separate task if wanted).
- No editor UI for drawing relief in this round: the relief is produced by a script.

## Anti-goals

- The political colours must stay readable: relief must not turn the map into mud.
- No rectangular veil or seams at tile edges (upstream removed an old DEM overlay for that).
- No large downloads: the relief asset stays a few MB.
- Nothing may contradict the painting badly: no mountain range across a painted plain.

## How it works

### 1. The relief asset (generated offline, one per scenario)

A script, `scripts/relief/build-relief.mjs`, reads the scenario's background picture and
a small hand-written **terrain sketch** and writes `relief.json` next to `background.json`
in the scenario's folder:

- **Land mask** from the picture: sea is the parchment colour, land is everything else
  inside the frame (two-means on colour, like the editor's "Fit to background"), cleaned
  with a morphological open/close and restricted to the picture's map area.
- **Terrain sketch** (`scripts/relief/sketches/<scenario>.json`, authored by hand by
  looking at the picture and the canon): mountain ranges as polylines with crest height
  and width, single peaks/volcanoes as points with height and radius, plateaus and
  lowland basins as polygons with a target height, lakes as polygons. Coordinates are in
  the picture's pixel space, so they are traced straight off the painting.
- **Heightmap**: base height rises with distance from the coast; ranges add ridged noise
  along their crest falling off with distance; peaks add cones with rough flanks;
  basins and lakes are flattened to their level; fBm noise everywhere for hills. Stored
  as a 16-bit greyscale PNG at half the picture's resolution (about 1320 × 1018, so the
  asset stays a few MB; the browser's detail noise supplies what is finer), base64 in
  `relief.json`, with the bounds it covers and the metres one unit stands for.
- **Painted rivers first**: the sketch also carries the rivers the picture paints, traced
  as polylines; the heightmap is carved along them so they run in valleys, and they are
  kept as drawn. Then the rest:
- **Rivers**: water is routed downhill on the heightmap (depressions filled), flow is
  accumulated, and cells above a threshold become river lines, simplified and smoothed,
  each with a `flow` value for its width; lakes from the sketch are their own polygons and
  rivers end in them or the sea. Stored as GeoJSON in `relief.json`, in map coordinates.
- Deterministic: the same picture, sketch and seed give the same asset.

### 2. Serving it

`relief.json` is a scenario asset like `background.json`: one more key in the asset table
(`server/libraryStore.js`, `reliefData: "relief.json"`), read through the runtime JSON
route, falling back from game to scenario as the other assets do. A scenario without it
shows exactly what it shows today.

### 3. Drawing it (`src/Game/Map/`)

- A tile protocol, `ohdem://{z}/{x}/{y}` (not `ohrelief`, which the existing Tiled
  Basemap relief in `scenarioTerrain.js` already uses), builds **terrarium-encoded DEM tiles in the
  browser** from the heightmap: bilinear samples of the stored grid, plus deterministic
  detail noise whose amplitude shrinks with zoom, so a province zoomed in shows small hills
  and gullies instead of a smooth blur. Tiles outside the land mask are sea level. Tiles
  are made in a worker or on an OffscreenCanvas and cached.
- A `raster-dem` source on that protocol and a **`hillshade` layer** placed above the
  region fills and below the borders and labels (before `polity-boundaries-shadow`),
  with warm parchment highlight/shadow colours that suit the painting, exaggeration
  rising with zoom, and Reduce motion irrelevant (it is static).
- **Rivers**: a line layer (width by `flow` and zoom, blue-grey ink colour, round caps)
  and a lake fill layer, both above the fills and below borders and labels.
- No new setting: the existing Settings → Map choice that turns scenario relief off
  ("Painted", `SCENARIO_TERRAIN_PAINTED`) turns this off too, so players have one switch.
- While the relief shows, the political fills use the lighter zoom ramp the existing
  scenario relief already uses (`fillOpacity` stops), so the colours stay readable and the
  relief reads through them at close zoom.

### 4. Octagram content

A sketch for the Octagram picture: Dwargon's massif and its northern spurs, the
Kanaat/Canaat ranges along the Jura forest's west, the ridges of the western lands
(Ingrassia/Western Nations hills), the northern ice continent's mountains, the eastern
volcano, the southern island's volcanoes, the Jura forest basin and Lake Siss, the other
painted lakes, and the river painted in the east. Malukshure's coast gets coastal hills
so it is not flat.

## Constraints

- MapLibre (upstream's fork) with `addProtocol`; `sharp` is available for the script.
- Must survive upstream syncs: new files where possible, small edits to `World.jsx`,
  `libraryStore.js`, `assets.js`, settings.
- The fork's convention: tests under `node --test`, no gradients, no purple, banners.
- The production server serves the scenario from `/root/historia/open-historia-data`;
  the asset is written there by copying `relief.json` into the scenario folder.

## Calls made in review (the author's, open to the owner)

- Built beside the existing Tiled Basemap relief, sharing its setting and fill ramp.
- Sources: the Octagram picture (copied from the owner's server for the build) and the
  author's knowledge of the Tensura setting; the sketch follows the picture where the two differ.
- Painted rivers are traced and kept; routed rivers only add to them.
- A plain minor update notice, no custom theme (the owner asked for no notice art on fork work).
- `relief.json` lives on the owner's server only: it is not added to scenario export,
  import or hub bundles in this round.
- Deploying it to the server is the owner's call, asked for when the build is done.

## Left to the builder

- Exact noise functions, thresholds, colours and zoom ramps, tuned by looking at it.
- Whether tile generation runs in a worker or on the main thread with caching.
- The sketch's exact coordinates.
- Test coverage: the pure parts (land mask, routing, encoding) get unit tests.
