/*! Open Historia — local user accounts and session authentication © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { AUTH_REQUIRED } from "./auth.js";
import { DATA_DIR } from "./dataDir.js";

const USERS_FILE_NAME = "users.json";
const SESSION_COOKIE = "oh_session";
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 256;
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,31}$/u;
const SCRYPT_OPTIONS = {
  N: 1 << 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

const parseBoolean = (value, fallback) => {
  if (value == null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const readSecret = (valueName, fileName) => {
  const fromEnv = String(process.env[valueName] ?? "").trim();
  const fromFileName = String(process.env[fileName] ?? "").trim();
  if (fromEnv && fromFileName) {
    throw new Error(`Set only one of ${valueName} or ${fileName}.`);
  }
  if (fromEnv) return fromEnv;
  if (!fromFileName) return "";
  try {
    return fs.readFileSync(path.resolve(fromFileName), "utf8").trim();
  } catch (error) {
    throw new Error(`Unable to read ${fileName}: ${error.message}`);
  }
};

export const USER_AUTH_REQUIRED = parseBoolean(process.env.OH_USER_AUTH, false);
export const REGISTRATION_OPEN = parseBoolean(process.env.OH_REGISTRATION_OPEN, true);
export const SECURE_COOKIES = parseBoolean(process.env.OH_SECURE_COOKIES, false);
export const BOOTSTRAP_ADMIN_USERNAME = String(process.env.OH_ADMIN_USERNAME || "admin").trim() || "admin";
export const BOOTSTRAP_ADMIN_PASSWORD = readSecret("OH_ADMIN_PASSWORD", "OH_ADMIN_PASSWORD_FILE");

const nowIso = () => new Date().toISOString();

export const normalizeUsername = (value) => String(value ?? "").trim().normalize("NFKC").toLowerCase();

export const validateUsername = (value) => {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error("Username must be 3–32 letters, numbers, dots, underscores or hyphens.");
  }
  return username;
};

export const validatePassword = (value) => {
  const password = String(value ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be no longer than ${MAX_PASSWORD_LENGTH} characters.`);
  }
  return password;
};

export const hashPassword = (password) => {
  const value = validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(value, salt, 64, SCRYPT_OPTIONS);
  return {
    algorithm: "scrypt",
    hash: derivedKey.toString("base64url"),
    salt: salt.toString("base64url"),
  };
};

export const verifyPassword = (password, stored) => {
  if (!stored || stored.algorithm !== "scrypt" || !stored.salt || !stored.hash) return false;
  const supplied = Buffer.from(String(password ?? ""));
  if (supplied.length < MIN_PASSWORD_LENGTH || supplied.length > MAX_PASSWORD_LENGTH) return false;
  try {
    const salt = Buffer.from(stored.salt, "base64url");
    const expected = Buffer.from(stored.hash, "base64url");
    const actual = crypto.scryptSync(supplied, salt, expected.length, SCRYPT_OPTIONS);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const publicUser = (user) => {
  if (!user) return null;
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    enabled: user.enabled !== false,
    id: user.id,
    lastLoginAt: user.lastLoginAt ?? null,
    role: user.role === "admin" ? "admin" : "player",
    updatedAt: user.updatedAt,
    username: user.username,
  };
};

const normalizeDisplayName = (value, username) => {
  const displayName = String(value ?? "").trim().normalize("NFKC");
  return displayName.slice(0, 80) || username;
};

const makeUser = ({ username, password, displayName, role }) => {
  const normalizedUsername = validateUsername(username);
  return {
    createdAt: nowIso(),
    displayName: normalizeDisplayName(displayName, normalizedUsername),
    enabled: true,
    id: `user-${crypto.randomUUID()}`,
    lastLoginAt: null,
    password: hashPassword(password),
    role: role === "admin" ? "admin" : "player",
    updatedAt: nowIso(),
    username: normalizedUsername,
  };
};

const normalizeStoredUser = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const username = normalizeUsername(raw.username);
  if (!raw.id || !username || !raw.password || !USERNAME_PATTERN.test(username)) return null;
  return {
    createdAt: String(raw.createdAt || nowIso()),
    displayName: normalizeDisplayName(raw.displayName, username),
    enabled: raw.enabled !== false,
    id: String(raw.id),
    lastLoginAt: raw.lastLoginAt ? String(raw.lastLoginAt) : null,
    password: raw.password,
    role: raw.role === "admin" ? "admin" : "player",
    updatedAt: String(raw.updatedAt || nowIso()),
    username,
  };
};

const createFileStore = (dataDir) => {
  const usersPath = path.join(dataDir, USERS_FILE_NAME);

  const readState = () => {
    if (!fs.existsSync(usersPath)) return { users: [], version: 1 };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read ${USERS_FILE_NAME}: ${error.message}`);
    }
    const users = Array.isArray(parsed?.users)
      ? parsed.users.map(normalizeStoredUser).filter(Boolean)
      : [];
    return { users, version: 1 };
  };

  const writeState = (state) => {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(
      dataDir,
      `.${USERS_FILE_NAME}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, users: state.users }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, usersPath);
  };

  const findByUsername = (state, username) => {
    const normalized = normalizeUsername(username);
    return state.users.find((user) => user.username === normalized) ?? null;
  };

  const findById = (state, id) => state.users.find((user) => user.id === String(id)) ?? null;

  const adminCount = (state) => state.users.filter((user) => user.enabled !== false && user.role === "admin").length;

  const list = () => readState().users.map(publicUser);

  const register = ({ username, password, displayName }) => {
    const state = readState();
    const normalizedUsername = validateUsername(username);
    if (findByUsername(state, normalizedUsername)) throw new Error("That username is already taken.");
    const user = makeUser({
      displayName,
      password,
      role: state.users.length === 0 ? "admin" : "player",
      username: normalizedUsername,
    });
    state.users.push(user);
    writeState(state);
    return clone(user);
  };

  const create = ({ username, password, displayName, role = "player" }) => {
    const state = readState();
    const normalizedUsername = validateUsername(username);
    if (findByUsername(state, normalizedUsername)) throw new Error("That username is already taken.");
    const user = makeUser({ displayName, password, role, username: normalizedUsername });
    state.users.push(user);
    writeState(state);
    return clone(user);
  };

  const authenticate = ({ username, password }) => {
    const state = readState();
    const user = findByUsername(state, username);
    if (!user || user.enabled === false || !verifyPassword(password, user.password)) return null;
    user.lastLoginAt = nowIso();
    user.updatedAt = nowIso();
    writeState(state);
    return clone(user);
  };

  const changePassword = (id, currentPassword, newPassword) => {
    const state = readState();
    const user = findById(state, id);
    if (!user || !verifyPassword(currentPassword, user.password)) return false;
    user.password = hashPassword(newPassword);
    user.updatedAt = nowIso();
    writeState(state);
    return true;
  };

  const update = (id, updates) => {
    const state = readState();
    const user = findById(state, id);
    if (!user) throw new Error("User not found.");

    if (updates.role !== undefined && updates.role !== "admin" && updates.role !== "player") {
      throw new Error("Role must be admin or player.");
    }
    if (updates.enabled !== undefined && typeof updates.enabled !== "boolean") {
      throw new Error("Enabled must be a boolean.");
    }
    const nextRole = updates.role === undefined ? user.role : updates.role === "admin" ? "admin" : "player";
    const nextEnabled = updates.enabled === undefined ? user.enabled !== false : updates.enabled;
    if (user.role === "admin" && (nextRole !== "admin" || !nextEnabled) && adminCount(state) <= 1) {
      throw new Error("The last active admin cannot be removed or disabled.");
    }

    if (updates.displayName !== undefined) {
      user.displayName = normalizeDisplayName(updates.displayName, user.username);
    }
    if (updates.password !== undefined) user.password = hashPassword(updates.password);
    user.role = nextRole;
    user.enabled = nextEnabled;
    user.updatedAt = nowIso();
    writeState(state);
    return clone(user);
  };

  const getById = (id) => clone(findById(readState(), id));

  const ensureBootstrapAdmin = () => {
    if (!BOOTSTRAP_ADMIN_PASSWORD) return null;
    const state = readState();
    const username = validateUsername(BOOTSTRAP_ADMIN_USERNAME);
    const existing = findByUsername(state, username);
    if (existing) return publicUser(existing);
    const user = makeUser({
      displayName: username,
      password: BOOTSTRAP_ADMIN_PASSWORD,
      role: "admin",
      username,
    });
    state.users.push(user);
    writeState(state);
    return publicUser(user);
  };

  return {
    adminCount: () => adminCount(readState()),
    authenticate,
    changePassword,
    create,
    ensureBootstrapAdmin,
    getById,
    list,
    readState,
    register,
    update,
  };
};

export const createUserStore = (dataDir = DATA_DIR) => createFileStore(path.resolve(dataDir));
const store = createUserStore();

const sessions = new Map();
const loginFailures = new Map();

const sessionKey = (token) => crypto.createHash("sha256").update(token).digest("hex");

const parseCookies = (header) => {
  const cookies = {};
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key || !rest.length) continue;
    try {
      cookies[key] = decodeURIComponent(rest.join("="));
    } catch {
      // Ignore a malformed untrusted cookie rather than failing the request.
    }
  }
  return cookies;
};

const clientAddress = (req) => String(req?.ip || req?.socket?.remoteAddress || "unknown");

const loginFailureKey = (req, username) => `${clientAddress(req)}:${normalizeUsername(username)}`;

const trimLoginFailures = () => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [key, entry] of loginFailures) {
    if (entry.startedAt < cutoff) loginFailures.delete(key);
  }
};

const loginIsBlocked = (req, username) => {
  trimLoginFailures();
  const entry = loginFailures.get(loginFailureKey(req, username));
  return entry && entry.count >= MAX_LOGIN_FAILURES;
};

const rememberLoginFailure = (req, username) => {
  const key = loginFailureKey(req, username);
  const entry = loginFailures.get(key) ?? { count: 0, startedAt: Date.now() };
  entry.count += 1;
  loginFailures.set(key, entry);
};

const clearLoginFailures = (req, username) => loginFailures.delete(loginFailureKey(req, username));

const destroySessionsForUser = (userId) => {
  for (const [key, session] of sessions) {
    if (session.userId === userId) sessions.delete(key);
  }
};

const createSession = (user) => {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(sessionKey(token), { expiresAt: Date.now() + SESSION_TTL_MS, userId: user.id });
  return token;
};

const getSessionUser = (req) => {
  const token = parseCookies(req?.headers?.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const key = sessionKey(token);
  const session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }
  const user = store.getById(session.userId);
  if (!user || user.enabled === false) {
    sessions.delete(key);
    return null;
  }
  return user;
};

export const getUserFromRequest = (req) => publicUser(getSessionUser(req));

export const setSessionCookie = (res, token) => {
  const secure = SECURE_COOKIES ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
};

export const clearSessionCookie = (res) => {
  const secure = SECURE_COOKIES ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
};

export const ensureUserStore = () => store.ensureBootstrapAdmin();

export const getUserAuthStatus = (req) => {
  const apiAccessGranted = !AUTH_REQUIRED || Boolean(req?.apiKeyAuthenticated);
  const user = USER_AUTH_REQUIRED && apiAccessGranted ? getSessionUser(req) : null;
  const users = USER_AUTH_REQUIRED ? store.readState().users : [];
  return {
    accountAuthenticated: Boolean(user),
    accountsRequired: USER_AUTH_REQUIRED,
    authenticated: Boolean(req?.apiKeyAuthenticated),
    registrationOpen: USER_AUTH_REQUIRED && (REGISTRATION_OPEN || users.length === 0),
    required: AUTH_REQUIRED,
    user: publicUser(user),
  };
};

export const registerUser = ({ username, password, displayName }) => {
  if (!REGISTRATION_OPEN && store.readState().users.length > 0) {
    throw new Error("Registration is disabled on this server.");
  }
  return store.register({ username, password, displayName });
};

export const loginUser = (req, { username, password }) => {
  if (loginIsBlocked(req, username)) {
    const error = new Error("Too many failed login attempts. Try again in 15 minutes.");
    error.statusCode = 429;
    return { error };
  }
  const user = store.authenticate({ username, password });
  if (!user) {
    rememberLoginFailure(req, username);
    const error = new Error("Invalid username or password.");
    error.statusCode = 401;
    return { error };
  }
  clearLoginFailures(req, username);
  return { token: createSession(user), user };
};

export const changeOwnPassword = (userId, currentPassword, newPassword) => {
  const changed = store.changePassword(userId, currentPassword, newPassword);
  if (changed) destroySessionsForUser(userId);
  return changed;
};

export const listUsers = () => store.list();

export const createManagedUser = (payload) => store.create(payload);

export const updateManagedUser = (userId, updates) => {
  const updated = store.update(userId, updates);
  if (updated.enabled === false || updates.password !== undefined) destroySessionsForUser(userId);
  return updated;
};

export const requireUserAuth = (req, res, next) => {
  if (!USER_AUTH_REQUIRED || !req.path.startsWith("/api/")) return next();
  if (req.path === "/api/auth/status" || req.path === "/api/auth/login" ||
      req.path === "/api/auth/register" || req.path === "/api/auth/logout") {
    return next();
  }
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ accountRequired: true, error: "Account login required." });
  }
  req.user = publicUser(user);
  return next();
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ error: "Administrator access required." });
};

export const MIN_USER_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;
export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const toPublicUser = publicUser;
