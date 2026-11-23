/*! Open Historia — tests for a painted scenario's relief asset © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// relief.json (scripts/relief/build-relief.mjs) is served like background.json:
// from the scenario's folder, as the runtime's `reliefData`, and as an empty
// collection where a scenario has none, so the game draws no relief.
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time (the same harness as scenarioTerrainTiles.test.js).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};

const buildDataDir = ({ relief = null } = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-relief-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "painted");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "painted", name: "Painted World", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA, customRegions: true, background: { kind: "image", bounds: { west: -180, south: -80, east: 180, north: 80 } } });
  writeJson(path.join(scenarioDir, "background.json"), { dataUrl: "data:image/png;base64,AA==" });
  writeJson(path.join(scenarioDir, "game.json"), { country: "Testland", gameDate: "1000-01-01" });
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
  if (relief) writeJson(path.join(scenarioDir, "relief.json"), relief);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["painted"], selectedScenarioId: "painted", version: 2 });
  return root;
};

const readRelief = (root) => {
  const script = [
    `const store = await import(${JSON.stringify(STORE_URL)});`,
    `const fs = await import("node:fs");`,
    `store.createGame({ name: "Test", scenarioId: "painted", setActive: true });`,
    `const asset = store.resolveRuntimeGeojsonAsset("reliefData");`,
    `const data = asset?.sourcePath ? JSON.parse(fs.readFileSync(asset.sourcePath, "utf-8")) : store.readRuntimeJsonAsset("reliefData").data;`,
    `process.stdout.write("\\n@@" + JSON.stringify(data));`,
  ].join("\n");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root, OH_ASSETS_DIR: path.join(root, "no-stock-assets") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a scenario's relief.json is served as written", () => {
  const relief = { version: 1, kind: "relief", width: 2, height: 2, heightmap: "data:image/png;base64,AA==", rivers: { type: "FeatureCollection", features: [] } };
  assert.deepEqual(readRelief(buildDataDir({ relief })), relief);
});

test("a scenario without one gets nothing to draw", () => {
  const data = readRelief(buildDataDir());
  assert.equal(data.heightmap, undefined);
  assert.deepEqual(data.features ?? [], []);
});
