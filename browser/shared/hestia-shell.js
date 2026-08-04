const THEME_KEY = "gw-theme";
const THEMES = new Set(["auto", "light", "dark"]);
const media = window.matchMedia("(prefers-color-scheme: dark)");
const root = document.documentElement;

function parseTheme(value) {
  return THEMES.has(value) ? value : "auto";
}

function readCookie() {
  const prefix = `${THEME_KEY}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? parseTheme(decodeURIComponent(entry.slice(prefix.length))) : null;
}

function readPreference() {
  const cookie = readCookie();
  if (cookie) return cookie;
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "auto";
  }
}

function persistPreference(preference) {
  const secure = location.protocol === "https:";
  const domain = location.hostname === "greenways.ai" || location.hostname.endsWith(".greenways.ai")
    ? "; Domain=greenways.ai"
    : "";
  document.cookie = `${THEME_KEY}=${encodeURIComponent(preference)}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${secure ? "; Secure" : ""}`;
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Storage can be unavailable in hardened or private browsing contexts.
  }
}

let preference = readPreference();

function resolvedTheme(nextPreference = preference) {
  return nextPreference === "auto"
    ? (media.matches ? "dark" : "light")
    : nextPreference;
}

function updateControls(resolved) {
  const automatic = preference === "auto";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const next = resolved === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${next} theme${automatic ? "; currently following the system" : ""}. Shift-click to follow the system theme.`);
    button.setAttribute("aria-pressed", resolved === "dark" ? "true" : "false");
    button.dataset.themeResolved = resolved;
    button.dataset.themePreference = preference;
  });
}

function updateThemeColor(resolved) {
  const color = resolved === "dark" ? "#050a08" : "#f4f2ec";
  document.querySelectorAll('meta[name="theme-color"]:not([media])').forEach((meta) => {
    meta.setAttribute("content", color);
  });
}

function applyTheme(nextPreference = preference, persist = false) {
  preference = parseTheme(nextPreference);
  const resolved = resolvedTheme(preference);
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  if (persist) persistPreference(preference);
  updateControls(resolved);
  updateThemeColor(resolved);
  window.dispatchEvent(new CustomEvent("gw-theme-change", {
    detail: { preference, resolvedTheme: resolved }
  }));
  return resolved;
}

function installControls() {
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const current = root.dataset.theme === "dark" ? "dark" : "light";
      const next = event.shiftKey ? "auto" : current === "dark" ? "light" : "dark";
      applyTheme(next, true);
    });
  });
}

media.addEventListener?.("change", () => {
  if (preference === "auto") applyTheme("auto");
});

window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY) applyTheme(parseTheme(event.newValue));
});

window.HestiaTheme = {
  apply: (next, persist = true) => applyTheme(next, persist),
  get preference() { return preference; }
};

applyTheme(preference);
installControls();
