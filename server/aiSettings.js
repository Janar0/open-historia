/*! Open Historia — server-managed OpenAI-compatible credentials © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir.js";

const FILE_NAME = "ai-settings.json";
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_MODEL_LENGTH = 256;
const MAX_API_KEY_LENGTH = 4096;

const emptyProfile = () => ({ endpoint: "", model: "", apiKey: "" });

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);

const normalizeProfile = (raw, previous = emptyProfile()) => {
  const source = raw && typeof raw === "object" ? raw : {};
  const endpoint = String(hasOwn(source, "endpoint") ? source.endpoint : previous.endpoint).trim();
  const model = String(hasOwn(source, "model") ? source.model : previous.model).trim();
  if (endpoint.length > MAX_ENDPOINT_LENGTH) throw new Error("AI endpoint is too long.");
  if (model.length > MAX_MODEL_LENGTH) throw new Error("AI model name is too long.");
  if (endpoint && !/^https?:\/\//i.test(endpoint)) {
    throw new Error("AI endpoint must start with http:// or https://.");
  }

  let apiKey = previous.apiKey || "";
  if (source.clearApiKey === true) {
    apiKey = "";
  } else if (hasOwn(source, "apiKey") && String(source.apiKey ?? "").trim()) {
    apiKey = String(source.apiKey).trim();
  }
  if (apiKey.length > MAX_API_KEY_LENGTH) throw new Error("AI API key is too long.");

  return { endpoint, model, apiKey };
};

const normalizeMode = (value) => (value === "per-user" ? "per-user" : "global");

const normalizeState = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawUsers = source.users && typeof source.users === "object" ? source.users : {};
  const users = {};
  for (const [userId, profile] of Object.entries(rawUsers)) {
    if (!userId || userId === "__proto__" || userId === "constructor") continue;
    users[userId] = normalizeProfile(profile);
  }
  return {
    version: 1,
    mode: normalizeMode(source.mode),
    global: normalizeProfile(source.global),
    users,
  };
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const isConfigured = (profile) => Boolean(profile.endpoint || profile.model || profile.apiKey);

const publicProfile = (profile) => ({
  endpoint: profile.endpoint,
  model: profile.model,
  apiKeyConfigured: Boolean(profile.apiKey),
});

export const createAISettingsStore = (dataDir = DATA_DIR) => {
  const resolvedDir = path.resolve(dataDir);
  const settingsPath = path.join(resolvedDir, FILE_NAME);

  const readState = () => {
    if (!fs.existsSync(settingsPath)) {
      return { version: 1, mode: "global", global: emptyProfile(), users: {} };
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read ${FILE_NAME}: ${error.message}`);
    }
    return normalizeState(parsed);
  };

  const writeState = (state) => {
    fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(
      resolvedDir,
      `.${FILE_NAME}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, settingsPath);
    fs.chmodSync(settingsPath, 0o600);
  };

  const getEffective = (userId) => {
    const state = readState();
    const requestedUserId = String(userId ?? "");
    const profile = state.mode === "global"
      ? state.global
      : state.users[requestedUserId] ?? emptyProfile();
    return {
      ...clone(profile),
      managed: isConfigured(profile),
      mode: state.mode,
      source: state.mode === "global" ? "global" : (state.users[requestedUserId] ? "user" : "none"),
    };
  };

  const getPublic = (userId) => {
    const effective = getEffective(userId);
    return {
      managed: effective.managed,
      mode: effective.mode,
      source: effective.source,
      ...publicProfile(effective),
    };
  };

  const getAdmin = () => {
    const state = readState();
    return {
      mode: state.mode,
      global: publicProfile(state.global),
      users: Object.fromEntries(
        Object.entries(state.users).map(([userId, profile]) => [userId, publicProfile(profile)]),
      ),
    };
  };

  const saveAdmin = ({ mode, global, users } = {}) => {
    const current = readState();
    const nextUsers = {};
    const requestedUsers = users && typeof users === "object" ? users : {};
    for (const [userId, profile] of Object.entries(requestedUsers)) {
      if (!userId || userId === "__proto__" || userId === "constructor") continue;
      nextUsers[userId] = normalizeProfile(profile, current.users[userId] ?? emptyProfile());
    }
    const next = {
      version: 1,
      mode: normalizeMode(mode),
      global: normalizeProfile(global, current.global),
      users: nextUsers,
    };
    writeState(next);
    return getAdmin();
  };

  return { getAdmin, getEffective, getPublic, readState, saveAdmin };
};

const store = createAISettingsStore();

export const getEffectiveAISettings = (userId) => store.getEffective(userId);
export const getPublicAISettings = (userId) => store.getPublic(userId);
export const getAdminAISettings = () => store.getAdmin();
export const saveAdminAISettings = (payload) => store.saveAdmin(payload);
