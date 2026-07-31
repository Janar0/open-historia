import test from "node:test";
import assert from "node:assert/strict";
import {
  isLoopbackBindHost,
  isValidApiKey,
} from "./auth.js";

test("shared API keys are compared exactly and accept a safe length", () => {
  const key = "0123456789abcdef0123456789abcdef";
  assert.equal(isValidApiKey(key, key), true);
  assert.equal(isValidApiKey(`${key}x`, key), false);
  assert.equal(isValidApiKey(key.slice(0, -1), key), false);
  assert.equal(isValidApiKey("short", key), false);
});

test("the server recognises loopback binds and rejects wildcard/LAN intent", () => {
  assert.equal(isLoopbackBindHost("127.0.0.1"), true);
  assert.equal(isLoopbackBindHost("localhost"), true);
  assert.equal(isLoopbackBindHost("[::1]"), true);
  assert.equal(isLoopbackBindHost("0.0.0.0"), false);
  assert.equal(isLoopbackBindHost("192.168.1.20"), false);
});
