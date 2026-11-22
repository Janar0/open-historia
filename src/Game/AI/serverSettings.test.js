/*! Open Historia — tests: whose endpoint, model and key a call goes out with on a shared server © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/serverSettings.test.js
//
// main.jsx cannot load under plain Node, so its own callOpenAICompatible is
// read from the file and run with the network stubbed out: what is tested is
// the request it would send, not a copy of its rules.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as serverSettings from "./serverSettings.js";

const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const normalizeEndpoint = (value) => (value ?? "").trim().replace(/\/$/, "");

const requestFor = async (entry, profile) => {
  const call = new Function(
    "stubs",
    `const { applyManagedProfile, getManagedOpenAICompatibleSettings, normalizeEndpoint, resolveModel,
      callOpenAIStyleChatCompletions, parseCustomParams, missingSetupError } = stubs;
    ${main.match(/^async function callOpenAICompatible[\s\S]*?^}/m)[0]}
    return callOpenAICompatible;`,
  )({
    ...serverSettings,
    getManagedOpenAICompatibleSettings: async () => profile,
    normalizeEndpoint,
    resolveModel: async (_provider, options) => options.entrySettings.model,
    callOpenAIStyleChatCompletions: async (options) => options,
    parseCustomParams: () => ({}),
    missingSetupError: (message) => new Error(message),
  });
  const { endpoint, model, headers } = await call("", [], {
    entrySettings: { id: "entry", provider: "openai-compatible", apiKey: "", customParams: "", ...entry },
  });
  return { endpoint, model, authorization: headers.Authorization };
};

const PROFILE = { managed: true, endpoint: "https://api.deepseek.com/", model: "deepseek-flash" };

test("an entry at another provider keeps its endpoint, model and key", async () => {
  assert.deepEqual(
    await requestFor({ endpoint: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash-0731", apiKey: "own" }, PROFILE),
    { endpoint: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash-0731", authorization: "Bearer own" },
  );
});

test("a local server further down the list is still asked itself", async () => {
  assert.deepEqual(
    await requestFor({ endpoint: "http://localhost:11434/v1", model: "qwen" }, PROFILE),
    { endpoint: "http://localhost:11434/v1", model: "qwen", authorization: undefined },
  );
});

test("an entry at the server's endpoint takes the admin's model and sends no key of its own", async () => {
  for (const endpoint of ["https://api.deepseek.com", "https://api.deepseek.com/"]) {
    assert.deepEqual(
      await requestFor({ endpoint, model: "older-model", apiKey: "own" }, PROFILE),
      { endpoint: "https://api.deepseek.com", model: "deepseek-flash", authorization: undefined },
    );
  }
});

test("a profile naming no model leaves the entry's", async () => {
  const sent = await requestFor({ endpoint: "https://api.deepseek.com", model: "picked" }, { ...PROFILE, model: "" });
  assert.equal(sent.model, "picked");
});

test("without a profile nothing changes", async () => {
  for (const profile of [null, { managed: false, endpoint: "" }]) {
    assert.deepEqual(
      await requestFor({ endpoint: "https://api.deepseek.com", model: "picked", apiKey: "own" }, profile),
      { endpoint: "https://api.deepseek.com", model: "picked", authorization: "Bearer own" },
    );
  }
});

test("only a keyless call to the server's own endpoint is given the server's key", () => {
  const relayed = (url, headers = {}) => serverSettings.managedRelayProfileFor(url, headers, PROFILE) === "openai-compatible";
  assert.equal(relayed("https://api.deepseek.com/chat/completions"), true);
  assert.equal(relayed("https://api.deepseek.com/models"), true);
  // The player's own entries that share the host or the URL.
  assert.equal(relayed("https://api.deepseek.com/v1/chat/completions"), false);
  assert.equal(relayed("https://api.deepseek.com/anthropic/messages"), false);
  assert.equal(relayed("https://api.deepseek.com/chat/completions", { Authorization: "Bearer own" }), false);
  assert.equal(relayed("https://openrouter.ai/api/v1/chat/completions"), false);
});

test("the faster-turns offer names the model that answered", () => {
  const getSuggestion = new Function(
    "stubs",
    `const { applyManagedProfile, getResolvedFallbackList, structuredModeObserver, describeEntry } = stubs;
    ${main.match(/^export const getStructuredModeSuggestion[\s\S]*?^};/m)[0].replace("export ", "")}
    return getStructuredModeSuggestion;`,
  )({
    applyManagedProfile: (entry) => serverSettings.applyManagedProfile?.(entry, PROFILE) ?? entry,
    getResolvedFallbackList: () => [{ id: "entry", provider: "openai-compatible", endpoint: "https://api.deepseek.com", model: "older-model", connectionName: "DeepSeek", label: "older-model (DeepSeek)" }],
    structuredModeObserver: { shouldSuggest: () => "json_object" },
    describeEntry: (model, name) => `${model} (${name})`,
  });
  assert.equal(getSuggestion().label, "deepseek-flash (DeepSeek)");
});
