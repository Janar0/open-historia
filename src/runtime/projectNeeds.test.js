/*! Open Historia — tests for what a project needs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROJECT_NEEDS,
  describeNeedsForPrompt,
  holdUnmetCompletion,
  holdingNeed,
  mergeProjectNeeds,
  needsAllowCompletion,
  needsCap,
  normalizeProjectNeeds,
  progressWithinNeeds,
} from "./projectNeeds.js";

const rubber = { name: "Каучук", status: "missing", source: "Джурский лес, Темпест" };
const steel = { name: "Сталь", status: "partial", source: "кузни Дваргона" };
const smith = { name: "Кузнец", status: "secured" };

test("needs are cleaned, keyed by name and capped", () => {
  const needs = normalizeProjectNeeds([
    rubber, "Стекло", { name: "  " }, { material: "Сталь", state: "scarce" }, { name: "каучук", status: "have" },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `x${i}` })),
  ]);
  assert.equal(needs.length, MAX_PROJECT_NEEDS);
  assert.deepEqual(needs[0], { name: "каучук", status: "secured", source: "Джурский лес, Темпест" }, "the later line on a name wins, keeping what it left out");
  assert.deepEqual(needs[1], { name: "Стекло", status: "missing" }, "a bare name is a missing need");
  assert.equal(needs[2].status, "partial", "the model's own words map onto the three");
  assert.deepEqual(normalizeProjectNeeds(null), []);
});

test("the cap follows the worst open need", () => {
  assert.equal(needsCap([]), 100);
  assert.equal(needsCap([smith]), 100);
  assert.equal(needsCap([steel, smith]), 90);
  assert.equal(needsCap([steel, rubber]), 70);
  assert.equal(holdingNeed([steel, rubber]).name, "Каучук", "a missing need holds before a partial one");
  assert.equal(holdingNeed([smith]), null);
  assert.equal(needsAllowCompletion([smith]), true);
  assert.equal(needsAllowCompletion([steel]), false);
});

test("progress is held at the cap, but a finished project keeps its 100", () => {
  assert.equal(progressWithinNeeds(95, [rubber]), 70);
  assert.equal(progressWithinNeeds(50, [rubber]), 50);
  assert.equal(progressWithinNeeds(95, [steel]), 90);
  assert.equal(progressWithinNeeds(100, [rubber], "complete"), 100);
  assert.equal(progressWithinNeeds("junk", []), 0);
});

test("a completion with an open need becomes a stall at the cap", () => {
  const held = holdUnmetCompletion({ status: "active", progress: 60 }, { status: "complete", progress: 100, needs: [rubber] });
  assert.equal(held.status, "stalled");
  assert.equal(held.progress, 70);
  const done = { status: "complete", progress: 100, needs: [smith] };
  assert.equal(holdUnmetCompletion({ status: "active" }, done), done, "everything secured: it completes");
  const already = { status: "complete", progress: 100, needs: [rubber] };
  assert.equal(holdUnmetCompletion({ status: "complete" }, already), already, "what was finished stays finished");
  assert.equal(holdUnmetCompletion(null, { status: "active", needs: [rubber] }).status, "active");
});

test("a changed list is laid over the board's, not swapped for it", () => {
  const merged = mergeProjectNeeds([rubber, steel, smith], [{ name: "сталь", status: "secured", source: "купец из Блюмунда" }, { name: "Стекло" }]);
  assert.deepEqual(merged.map((need) => `${need.name}:${need.status}`), ["Каучук:missing", "сталь:secured", "Кузнец:secured", "Стекло:missing"]);
  assert.equal(merged[1].source, "купец из Блюмунда");
  const dropped = mergeProjectNeeds([rubber, steel], [{ name: "Каучук", status: "dropped" }]);
  assert.deepEqual(dropped.map((need) => need.name), ["Сталь"]);
  assert.deepEqual(mergeProjectNeeds([rubber], undefined).map((need) => need.name), ["Каучук"]);
});

test("the prompt names each need, its source and what holds the entry", () => {
  const text = describeNeedsForPrompt({ needs: [rubber, smith] });
  assert.match(text, /^Needs: Каучук \(MISSING; from Джурский лес, Темпест\), Кузнец \(secured\)\./);
  assert.match(text, /HELD: it cannot pass 70% or be completed until Каучук is secured\./);
  assert.equal(describeNeedsForPrompt({ needs: [smith] }), "Needs: Кузнец (secured).");
  assert.equal(describeNeedsForPrompt({}), "");
});
