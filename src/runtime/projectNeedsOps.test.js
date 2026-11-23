/*! Open Historia — tests for project needs on the board's own machinery © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run with `npm ci && node --test src/runtime/projectNeedsOps.test.js`: the
// rules themselves are in projectNeeds.test.js; these check the engine keeps them.
import test from "node:test";
import assert from "node:assert/strict";

import { applyProjectOps, normalizeProjectEntry } from "./gameState.js";

const cart = (extra = {}) => normalizeProjectEntry({
  id: "project-cart",
  name: "Самоходная повозка",
  summary: "Опытная повозка на паровом ходу.",
  status: "active",
  progress: 40,
  needs: [
    { name: "Каучук", status: "missing", source: "Джурский лес, Темпест" },
    { name: "Сталь", status: "secured" },
  ],
  ...extra,
});

test("progress the model writes past an open need is held at the cap", () => {
  const [project] = applyProjectOps([cart()], [{ op: "update", projectId: "project-cart", name: "Самоходная повозка", progress: 95 }]);
  assert.equal(project.progress, 70);
  assert.equal(project.status, "active");
});

test("a completion with an open need is a stall, by update or by close", () => {
  const [byUpdate] = applyProjectOps([cart()], [{ op: "update", projectId: "project-cart", name: "Самоходная повозка", status: "complete", progress: 100 }]);
  assert.equal(byUpdate.status, "stalled");
  assert.equal(byUpdate.progress, 70);

  const [byClose] = applyProjectOps([cart()], [{ op: "complete", projectId: "project-cart", name: "Самоходная повозка", note: "Первый выезд." }]);
  assert.equal(byClose.status, "stalled");
  assert.equal(byClose.lastUpdate, "Первый выезд.");
});

test("securing the need in the same op lets it through", () => {
  const [project] = applyProjectOps([cart()], [{
    op: "update",
    projectId: "project-cart",
    name: "Самоходная повозка",
    progress: 100,
    status: "complete",
    needs: [{ name: "каучук", status: "secured", source: "договор с Темпестом" }],
  }]);
  assert.equal(project.status, "complete");
  assert.equal(project.progress, 100);
  assert.deepEqual(project.needs.map((need) => `${need.name}:${need.status}`), ["каучук:secured", "Сталь:secured"], "the need named again replaces its line; the other stays");
});

test("a new project opened complete with a need missing opens stalled", () => {
  const [project] = applyProjectOps([], [{
    op: "create",
    name: "Шины",
    summary: "Резиновые шины для повозки.",
    status: "complete",
    progress: 100,
    needs: [{ name: "Каучук", status: "missing" }],
  }]);
  assert.equal(project.status, "stalled");
  assert.equal(project.progress, 70);
});

test("a restated create merges needs instead of erasing them", () => {
  const [project] = applyProjectOps([cart()], [{ op: "create", name: "Самоходная повозка", needs: [{ name: "Мастер-котельщик", status: "partial" }] }]);
  assert.deepEqual(project.needs.map((need) => need.name), ["Каучук", "Сталь", "Мастер-котельщик"]);
});

test("a need marked dropped comes off the list and frees the entry", () => {
  const [project] = applyProjectOps([cart()], [{ op: "update", projectId: "project-cart", name: "Самоходная повозка", needs: [{ name: "Каучук", status: "dropped" }], progress: 90 }]);
  assert.deepEqual(project.needs.map((need) => need.name), ["Сталь"]);
  assert.equal(project.progress, 90);
});

test("a project without needs is untouched", () => {
  const plain = normalizeProjectEntry({ id: "p", name: "Канал", summary: "Канал.", status: "active", progress: 99 });
  assert.deepEqual(plain.needs, []);
  assert.equal(plain.progress, 99);
  const [done] = applyProjectOps([plain], [{ op: "complete", projectId: "p", name: "Канал" }]);
  assert.equal(done.status, "complete");
});
