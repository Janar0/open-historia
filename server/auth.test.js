import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_COOKIE,
  accessCookieValue,
  hasValidAccessCookie,
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

test("the access cookie stands for the key without holding it, and follows the key", () => {
  const key = "0123456789abcdef0123456789abcdef";
  const value = accessCookieValue(key);
  assert.match(value, /^[0-9a-f]{64}$/);
  assert.equal(value.includes(key), false);
  assert.notEqual(value, accessCookieValue(`${key}x`));

  const withCookie = (cookie) => ({ headers: { cookie } });
  assert.equal(hasValidAccessCookie(withCookie(`a=b; ${ACCESS_COOKIE}=${value}; c=d`), key), true);
  assert.equal(hasValidAccessCookie(withCookie(`${ACCESS_COOKIE}=${accessCookieValue(`${key}x`)}`), key), false);
  assert.equal(hasValidAccessCookie(withCookie(`${ACCESS_COOKIE}=${key}`), key), false);
  assert.equal(hasValidAccessCookie(withCookie(""), key), false);
  // No key configured: no cookie can pass.
  assert.equal(hasValidAccessCookie(withCookie(`${ACCESS_COOKIE}=`), ""), false);
});
