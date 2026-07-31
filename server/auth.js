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

export const apiAuthMiddleware = (req, res, next) => {
  const authenticated = AUTH_REQUIRED && isValidApiKey(extractApiKey(req));
  req.apiKeyAuthenticated = authenticated;

  // The SPA and its static assets must remain public so the browser can load
  // the login screen. Authentication applies to the JSON/binary API only.
  if (!req.path.startsWith("/api/")) return next();

  // OPTIONS must remain unauthenticated so a browser can preflight an
  // Authorization header. The status endpoint is intentionally public: it
  // tells the boot screen whether it should ask for a key, never the key itself.
  if (!AUTH_REQUIRED || req.method === "OPTIONS" || req.path === "/api/auth/status") {
    return next();
  }

  if (authenticated) return next();

  res.setHeader("WWW-Authenticate", 'Bearer realm="Open Historia"');
  return res.status(401).json({ error: "Server API key required.", authRequired: true });
};
