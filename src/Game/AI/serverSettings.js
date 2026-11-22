/*! Open Historia — server-managed AI profile discovery © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// A shared server's admin may keep one AI endpoint, model and key for its
// players (server/aiSettings.js). The page is told the endpoint and model, never
// the key: a call to that endpoint goes through the server's relay, which adds
// the key itself.

let cachedSettings = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15_000;

export const invalidateManagedAISettings = () => {
    cachedSettings = null;
    cachedAt = 0;
};

export const getManagedOpenAICompatibleSettings = async () => {
    if (import.meta.env.VITE_OH_WEB || typeof window === "undefined") return null;
    if (cachedSettings && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSettings;

    try {
        const response = await fetch("/api/ai/settings", { cache: "no-store" });
        if (!response.ok) return null;
        const payload = await response.json();
        cachedSettings = payload && typeof payload === "object" ? payload : null;
        cachedAt = Date.now();
        return cachedSettings;
    } catch {
        return null;
    }
};

if (typeof window !== "undefined") {
    window.addEventListener("oh:ai-settings-updated", invalidateManagedAISettings);
}

const withoutTrailingSlash = (value) => String(value ?? "").replace(/\/+$/, "");

const managedEndpointOf = (managed) => withoutTrailingSlash(String((managed?.managed && managed.endpoint) || "").trim());

// An entry as it is really called. One at the server's endpoint is the admin's:
// their model, and no key from this device. Every other entry is the player's
// own and comes back untouched, so a list of several providers still falls back
// from one to the next.
export const applyManagedProfile = (entry, managed = cachedSettings) => {
    const endpoint = managedEndpointOf(managed);
    if (!endpoint || entry?.provider !== "openai-compatible") return entry;
    if (withoutTrailingSlash(String(entry.endpoint ?? "").trim()) !== endpoint) return entry;
    return { ...entry, endpoint, apiKey: "", model: managed.model || entry.model };
};

// The relay profile a request belongs to, from what was last fetched. The
// server's key is only for the two calls such an entry makes, and only where the
// page sends no key: another entry on the same host (a /v1 or /anthropic path, a
// provider with the player's own key) must not be billed to the admin.
export const managedRelayProfileFor = (url, headers = {}, managed = cachedSettings) => {
    const endpoint = managedEndpointOf(managed);
    if (!endpoint || headers?.Authorization) return "";
    return [`${endpoint}/models`, `${endpoint}/chat/completions`].includes(String(url ?? "")) ? "openai-compatible" : "";
};

// A player who opens a shared server with an AI profile has a Connection to it
// from the first visit, with nothing to type: the endpoint and model, no key
// (the relay adds it). Made once: a Connection already at that endpoint is left
// as the player arranged it. Resolves true when it made one.
export const ensureManagedConnection = async () => {
    const managed = await getManagedOpenAICompatibleSettings();
    const endpoint = withoutTrailingSlash(managed?.managed ? managed.endpoint : "");
    if (!endpoint) return false;
    const { applyQuickAiSetup, getConnections } = await import("./providerConfig.js");
    const present = getConnections().some((connection) =>
        connection?.provider === "openai-compatible" && withoutTrailingSlash(connection.endpoint) === endpoint);
    if (present) return false;
    applyQuickAiSetup({ provider: "openai-compatible", endpoint, model: managed.model || "" });
    return true;
};
