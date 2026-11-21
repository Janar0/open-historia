/*! Open Historia — shared self-hosted API-key authentication © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const MIN_API_KEY_LENGTH = 16;

const readConfiguredKey = () => {
  const fromEnv = String(process.env.OH_SHARED_API_KEY ?? "").trim();
  const fileName = String(process.env.OH_SHARED_API_KEY_FILE ?? "").trim();

  if (fromEnv && fileName) {
    throw new Error("Set only one of OH_SHARED_API_KEY or OH_SHARED_API_KEY_FILE.");
  }

  let value = fromEnv;
  if (!value && fileName) {
    try {
      value = fs.readFileSync(path.resolve(fileName), "utf8").trim();
    } catch (error) {
      throw new Error(`Unable to read OH_SHARED_API_KEY_FILE: ${error.message}`);
    }
  }

  if (value && value.length < MIN_API_KEY_LENGTH) {
    throw new Error(`The shared API key must be at least ${MIN_API_KEY_LENGTH} characters long.`);
  }

  return value;
};

export const SHARED_API_KEY = readConfiguredKey();
export const AUTH_REQUIRED = Boolean(SHARED_API_KEY);

// Keep the key out of URLs. This is deliberately a Bearer header only: query
// parameters leak into browser history, reverse-proxy logs and PMTiles cache
// keys, while the header is not attached by an unrelated web page.
export const extractApiKey = (req) => {
  const authorization = String(req?.headers?.authorization ?? "");
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return bearer ? bearer[1].trim() : "";
};

export const isValidApiKey = (candidate, expected = SHARED_API_KEY) => {
  const supplied = Buffer.from(String(candidate ?? ""));
  const configured = Buffer.from(String(expected ?? ""));
  if (!configured.length || supplied.length !== configured.length) return false;
  return crypto.timingSafeEqual(supplied, configured);
};

// Used only to reject an accidental unauthenticated LAN/public bind. A
// hostname such as "localhost" is loopback by intent; wildcard and concrete
// LAN/public addresses require the shared key.
export const isLoopbackBindHost = (host) => {
  const value = String(host ?? "").trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
};

// A page cannot put a header on everything it loads: the map's workers, images,
// audio and the service worker all fetch /api without one. So the first request
// that proves the key with a Bearer header is handed a cookie that stands for it
// from then on. The cookie holds a keyed digest, never the key, and changes
// whenever the key does.
export const ACCESS_COOKIE = "oh_access";
const ACCESS_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
const SECURE_COOKIES = /^(1|true|yes|on)$/i.test(String(process.env.OH_SECURE_COOKIES ?? "").trim());

export const accessCookieValue = (key = SHARED_API_KEY) =>
  (key ? crypto.createHmac("sha256", key).update("open-historia-access-cookie-v1").digest("hex") : "");

const readCookie = (req, name) => {
  for (const part of String(req?.headers?.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
};

export const hasValidAccessCookie = (req, expected = SHARED_API_KEY) =>
  Boolean(expected) && isValidApiKey(readCookie(req, ACCESS_COOKIE), accessCookieValue(expected));

const accessCookieHeader = () =>
  `${ACCESS_COOKIE}=${accessCookieValue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ACCESS_COOKIE_MAX_AGE_S}`
    + (SECURE_COOKIES ? "; Secure" : "");

export const apiAuthMiddleware = (req, res, next) => {
  // apiKeyBearer: the key came in a header this request. Only that lifts the
  // cross-origin write guard, since a cookie rides along on a request another
  // site's page started. apiKeyAuthenticated: the caller is known either way.
  const bearer = AUTH_REQUIRED && isValidApiKey(extractApiKey(req));
  const cookie = AUTH_REQUIRED && !bearer && hasValidAccessCookie(req);
  req.apiKeyBearer = bearer;
  req.apiKeyAuthenticated = bearer || cookie;
  if (bearer && !hasValidAccessCookie(req)) res.append("Set-Cookie", accessCookieHeader());

  // The SPA and its static assets must remain public so the browser can load
  // the login screen. Authentication applies to the JSON/binary API only.
  if (!req.path.startsWith("/api/")) return next();

  // OPTIONS must remain unauthenticated so a browser can preflight an
  // Authorization header. The status endpoint is intentionally public: it
  // tells the boot screen whether it should ask for a key, never the key itself.
  if (!AUTH_REQUIRED || req.method === "OPTIONS" || req.path === "/api/auth/status") {
    return next();
  }

  if (req.apiKeyAuthenticated) return next();

  res.setHeader("WWW-Authenticate", 'Bearer realm="Open Historia"');
  return res.status(401).json({ error: "Server API key required.", authRequired: true });
};
