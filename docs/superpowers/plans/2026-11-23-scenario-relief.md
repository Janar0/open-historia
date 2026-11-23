# Scenario Relief and Rivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hillshaded relief and rivers over a painted (image-background) scenario map, Octagram first.

**Architecture:** An offline Node script turns the scenario's picture plus a hand sketch into `relief.json` (a 16-bit heightmap and river/lake GeoJSON). The server serves it as one more scenario JSON asset. The game builds terrarium DEM tiles from it in the browser through an `ohdem://` protocol, draws a MapLibre `hillshade` layer and river/lake layers above the political fills, and lightens the fills while relief shows.

**Tech Stack:** Node 26 + `sharp` (script), MapLibre GL (upstream fork) `addProtocol`, React, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-23-scenario-relief-design.md`

## Global Constraints

- New files carry the house banner: `/*! Open Historia — (what it is) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */`
- No gradients, no purple (`src/noGradients.test.js`).
- Protocol name `ohdem` (not `ohrelief`, taken by `scenarioTerrain.js`).
- Relief is off when Settings → Map scenario terrain is `"painted"` (`SCENARIO_TERRAIN_PAINTED`, `wantsScenarioTerrain`).
- Heightmap stored at half the picture's resolution, 16-bit greyscale PNG, base64.
- A scenario without `relief.json` renders exactly as today.
- Pure logic modules are import-free and tested under bare `node --test`.

## Review Focus

- A scenario with no `relief.json` (server answers an empty FeatureCollection): no relief source, no errors.
- A tile requested outside the heightmap's bounds or at the map's edge: sea-level tile, no seam.
- The player switches Settings → Map to "Painted": relief and rivers disappear without reload.
- Zoomed out to the whole continent: relief must not darken the map into mud (exaggeration ramp low at low zoom).
- The picture's frame and torn-paper border must not become land.

---

### Task 1: Relief core (land mask, heightmap, rivers, encoding)

**Files:**
- Create: `scripts/relief/reliefCore.mjs` (import-free, pure functions on typed arrays)
- Test: `scripts/relief/reliefCore.test.mjs`

**Interfaces:**
- Produces:
  - `landMask(rgba: Uint8Array, width, height, { frame: {x0,y0,x1,y1} }) -> Uint8Array` (1 land, 0 sea; two-means on colour, sea = the cluster dominating the frame's inner margin; open/close by 2 px; outside frame = 0)
  - `buildHeightmap(mask, width, height, sketch, { seed }) -> Float32Array` metres; sea 0; coast distance base up to 300 m; ranges (polylines `{points, crest, width}`), peaks (`{x,y,height,radius}`), basins/lakes (`{polygon, level}`) per spec; fBm hills; rivers from `sketch.rivers` carved 30–80 m.
  - `routeRivers(height, mask, width, height2, { threshold, keep: sketchRivers }) -> Array<{ points: [x,y][], flow: number }>` (priority-flood fill, D8 flow, accumulation; threshold in cells)
  - `encodeHeight16(height: Float32Array, maxMetres) -> Uint16Array`
  - `pixelToLngLat(x, y, width, height, bounds) -> [lng, lat]` (Mercator, as `server/mapProjection.js imageQuad` places the picture)

- [ ] **Step 1: Write the failing tests** — `landMask` on a synthetic 40×30 image (parchment `#e8d9b0` sea, brown `#a67c52` blob land, dark frame 2 px) returns land for the blob only and 0 on the frame; `buildHeightmap` with one peak `{x:20,y:15,height:2000,radius:6}` gives max ≥ 1800 at the peak and 0 on sea; `routeRivers` on a tilted plane with a ridge yields ≥1 river whose last point is on the sea edge and whose flow increases downstream; `encodeHeight16` maps 0→0 and maxMetres→65535; `pixelToLngLat` maps the centre of a square picture with bounds ±180/±85.0511 to `[0, 0]` (±1e-6).
- [ ] **Step 2: Run** `node --test scripts/relief/reliefCore.test.mjs` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the five functions in `scripts/relief/reliefCore.mjs`. Seeded noise: a small mulberry32 + value noise, no dependencies.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `feat: relief core — land mask, heightmap and rivers for painted maps`

### Task 2: Build script and the Octagram sketch

**Files:**
- Create: `scripts/relief/build-relief.mjs` (CLI: `--background <background.json> --sketch <sketch.json> --bounds <world.json> --out <relief.json> [--seed N]`)
- Create: `scripts/relief/sketches/tensura-octagram.json` (frame, ranges, peaks, basins, lakes, rivers in picture pixels, traced off `octagram-bg.png`)

**Interfaces:**
- Consumes: Task 1 functions.
- Produces: `relief.json` = `{ version: 1, kind: "relief", bounds: {west,south,east,north}, width, height, maxMetres, heightmap: "data:image/png;base64,…", rivers: FeatureCollection<LineString,{flow}>, lakes: FeatureCollection<Polygon> }`. Absent keys ⇒ no relief.

- [ ] **Step 1:** Decode the picture with `sharp`, downscale ×0.5, run Task 1, write the 16-bit PNG with `sharp(raw, {raw:{width,height,channels:1}}).toColourspace("grey16")`, convert rivers/lakes to lng/lat.
- [ ] **Step 2:** Author the sketch; render a debug PNG (`--debug out.png`: hillshade + rivers over the picture) and look at it; adjust until mountains sit on painted mountains and painted rivers/lakes match.
- [ ] **Step 3:** Run on the local copy; check `relief.json` < 6 MB.
- [ ] **Step 4: Commit** `feat: relief build script and the Octagram terrain sketch`

### Task 3: Serve `relief.json`

**Files:**
- Modify: `server/libraryStore.js` `SCENARIO_GEOJSON_ASSET_FILES` (+ `reliefData: "relief.json"`)
- Modify: `src/runtime/assets.js` `JSON_URLS` (+ `reliefData`, set beside `backgroundData`)
- Test: extend an existing libraryStore asset test or add `server/reliefAsset.test.js`: missing file ⇒ empty FeatureCollection; present ⇒ streamed as written.

- [ ] Steps: failing test → add key → pass → commit `feat: serve a scenario's relief asset`.

### Task 4: Draw relief and rivers

**Files:**
- Create: `src/Game/Map/reliefDem.js` (import-free: `demTile(grid, {z,x,y}, bounds, {size=256, detail}) -> Uint8ClampedArray` terrarium RGBA; bilinear sample + zoom-scaled detail noise; outside bounds/land ⇒ 0 m)
- Create: `src/Game/Map/reliefDem.test.js`
- Create: `src/Game/Map/ReliefLayers.jsx` (loads `JSON_URLS.reliefData` once per scenario, decodes the PNG to a grid via `createImageBitmap` + canvas, registers `ohdem` protocol once, adds `raster-dem` source + `hillshade` layer + river line + lake fill, all `beforeId: "polity-boundaries-shadow"`; hidden when `!wantsScenarioTerrain(setting)`)
- Modify: `src/Game/Map/Map.jsx` or the component that mounts map layers (one line to mount `<ReliefLayers />` for image backgrounds)
- Modify: `src/Game/Map/Nations.jsx` fill opacity: use the lighter relief ramp when relief is active (reuse the existing `fillOpacity` path)

- [ ] **Step 1: Failing tests** for `demTile`: a grid of constant 1000 m inside bounds gives every pixel decoding (terrarium `r*256+g+b/256-32768`) to 1000±1 at detail 0; a tile entirely outside bounds decodes to 0; two adjacent tiles agree on their shared edge within 1 m.
- [ ] **Step 2–4:** implement, pass.
- [ ] **Step 5:** build, run the local server, look at Octagram at continent, country and province zoom; tune exaggeration/colours/river widths.
- [ ] **Step 6: Commit** `feat: relief and rivers over painted scenario maps`

### Task 5: Notice, catalog, full checks

- [ ] Minor notice entry at top of `NEW_UPDATES` (plain card, no theme), strings to `public/lang/catalog-en.json` + `ru.json`.
- [ ] `npm test` all pass; `npx eslint` on new files 0 errors; `npm run build`.
- [ ] Commit `docs: update notice for relief on painted maps`.
