import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createAISettingsStore } from "./aiSettings.js";

test("AI settings support a global profile and per-user overrides without exposing keys", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-ai-settings-"));
  try {
    const store = createAISettingsStore(dataDir);
    store.saveAdmin({
      mode: "global",
      global: {
        apiKey: "global-secret",
        endpoint: "https://ai.example/v1",
        model: "qwen",
      },
      users: {
        "user-1": { apiKey: "user-secret", endpoint: "https://user.example/v1", model: "llama" },
      },
    });

    assert.deepEqual(store.getPublic("user-1"), {
      apiKeyConfigured: true,
      endpoint: "https://ai.example/v1",
      managed: true,
      mode: "global",
      model: "qwen",
      source: "global",
    });
    assert.equal(store.getEffective("user-1").apiKey, "global-secret");
    assert.equal(store.getAdmin().global.apiKeyConfigured, true);
    assert.equal("apiKey" in store.getAdmin().global, false);

    store.saveAdmin({ mode: "per-user", users: { "user-1": { clearApiKey: true, endpoint: "", model: "" } } });
    assert.equal(store.getEffective("user-1").apiKey, "");
    assert.equal(store.getEffective("user-1").endpoint, "");
    assert.equal(store.getPublic("user-1").managed, false);

    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "ai-settings.json"), "utf8"));
    assert.equal(persisted.global.apiKey, "global-secret");
    assert.equal(persisted.users["user-1"].apiKey, "");
    assert.equal((fs.statSync(path.join(dataDir, "ai-settings.json")).mode & 0o777), 0o600);
  } finally {
    fs.rmSync(dataDir, { force: true, recursive: true });
  }
});

test("AI settings reject non-http endpoints", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-ai-settings-"));
  const store = createAISettingsStore(dataDir);
  try {
    assert.throws(
      () => store.saveAdmin({ global: { endpoint: "file:///tmp/model" } }),
      /must start with http/,
    );
  } finally {
    fs.rmSync(dataDir, { force: true, recursive: true });
  }
});
