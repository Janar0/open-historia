import assert from "node:assert/strict";
import test from "node:test";

import { getGameplayTool } from "../src/Game/AI/gameplaySchemas.js";
import {
  compactConversationHistory,
  compactRetryAnswer,
  compactToolForRequest,
  outputTokenBudgetForTask,
  shouldUseTaskReasoning,
} from "../src/Game/AI/tokenBudget.js";

test("large mutation tools drop duplicated nested descriptions on the wire", () => {
  const full = getGameplayTool("jumpForward");
  const compact = compactToolForRequest(full);
  const fullSize = JSON.stringify(full).length;
  const compactSize = JSON.stringify(compact).length;

  assert.ok(fullSize > 40000);
  assert.ok(compactSize < fullSize * 0.6);
  assert.equal(compact.schema.description, full.schema.description);
  assert.equal(compact.schema.properties.events.description, "Events occurring during the simulated period.");
  assert.equal(compact.schema.properties.events.items.properties.impacts.properties.regionTransfers.description, undefined);
  assert.equal(full.schema.properties.events.description, "Events occurring during the simulated period.");
});

test("small tools keep their semantic descriptions", () => {
  const full = getGameplayTool("nextSpeaker");
  assert.equal(compactToolForRequest(full), full);
});

test("task budgets distinguish cheap transforms from open-ended simulations", () => {
  assert.equal(outputTokenBudgetForTask("nextSpeaker"), 192);
  assert.equal(outputTokenBudgetForTask("eventConsolidator"), 1536);
  assert.equal(outputTokenBudgetForTask("jumpForward"), undefined);
  assert.equal(shouldUseTaskReasoning("nextSpeaker"), false);
  assert.equal(shouldUseTaskReasoning("actions"), "low");
  assert.equal(shouldUseTaskReasoning("jumpForward"), true);
});

test("retry and live-chat context keep recent signal inside fixed bounds", () => {
  const longAnswer = `${"a".repeat(10000)}TAIL`;
  const retry = compactRetryAnswer(longAnswer, 1000);
  assert.ok(retry.length <= 1000);
  assert.match(retry, /context clipped/);
  assert.match(retry, /TAIL$/);

  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? "model" : "user",
    parts: [{ text: `message-${index}-${"x".repeat(300)}` }],
  }));
  const compact = compactConversationHistory(history, {
    maxChars: 900,
    maxMessageChars: 400,
    maxMessages: 6,
  });
  assert.ok(compact.length <= 6);
  assert.ok(compact.reduce((sum, entry) => sum + entry.parts[0].text.length, 0) <= 900);
  assert.match(compact.at(-1).parts[0].text, /^message-19-/);
});
