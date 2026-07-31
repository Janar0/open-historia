/*! Open Historia — self-hosted server access screen © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

const STORAGE_KEY = "oh:shared-server-key";
let memoryApiKey = "";
let fetchInstalled = false;

const readStoredKey = () => {
  if (memoryApiKey) return memoryApiKey;
  try {
    return String(localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
};

const saveKey = (value) => {
  memoryApiKey = String(value || "").trim();
  try {
    if (memoryApiKey) localStorage.setItem(STORAGE_KEY, memoryApiKey);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory copy still authenticates this tab when storage is blocked.
  }
};

const isLocalApiRequest = (input) => {
  try {
    const raw = input instanceof URL
      ? input.href
      : input instanceof Request
        ? input.url
        : typeof input === "string"
          ? input
          : input?.url || "";
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
};

// Add the key to every same-origin API call, including PMTiles range requests,
// without changing dozens of independent fetch call sites. External AI,
// GitHub and map-provider requests never receive the self-hosted key.
export const installServerAuthFetch = () => {
  if (fetchInstalled || typeof window === "undefined" || typeof window.fetch !== "function") return;
  fetchInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    if (!isLocalApiRequest(input)) return originalFetch(input, init);

    const key = readStoredKey();
    if (!key) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${key}`);
    }

    return originalFetch(input, init == null ? { headers } : { ...init, headers });
  };
};

const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};

const showAccessGate = ({ invalid = false } = {}) => new Promise((resolve) => {
  const style = document.createElement("style");
  style.dataset.openHistoriaAuth = "";
  style.textContent = `
    .oh-auth-gate{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;
      padding:24px;background:radial-gradient(circle at 50% 0%,rgba(75,52,130,.32),transparent 52%),#090d18;
      color:#eef2ff;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .oh-auth-card{width:min(430px,100%);padding:30px;border:1px solid rgba(167,139,250,.35);border-radius:20px;
      background:linear-gradient(160deg,rgba(28,35,62,.98),rgba(13,17,34,.98));box-shadow:0 24px 80px rgba(0,0,0,.45)}
    .oh-auth-card h1{margin:0 0 8px;font-size:1.45rem;letter-spacing:-.02em}
    .oh-auth-card p{margin:0 0 20px;color:rgba(226,232,240,.72)}
    .oh-auth-card label{display:block;margin-bottom:7px;color:#c4b5fd;font-size:.82rem;font-weight:700}
    .oh-auth-card input{display:block;width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid rgba(148,163,184,.35);
      border-radius:10px;background:rgba(2,6,23,.6);color:#fff;font:inherit;outline:none}
    .oh-auth-card input:focus{border-color:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.16)}
    .oh-auth-card button{width:100%;margin-top:14px;padding:12px;border:1px solid rgba(196,181,253,.45);border-radius:10px;
      background:#6d4bd8;color:#fff;font:700 1rem system-ui;cursor:pointer}
    .oh-auth-card button:disabled{opacity:.55;cursor:wait}
    .oh-auth-error{min-height:1.4em;margin:10px 0 0;color:#fca5a5;font-size:.86rem}
    .oh-auth-hint{margin-top:16px!important;margin-bottom:0!important;font-size:.78rem}
  `;
  document.head.appendChild(style);

  const shell = make("main", null, "oh-auth-gate");
  shell.setAttribute("aria-label", "Open Historia server access");
  const card = make("section", null, "oh-auth-card");
  const title = make("h1", "Open Historia");
  const intro = make("p", invalid
    ? "Ключ не подошёл. Введите общий ключ этого сервера ещё раз."
    : "Этот сервер закрыт общим ключом доступа для вашей компании.");
  const form = document.createElement("form");
  const label = make("label", "Общий ключ сервера");
  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "current-password";
  input.placeholder = "Вставьте ключ от владельца сервера";
  input.required = true;
  const button = make("button", "Войти");
  button.type = "submit";
  const error = make("div", "", "oh-auth-error");
  error.setAttribute("role", "alert");
  const hint = make("p", "Ключ выдаёт владелец сервера. Не передавайте его в URL или сообщениях общего чата.", "oh-auth-hint");

  form.append(label, input, button, error);
  card.append(title, intro, form, hint);
  shell.append(card);
  document.body.append(shell);
  input.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    button.disabled = true;
    error.textContent = "Проверяю ключ…";
    saveKey(key);

    try {
      const response = await window.fetch("/api/auth/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.required && payload.authenticated) {
        shell.remove();
        style.remove();
        resolve();
        return;
      }
      if (response.ok && !payload.required) {
        // The server was restarted without auth while this page was open.
        shell.remove();
        style.remove();
        resolve();
        return;
      }
      saveKey("");
      error.textContent = "Неверный ключ или сервер не подтвердил доступ.";
    } catch {
      saveKey("");
      error.textContent = "Сервер недоступен. Проверьте адрес и попробуйте снова.";
    } finally {
      button.disabled = false;
      if (document.body.contains(shell)) input.focus();
    }
  });
});

export const initializeServerAuth = async () => {
  if (typeof window === "undefined" || import.meta.env.VITE_OH_WEB) return;
  installServerAuthFetch();

  let response;
  try {
    response = await window.fetch("/api/auth/status", { cache: "no-store" });
  } catch {
    // The Vite dev server can start before Express. Preserve the old boot path;
    // the normal startup screen will report the backend failure if it persists.
    return;
  }

  // An older local server has no auth endpoint; keep it compatible during an
  // incremental update. New servers always return this endpoint.
  if (response.status === 404) return;
  if (response.status === 401) {
    saveKey("");
    await showAccessGate({ invalid: true });
    return;
  }
  if (!response.ok) return;

  const payload = await response.json().catch(() => ({}));
  if (payload?.required && !payload?.authenticated) {
    await showAccessGate({ invalid: Boolean(readStoredKey()) });
  }
};
