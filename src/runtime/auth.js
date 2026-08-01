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

const accountGateStyle = `
  .oh-auth-gate{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;
    padding:24px;background:radial-gradient(circle at 50% 0%,rgba(75,52,130,.32),transparent 52%),#090d18;
    color:#eef2ff;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .oh-auth-card{width:min(430px,100%);padding:30px;border:1px solid rgba(167,139,250,.35);border-radius:20px;
    background:linear-gradient(160deg,rgba(28,35,62,.98),rgba(13,17,34,.98));box-shadow:0 24px 80px rgba(0,0,0,.45)}
  .oh-auth-card h1{margin:0 0 8px;font-size:1.45rem;letter-spacing:-.02em}
  .oh-auth-card p{margin:0 0 20px;color:rgba(226,232,240,.72)}
  .oh-auth-card label{display:block;margin-bottom:7px;color:#c4b5fd;font-size:.82rem;font-weight:700}
  .oh-auth-card input{display:block;width:100%;box-sizing:border-box;margin-bottom:12px;padding:12px 13px;border:1px solid rgba(148,163,184,.35);
    border-radius:10px;background:rgba(2,6,23,.6);color:#fff;font:inherit;outline:none}
  .oh-auth-card input:focus{border-color:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.16)}
  .oh-auth-card form>button{width:100%;margin-top:14px;padding:12px;border:1px solid rgba(196,181,253,.45);border-radius:10px;
    background:#6d4bd8;color:#fff;font:700 1rem system-ui;cursor:pointer}
  .oh-auth-card button:disabled{opacity:.55;cursor:wait}
  .oh-auth-error{min-height:1.4em;margin:10px 0 0;color:#fca5a5;font-size:.86rem}
  .oh-user-tabs{display:flex;gap:8px;margin:0 0 16px}
  .oh-user-tab{flex:1;padding:9px 10px;border:1px solid rgba(148,163,184,.28);border-radius:9px;
    background:rgba(2,6,23,.42);color:rgba(226,232,240,.7);font:600 .86rem system-ui;cursor:pointer}
  .oh-user-tab.active{border-color:rgba(196,181,253,.62);background:rgba(124,58,237,.3);color:#fff}
  .oh-user-hint{margin:14px 0 0!important;font-size:.78rem!important;color:rgba(226,232,240,.58)!important}
  .oh-user-widget{position:fixed;top:14px;right:14px;z-index:2147480000;color:#eef2ff;font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .oh-user-button{border:1px solid rgba(196,181,253,.35);border-radius:999px;padding:8px 13px;background:rgba(21,25,47,.92);
    color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.3);font:600 .8rem system-ui;cursor:pointer}
  .oh-user-panel{position:absolute;top:calc(100% + 8px);right:0;width:min(390px,calc(100vw - 28px));max-height:calc(100vh - 90px);overflow:auto;
    padding:16px;border:1px solid rgba(167,139,250,.35);border-radius:16px;background:rgba(13,17,34,.98);box-shadow:0 20px 60px rgba(0,0,0,.45)}
  .oh-user-panel h3,.oh-user-panel h4{margin:0 0 7px;color:#fff}
  .oh-user-panel h4{margin-top:18px;font-size:.9rem}
  .oh-user-panel p{margin:0 0 12px;color:rgba(226,232,240,.65);font-size:.8rem}
  .oh-user-panel input,.oh-user-panel select{width:100%;box-sizing:border-box;margin:4px 0;padding:9px 10px;border:1px solid rgba(148,163,184,.3);
    border-radius:8px;background:rgba(2,6,23,.6);color:#fff;font:inherit}
  .oh-user-panel button{border:1px solid rgba(196,181,253,.4);border-radius:8px;padding:8px 10px;background:#6044c2;color:#fff;font:600 .78rem system-ui;cursor:pointer}
  .oh-user-panel button.ghost{background:rgba(255,255,255,.06);border-color:rgba(148,163,184,.3)}
  .oh-user-panel button.danger{background:rgba(190,50,80,.28);border-color:rgba(248,113,113,.35)}
  .oh-user-row{display:grid;grid-template-columns:minmax(0,1fr) 86px auto;align-items:center;gap:6px;padding:8px 0;border-top:1px solid rgba(148,163,184,.14);font-size:.76rem}
  .oh-user-row small{display:block;color:rgba(226,232,240,.5)}
  .oh-user-msg{min-height:1.25em;margin:8px 0;color:#fca5a5;font-size:.78rem}
  .oh-user-success{color:#bbf7d0}
`;

const readJsonResponse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `Request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
};

const accountRequest = async (pathname, { body, method = "GET" } = {}) => {
  const response = await window.fetch(pathname, {
    body: body == null ? undefined : JSON.stringify(body),
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    method,
  });
  return readJsonResponse(response);
};

const showAccountGate = ({ registrationOpen = false } = {}) => new Promise((resolve) => {
  const style = document.createElement("style");
  style.dataset.openHistoriaAuth = "account";
  style.textContent = accountGateStyle;
  document.head.appendChild(style);

  const shell = make("main", null, "oh-auth-gate");
  shell.setAttribute("aria-label", "Open Historia account access");
  const card = make("section", null, "oh-auth-card");
  const title = make("h1", "Вход в Open Historia");
  const intro = make("p", "Ключ сервера принят. Теперь войдите под своей учётной записью.");
  const tabs = make("div", null, "oh-user-tabs");
  const loginTab = make("button", "Войти", "oh-user-tab active");
  const registerTab = make("button", "Регистрация", "oh-user-tab");
  loginTab.type = "button";
  registerTab.type = "button";
  tabs.append(loginTab);
  if (registrationOpen) tabs.append(registerTab);

  const form = document.createElement("form");
  const usernameLabel = make("label", "Логин");
  const username = document.createElement("input");
  username.type = "text";
  username.autocomplete = "username";
  username.placeholder = "например, janaro";
  username.required = true;
  const displayLabel = make("label", "Имя в игре");
  const displayName = document.createElement("input");
  displayName.type = "text";
  displayName.autocomplete = "nickname";
  displayName.placeholder = "необязательно";
  displayName.maxLength = 80;
  const passwordLabel = make("label", "Пароль");
  const password = document.createElement("input");
  password.type = "password";
  password.autocomplete = "current-password";
  password.required = true;
  password.minLength = 6;
  const confirmLabel = make("label", "Повторите пароль");
  const confirm = document.createElement("input");
  confirm.type = "password";
  confirm.autocomplete = "new-password";
  confirm.minLength = 6;
  const submit = make("button", "Войти");
  submit.type = "submit";
  const error = make("div", "", "oh-auth-error");
  error.setAttribute("role", "alert");
  const hint = make("p", "У каждого игрока свой логин и пароль. Пароль хранится на сервере только в виде хэша.", "oh-user-hint");

  const setMode = (mode) => {
    const registering = mode === "register";
    loginTab.classList.toggle("active", !registering);
    registerTab.classList.toggle("active", registering);
    displayLabel.style.display = registering ? "block" : "none";
    displayName.style.display = registering ? "block" : "none";
    confirmLabel.style.display = registering ? "block" : "none";
    confirm.style.display = registering ? "block" : "none";
    password.autocomplete = registering ? "new-password" : "current-password";
    submit.textContent = registering ? "Создать аккаунт" : "Войти";
    error.textContent = "";
    form.dataset.mode = mode;
  };

  loginTab.addEventListener("click", () => setMode("login"));
  registerTab.addEventListener("click", () => setMode("register"));
  form.append(
    usernameLabel,
    username,
    displayLabel,
    displayName,
    passwordLabel,
    password,
    confirmLabel,
    confirm,
    submit,
    error,
  );
  card.append(title, intro, tabs, form, hint);
  shell.append(card);
  document.body.append(shell);
  setMode("login");
  username.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const registering = form.dataset.mode === "register";
    if (registering && password.value !== confirm.value) {
      error.textContent = "Пароли не совпадают.";
      return;
    }
    submit.disabled = true;
    error.textContent = "Проверяю данные…";
    try {
      await accountRequest(registering ? "/api/auth/register" : "/api/auth/login", {
        body: {
          displayName: displayName.value,
          password: password.value,
          username: username.value,
        },
        method: "POST",
      });
      shell.remove();
      style.remove();
      resolve();
    } catch (requestError) {
      error.textContent = requestError.message;
    } finally {
      submit.disabled = false;
      if (document.body.contains(shell)) username.focus();
    }
  });
});

let accountWidgetInstalled = false;
let accountWidgetController = null;

const renderAdminUsers = async (container, message) => {
  container.replaceChildren();
  const status = make("div", "Загружаю пользователей…", "oh-user-msg");
  container.append(status);
  try {
    const payload = await accountRequest("/api/auth/admin/users");
    container.replaceChildren();
    for (const user of payload.users ?? []) {
      const row = make("div", null, "oh-user-row");
      const identity = make("div");
      identity.append(make("span", user.displayName || user.username));
      identity.append(make("small", `${user.username}${user.enabled ? "" : " · отключён"}`));
      const role = document.createElement("select");
      for (const value of ["player", "admin"]) role.append(new Option(value, value));
      role.value = user.role;
      const toggle = make("button", user.enabled ? "Откл." : "Вкл.", user.enabled ? "danger" : "ghost");
      toggle.type = "button";
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          await accountRequest(`/api/auth/admin/users/${encodeURIComponent(user.id)}`, {
            body: { enabled: !user.enabled },
            method: "PATCH",
          });
          await renderAdminUsers(container, message);
        } catch (error) {
          message.textContent = error.message;
          toggle.disabled = false;
        }
      });
      role.addEventListener("change", async () => {
        role.disabled = true;
        try {
          await accountRequest(`/api/auth/admin/users/${encodeURIComponent(user.id)}`, {
            body: { role: role.value },
            method: "PATCH",
          });
          await renderAdminUsers(container, message);
        } catch (error) {
          message.textContent = error.message;
          role.disabled = false;
        }
      });
      row.append(identity, role, toggle);
      container.append(row);
    }
  } catch (error) {
    container.replaceChildren(make("div", error.message, "oh-user-msg"));
  }
};

const renderAdminAISettings = async (container, message) => {
  container.replaceChildren(make("div", "Загружаю AI-настройки…", "oh-user-msg"));
  try {
    const [config, userPayload] = await Promise.all([
      accountRequest("/api/auth/admin/ai-settings"),
      accountRequest("/api/auth/admin/users"),
    ]);
    const state = {
      mode: config.mode === "per-user" ? "per-user" : "global",
      global: {
        endpoint: config.global?.endpoint || "",
        model: config.global?.model || "",
        apiKey: "",
        apiKeyConfigured: Boolean(config.global?.apiKeyConfigured),
        clearApiKey: false,
      },
      users: {},
    };
    for (const user of userPayload.users ?? []) {
      const saved = config.users?.[user.id] ?? {};
      state.users[user.id] = {
        endpoint: saved.endpoint || "",
        model: saved.model || "",
        apiKey: "",
        apiKeyConfigured: Boolean(saved.apiKeyConfigured),
        clearApiKey: false,
      };
    }

    const title = make("h4", "AI-профиль сервера");
    const hint = make("p", "Можно задать один endpoint и ключ для всех игроков или отдельный профиль каждому. Ключ хранится на сервере и не показывается обратно.");
    const mode = document.createElement("select");
    mode.append(new Option("Общий профиль для всех", "global"), new Option("Отдельный профиль каждому", "per-user"));
    mode.value = state.mode;
    const target = document.createElement("select");
    target.append(new Option("Все пользователи", "global"));
    for (const user of userPayload.users ?? []) {
      target.append(new Option(`${user.displayName || user.username} (${user.username})`, user.id));
    }
    target.value = "global";
    const endpoint = document.createElement("input");
    endpoint.placeholder = "https://provider.example/v1";
    const model = document.createElement("input");
    model.placeholder = "qwen / llama / gpt-...";
    const apiKey = document.createElement("input");
    apiKey.type = "password";
    apiKey.placeholder = "Оставьте пустым, чтобы не менять ключ";
    const keyState = make("div", "");
    const clearKey = make("button", "Сбросить сохранённый ключ", "ghost");
    clearKey.type = "button";
    const save = make("button", "Сохранить AI-профиль");
    save.type = "button";

    const field = (label, control, description) => {
      const wrap = make("div");
      const labelNode = make("label", label);
      wrap.append(labelNode, control);
      if (description) wrap.append(make("small", description));
      return wrap;
    };
    const form = make("div", null, "oh-ai-admin-form");
    form.append(
      field("Режим", mode, "В режиме «отдельный» выбранный профиль применяется только к выбранному пользователю."),
      field("Кому редактировать", target, "В режиме «общий» используется только профиль «Все пользователи»."),
      field("Endpoint", endpoint, "Базовый URL с /models и /chat/completions."),
      field("Модель", model, "Можно оставить пустым для автоопределения."),
      field("API key", apiKey, "Новый ключ передаётся по HTTPS и сохраняется только на этом сервере."),
      keyState,
      clearKey,
      save,
    );

    let selected = "global";
    const profile = () => selected === "global" ? state.global : state.users[selected];
    const persistFields = () => {
      const current = profile();
      if (!current) return;
      current.endpoint = endpoint.value.trim();
      current.model = model.value.trim();
      if (apiKey.value.trim()) {
        current.apiKey = apiKey.value.trim();
        current.apiKeyConfigured = true;
        current.clearApiKey = false;
      }
    };
    const loadFields = () => {
      const current = profile() || state.global;
      endpoint.value = current.endpoint;
      model.value = current.model;
      apiKey.value = "";
      keyState.textContent = current.apiKeyConfigured ? "Сохранённый ключ уже задан; пустое поле его сохранит." : "Ключ не задан.";
      clearKey.disabled = !current.apiKeyConfigured;
    };
    mode.addEventListener("change", () => {
      state.mode = mode.value;
      target.disabled = state.mode === "global";
    });
    target.addEventListener("change", () => {
      persistFields();
      selected = target.value;
      loadFields();
    });
    clearKey.addEventListener("click", () => {
      const current = profile();
      if (!current) return;
      current.apiKey = "";
      current.apiKeyConfigured = false;
      current.clearApiKey = true;
      apiKey.value = "";
      keyState.textContent = "Ключ будет удалён после сохранения.";
      clearKey.disabled = true;
    });
    save.addEventListener("click", async () => {
      persistFields();
      save.disabled = true;
      try {
        await accountRequest("/api/auth/admin/ai-settings", {
          method: "PUT",
          body: {
            mode: state.mode,
            global: state.global,
            users: state.users,
          },
        });
        message.className = "oh-user-msg oh-user-success";
        message.textContent = "AI-профиль сохранён.";
        window.dispatchEvent(new Event("oh:ai-settings-updated"));
        loadFields();
      } catch (error) {
        message.className = "oh-user-msg";
        message.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });

    container.replaceChildren(title, hint, form);
    target.disabled = state.mode === "global";
    loadFields();
  } catch (error) {
    container.replaceChildren(make("div", error.message, "oh-user-msg"));
  }
};

export const installUserAccountWidget = (user) => {
  if (typeof document === "undefined" || !user || accountWidgetInstalled) return;
  accountWidgetInstalled = true;
  const style = document.createElement("style");
  style.dataset.openHistoriaAuth = "widget";
  style.textContent = accountGateStyle;
  document.head.appendChild(style);
  const root = make("div", null, "oh-user-widget");
  root.style.display = "none";
  const panel = make("div", null, "oh-user-panel");
  panel.style.display = "none";
  const message = make("div", "", "oh-user-msg");
  const passwordTitle = make("h4", "Сменить пароль");
  const currentPassword = document.createElement("input");
  currentPassword.type = "password";
  currentPassword.placeholder = "Текущий пароль";
  const newPassword = document.createElement("input");
  newPassword.type = "password";
  newPassword.placeholder = "Новый пароль (от 6 символов)";
  const changePasswordButton = make("button", "Сохранить пароль");
  changePasswordButton.type = "button";
  changePasswordButton.addEventListener("click", async () => {
    message.className = "oh-user-msg";
    message.textContent = "";
    changePasswordButton.disabled = true;
    try {
      await accountRequest("/api/auth/password", {
        body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
        method: "POST",
      });
      message.className = "oh-user-msg oh-user-success";
      message.textContent = "Пароль изменён. Войдите заново.";
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      message.textContent = error.message;
      changePasswordButton.disabled = false;
    }
  });
  const logout = make("button", "Выйти", "ghost");
  logout.type = "button";
  logout.style.marginTop = "12px";
  logout.addEventListener("click", async () => {
    await accountRequest("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  });

  const panelHeader = make("div");
  panelHeader.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px";
  const panelTitle = make("h3", user.displayName || user.username);
  panelTitle.style.margin = "0";
  const closePanelButton = make("button", "×", "ghost");
  closePanelButton.type = "button";
  closePanelButton.title = "Закрыть";
  closePanelButton.style.fontSize = "1.2rem";
  closePanelButton.addEventListener("click", () => {
    root.style.display = "none";
    panel.style.display = "none";
  });
  panelHeader.append(panelTitle, closePanelButton);
  panel.append(
    panelHeader,
    make("p", `${user.username} · ${user.role === "admin" ? "администратор" : "игрок"}`),
    passwordTitle,
    currentPassword,
    newPassword,
    changePasswordButton,
    message,
  );

  if (user.role === "admin") {
    const adminTitle = make("h4", "Пользователи");
    const createForm = document.createElement("form");
    const createUsername = document.createElement("input");
    createUsername.placeholder = "Новый логин";
    createUsername.required = true;
    const createPassword = document.createElement("input");
    createPassword.type = "password";
    createPassword.placeholder = "Пароль (от 6 символов)";
    createPassword.required = true;
    const createRole = document.createElement("select");
    createRole.append(new Option("игрок", "player"), new Option("админ", "admin"));
    const createButton = make("button", "Добавить пользователя");
    createButton.type = "submit";
    const users = make("div");
    createForm.append(createUsername, createPassword, createRole, createButton);
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      createButton.disabled = true;
      try {
        await accountRequest("/api/auth/admin/users", {
          body: { password: createPassword.value, role: createRole.value, username: createUsername.value },
          method: "POST",
        });
        createUsername.value = "";
        createPassword.value = "";
        message.className = "oh-user-msg oh-user-success";
        message.textContent = "Пользователь добавлен.";
        await renderAdminUsers(users, message);
      } catch (error) {
        message.className = "oh-user-msg";
        message.textContent = error.message;
      } finally {
        createButton.disabled = false;
      }
    });
    const aiTitle = make("h4", "AI для игроков");
    const aiSettings = make("div");
    panel.append(adminTitle, createForm, users, aiTitle, aiSettings);
    renderAdminUsers(users, message);
    renderAdminAISettings(aiSettings, message);
  }
  panel.append(logout);
  root.append(panel);
  document.body.append(root);
  const open = () => {
    root.style.display = "block";
    panel.style.display = "block";
  };
  accountWidgetController = { open };
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) panel.style.display = "none";
  });
};

export const openUserAccountPanel = () => {
  if (!accountWidgetController) return;
  setTimeout(() => accountWidgetController.open(), 0);
};

export const initializeServerAuth = async () => {
  if (typeof window === "undefined" || import.meta.env.VITE_OH_WEB) return;
  installServerAuthFetch();

  let response;
  let payload;
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

  payload = await response.json().catch(() => ({}));
  if (payload?.required && !payload?.authenticated) {
    await showAccessGate({ invalid: Boolean(readStoredKey()) });
    response = await window.fetch("/api/auth/status", { cache: "no-store" });
    payload = await response.json().catch(() => ({}));
  }
  if (payload?.accountsRequired && !payload?.accountAuthenticated) {
    await showAccountGate({ registrationOpen: payload.registrationOpen !== false });
    response = await window.fetch("/api/auth/status", { cache: "no-store" });
    payload = await response.json().catch(() => ({}));
  }
  if (payload?.accountAuthenticated && payload.user) {
    installUserAccountWidget(payload.user);
  }
};
