/*! Open Historia — server-managed AI profile discovery © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

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
