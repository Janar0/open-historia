import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCountryDiplomaticMemoryText,
  parseDiplomaticResponse,
} from "../src/Game/AI/diplomaticMemory.js";
import { normalizeChatEntry, normalizeWorldState } from "../src/runtime/gameState.js";

const chats = [{
  id: "german-talks",
  title: "Border settlement",
  status: "closed",
  countries: [{ name: "Germany", code: "DEU" }],
  messages: [
    { role: "user", speaker: "Poland", text: "We ask for a border guarantee." },
    { role: "leader", speaker: "Germany", text: "We promise to respect the border for five years." },
  ],
  memories: {
    Germany: {
      summary: "Germany discussed a five-year border settlement with Poland.",
      commitments: ["Respect the Polish border for five years."],
      stance: "Cautious cooperation with Poland.",
      updatedAt: "1940-01-01",
    },
  },
}, {
  id: "french-talks",
  countries: [{ name: "France", code: "FRA" }],
  messages: [{ role: "leader", speaker: "France", text: "France threatens sanctions." }],
}];

test("each country receives only its own persistent diplomatic memory", () => {
  const german = buildCountryDiplomaticMemoryText(chats, "Germany");
  assert.match(german, /five-year border settlement/);
  assert.match(german, /promise to respect the border/);
  assert.doesNotMatch(german, /France threatens sanctions/);

  const french = buildCountryDiplomaticMemoryText(chats, "France");
  assert.match(french, /France threatens sanctions/);
  assert.doesNotMatch(french, /five-year border settlement/);
});

test("leader reply metadata is hidden and returned as structured memory", () => {
  const parsed = parseDiplomaticResponse([
    "We will honor the agreement.",
    'MEMORY_UPDATE:{"summary":"The agreement remains active.","commitments":["Honor the border agreement."],"stance":"Cooperative."}',
    "REACTION:🤝",
  ].join("\n"));

  assert.equal(parsed.reply, "We will honor the agreement.");
  assert.equal(parsed.reaction, "🤝");
  assert.equal(parsed.memory.summary, "The agreement remains active.");
  assert.deepEqual(parsed.memory.commitments, ["Honor the border agreement."]);
});

test("chat normalization persists bounded per-country memories", () => {
  const normalized = normalizeChatEntry(chats[0]);
  assert.equal(normalized.memories.Germany.summary, "Germany discussed a five-year border settlement with Poland.");
  assert.deepEqual(normalized.memories.Germany.commitments, ["Respect the Polish border for five years."]);
});

test("country memory survives independently of deleted chat threads", () => {
  const world = normalizeWorldState({ diplomaticMemory: chats[0].memories });
  const memory = buildCountryDiplomaticMemoryText([], "Germany", {
    countryMemories: world.diplomaticMemory,
  });
  assert.match(memory, /five-year border settlement/);
  assert.match(memory, /Respect the Polish border/);
});
