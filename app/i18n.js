(function () {
  const STORAGE_KEY = "poc.locale";
  const DEFAULT_LOCALE = "en";
  const SUPPORTED_LOCALES = [
    { code: "en", name: "English", flag: "\uD83C\uDDEC\uD83C\uDDE7" },
    { code: "es", name: "Espa\u00f1ol", flag: "\uD83C\uDDEA\uD83C\uDDF8" },
    { code: "pt", name: "Portugu\u00eas", flag: "\uD83C\uDDE7\uD83C\uDDF7" },
    { code: "ru", name: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439", flag: "\uD83C\uDDF7\uD83C\uDDFA" },
    { code: "zh-Hans", name: "\u7b80\u4f53\u4e2d\u6587", flag: "\uD83C\uDDE8\uD83C\uDDF3" },
    { code: "hi", name: "\u0939\u093f\u0928\u094d\u0926\u0940", flag: "\uD83C\uDDEE\uD83C\uDDF3" },
  ];
  const SUPPORTED_CODES = SUPPORTED_LOCALES.map((locale) => locale.code);

  const state = {
    locale: DEFAULT_LOCALE,
    messages: {},
    fallback: {},
    ready: null,
  };

  function localeBaseUrl() {
    const script = document.currentScript || document.querySelector('script[src$="i18n.js"]');
    return new URL("locales/", script ? script.src : window.location.href);
  }

  function normalizeLocale(value) {
    if (!value) return "";
    const raw = String(value).trim();
    const lower = raw.toLowerCase();
    if (lower === "zh" || lower === "zh-cn" || lower === "zh-sg" || lower === "zh-hans") {
      return "zh-Hans";
    }
    if (SUPPORTED_CODES.includes(raw)) return raw;
    const exact = SUPPORTED_CODES.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;
    const language = lower.split("-")[0];
    return SUPPORTED_CODES.find((code) => code.toLowerCase().split("-")[0] === language) || "";
  }

  function readStoredLocale() {
    try {
      return normalizeLocale(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return "";
    }
  }

  function persistLocale(locale) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (error) {
      // Storage is optional; the URL/browser fallback still works.
    }
  }

  function detectLocale() {
    const params = new URLSearchParams(window.location.search);
    const urlLocale = normalizeLocale(params.get("lang"));
    if (urlLocale) {
      persistLocale(urlLocale);
      return urlLocale;
    }
    const storedLocale = readStoredLocale();
    if (storedLocale) return storedLocale;
    const browserLocales = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    for (const locale of browserLocales) {
      const match = normalizeLocale(locale);
      if (match) return match;
    }
    return DEFAULT_LOCALE;
  }

  async function fetchLocale(locale) {
    const response = await fetch(new URL(`${locale}.json`, localeBaseUrl()), { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Locale ${locale} returned ${response.status}`);
    }
    return response.json();
  }

  function lookup(messages, key) {
    return key.split(".").reduce((value, part) => (
      value && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined
    ), messages);
  }

  function interpolate(template, params = {}) {
    return String(template).replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match
    ));
  }

  function developmentWarning(message) {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "") {
      console.warn(message);
    }
  }

  function t(key, params = {}) {
    let value = lookup(state.messages, key);
    if (value === undefined) {
      value = lookup(state.fallback, key);
      if (value === undefined) {
        developmentWarning(`[i18n] Missing key "${key}"`);
        return key;
      }
      developmentWarning(`[i18n] Missing "${key}" for ${state.locale}; using English fallback.`);
    }
    if (value && typeof value === "object") {
      const pluralKey = Number(params.count) === 1 ? "one" : "other";
      value = value[pluralKey] ?? value.other ?? value.one ?? key;
    }
    return interpolate(value, params);
  }

  function attrNameFromToken(token) {
    if (token === "html") return "html";
    if (token === "text") return "text";
    return token;
  }

  function applyTranslations(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr.split(";").forEach((entry) => {
        const [rawAttr, rawKey] = entry.split(":").map((part) => part && part.trim());
        if (!rawAttr || !rawKey) return;
        const attr = attrNameFromToken(rawAttr);
        if (attr === "text") el.textContent = t(rawKey);
        else if (attr === "html") el.innerHTML = t(rawKey);
        else el.setAttribute(attr, t(rawKey));
      });
    });
  }

  function setLocaleInUrl(locale) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", locale);
    window.history.replaceState({}, "", url.toString());
  }

  async function changeLocale(locale) {
    const nextLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
    if (nextLocale === state.locale) return;

    state.locale = nextLocale;
    persistLocale(nextLocale);
    setLocaleInUrl(nextLocale);
    state.messages = nextLocale === DEFAULT_LOCALE ? state.fallback : await fetchLocale(nextLocale);
    refreshDocumentMeta();
    applyTranslations();

    const selector = document.querySelector("[data-language-selector]");
    if (selector) {
      selector.value = nextLocale;
      selector.setAttribute("aria-label", t("language.selectorLabel"));
    }

    window.dispatchEvent(new CustomEvent("poc:locale-ready", { detail: { locale: state.locale } }));
  }

  function mountLanguageSelector() {
    if (document.querySelector("[data-language-selector]")) return;
    const select = document.createElement("select");
    select.className = "language-select";
    select.setAttribute("aria-label", t("language.selectorLabel"));
    select.dataset.languageSelector = "true";
    select.innerHTML = SUPPORTED_LOCALES.map((locale) => (
      `<option value="${locale.code}" ${locale.code === state.locale ? "selected" : ""}>${locale.flag} ${locale.name}</option>`
    )).join("");
    select.addEventListener("change", () => {
      changeLocale(select.value).catch((error) => {
        console.error(error);
      });
    });

    const wrap = document.createElement("label");
    wrap.className = "language-switcher";
    wrap.append(select);

    const appNav = document.querySelector(".header-nav");
    const themeToggle = document.querySelector("#themeToggle");
    if (appNav && themeToggle) {
      appNav.insertBefore(wrap, themeToggle);
      return;
    }
    const landingHeader = document.querySelector(".landing-header");
    const landingCta = document.querySelector(".landing-header .button");
    if (landingHeader && landingCta) {
      landingHeader.insertBefore(wrap, landingCta);
    }
  }

  function refreshDocumentMeta() {
    document.documentElement.lang = state.locale;
    document.documentElement.dir = "ltr";
    document.title = t(document.body?.dataset.i18nTitle || "meta.defaultTitle");
  }

  async function init() {
    state.locale = detectLocale();
    state.fallback = await fetchLocale(DEFAULT_LOCALE);
    state.messages = state.locale === DEFAULT_LOCALE ? state.fallback : await fetchLocale(state.locale);
    refreshDocumentMeta();
    applyTranslations();
    mountLanguageSelector();
    window.dispatchEvent(new CustomEvent("poc:locale-ready", { detail: { locale: state.locale } }));
  }

  state.ready = init().catch(async (error) => {
    console.error(error);
    state.locale = DEFAULT_LOCALE;
    state.fallback = await fetchLocale(DEFAULT_LOCALE);
    state.messages = state.fallback;
    refreshDocumentMeta();
    applyTranslations();
    mountLanguageSelector();
  });

  window.pocI18n = {
    ready: state.ready,
    t,
    applyTranslations,
    changeLocale,
    get locale() {
      return state.locale;
    },
    get supportedLocales() {
      return [...SUPPORTED_LOCALES];
    },
    formatNumber(value, options) {
      return new Intl.NumberFormat(state.locale, options).format(value);
    },
    formatDate(value, options) {
      return new Intl.DateTimeFormat(state.locale, options).format(value);
    },
  };
})();
