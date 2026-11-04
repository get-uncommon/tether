(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/markets-ui.js
  var markets_ui_exports = {};
  __export(markets_ui_exports, {
    detectMarket: () => detectMarket,
    getLocalization: () => getLocalization,
    renderCountrySelects: () => renderCountrySelects,
    setCountry: () => setCountry
  });

  // tether-core:config.js
  var m = window.Tether.__core["config.js"];
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, warn } = m;

  // tether-core:client.js
  var m2 = window.Tether.__core["client.js"];
  var { TetherError, endpoint, gql, request, unwrap, withContext } = m2;

  // tether-core:cart.js
  var m3 = window.Tether.__core["cart.js"];
  var { Cart, focusables, toLineInput } = m3;

  // tether-core:collection.js
  var m4 = window.Tether.__core["collection.js"];
  var { ListScope, listSelector } = m4;

  // tether-core:loader.js
  var m5 = window.Tether.__core["loader.js"];
  var { clearProductCache, getProduct, getProducts, getRecommendations, hydrateProducts, normalizeProductKey, primeProduct, refreshProducts, takeStale } = m5;

  // tether-core:dom.js
  var m6 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, dataKey, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, readText, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setText, setTextTracked, show, toAttributes, watchImages } = m6;

  // tether-core:mounting.js
  var m7 = window.Tether.__core["mounting.js"];
  var { hydrateFromPage, liveLists, liveProducts, mountProduct, mountedLists, mountedProducts, pruneLive, retryFailed, within } = m7;

  // src/markets.js
  var COUNTRY = /^[A-Z]{2}$/;
  var REGIONAL_LANGUAGES = /* @__PURE__ */ new Set(["PT_BR", "PT_PT", "ZH_CN", "ZH_TW"]);
  var storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;
  var defaultEnv = () => ({
    document: typeof document !== "undefined" ? document : null,
    location: typeof window !== "undefined" ? window.location : null,
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
    global: typeof window !== "undefined" ? window : {}
  });
  function toCountry(v) {
    const c = String(v || "").trim().toUpperCase();
    return COUNTRY.test(c) && c !== "XX" && c !== "T1" ? c : null;
  }
  function toLanguage(v) {
    const raw = String(v || "").trim().replace("-", "_").toUpperCase();
    if (!raw) return null;
    if (REGIONAL_LANGUAGES.has(raw)) return raw;
    const primary = raw.split("_")[0];
    return /^[A-Z]{2,3}$/.test(primary) ? primary : null;
  }
  function readCookie(doc, name) {
    if (!doc || !name) return null;
    const hit = String(doc.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  }
  var lookup = (locales, key) => {
    if (!locales || !key) return null;
    const k = String(key).toLowerCase();
    const found = Object.keys(locales).find((x) => x.toLowerCase() === k);
    return found ? locales[found] : null;
  };
  var readers = {
    saved(m8, env) {
      if (m8.remember === false || !env.storage) return null;
      try {
        return JSON.parse(env.storage.getItem(storageKey()) || "null");
      } catch {
        return null;
      }
    },
    server(m8, env) {
      const meta = (name) => env.document?.querySelector?.(`meta[name="${name}"]`)?.getAttribute("content");
      const country = env.global.TETHER_COUNTRY || meta("tether-country") || readCookie(env.document, m8.cookie || "tether_country");
      const language = env.global.TETHER_LANGUAGE || meta("tether-language");
      return { country, language };
    },
    webflow(m8, env) {
      const segment = (env.location?.pathname || "/").split("/").filter(Boolean)[0];
      const fromPath = lookup(m8.locales, segment);
      if (fromPath) return fromPath;
      const lang = env.document?.documentElement?.getAttribute("lang");
      if (!lang) return null;
      const mapped = lookup(m8.locales, lang) || lookup(m8.locales, lang.split("-")[0]);
      if (mapped) return { locale: lang, ...mapped };
      if (m8.locales && m8.strict) return null;
      const region = lang.split("-")[1];
      return { language: lang, country: region && region.length === 2 ? region : null, locale: lang };
    }
  };
  function detectMarket(markets = cfg.markets, env = defaultEnv()) {
    const m8 = markets || {};
    if (m8.detect === false) return {};
    const list = !m8.detect ? ["saved"] : m8.detect === true ? ["saved", "server", "webflow"] : [].concat(m8.detect);
    markets = m8;
    const out = { sources: {} };
    list.forEach((name) => {
      const r = readers[name]?.(markets, env);
      if (!r) return;
      const vals = { country: toCountry(r.country), language: toLanguage(r.language), locale: r.locale || null };
      Object.entries(vals).forEach(([k, v]) => {
        if (v && !out[k]) {
          out[k] = v;
          out.sources[k] = name;
        }
      });
    });
    return out;
  }
  function rememberMarket(market) {
    if (cfg.markets?.remember === false) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ country: market.country, language: market.language || void 0, locale: market.locale || void 0 }));
    } catch {
    }
  }
  var localizationPromise = null;
  function clearLocalization() {
    localizationPromise = null;
  }
  function getLocalization() {
    if (!localizationPromise) {
      localizationPromise = gql(`query TetherLocalization{localization{country{isoCode name currency{isoCode symbol}}language{isoCode name}availableCountries{isoCode name currency{isoCode symbol}availableLanguages{isoCode name}}}}`).then((d) => d.localization).catch((err) => {
        localizationPromise = null;
        throw err;
      });
    }
    return localizationPromise;
  }

  // src/markets-ui.js
  function renderCountrySelects(root = document) {
    const selects = within(root, `select${sel("country-select")}`);
    const binds = within(root, sel("country-bind"));
    if (!selects.length && !binds.length) return Promise.resolve();
    return getLocalization().then((loc) => {
      const current = (cfg.country || loc.country?.isoCode || "").toUpperCase();
      const countries = [...loc.availableCountries || []].sort((a, b) => a.name.localeCompare(b.name, cfg.locale || void 0));
      const info = countries.find((c) => c.isoCode === current) || loc.country;
      const fill = (tpl, c) => tpl.replace(/\{name\}/g, c.name).replace(/\{code\}/g, c.isoCode).replace(/\{currency\}/g, c.currency?.isoCode || "").replace(/\{symbol\}/g, c.currency?.symbol || "");
      selects.forEach((s) => {
        const tpl = s.getAttribute(attr("country-label")) || "{name} ({currency})";
        const only = (s.getAttribute(attr("countries")) || "").toUpperCase().split(/[\s,]+/).filter(Boolean);
        const list = only.length ? only.map((c) => countries.find((x) => x.isoCode === c)).filter(Boolean) : countries;
        s.innerHTML = "";
        list.forEach((c) => s.appendChild(new Option(fill(tpl, c), c.isoCode)));
        s.value = current;
        if (s.value !== current) s.selectedIndex = -1;
        s.disabled = list.length < 2 && !s.hasAttribute(attr("always-enabled"));
      });
      binds.forEach((el) => {
        const k = get(el, "country-bind") || "name";
        const v = { name: info?.name, code: info?.isoCode, currency: info?.currency?.isoCode, symbol: info?.currency?.symbol }[k];
        el.textContent = v || "";
      });
    }).catch((err) => reportError(err, "country select"));
  }
  async function setCountry(code, { language, locale, remember = true } = {}) {
    const country = toCountry(code);
    if (!country) throw new TetherError(`Not a country code: ${code}`, { code: "INVALID_COUNTRY" });
    const entry = Object.values(cfg.markets?.locales || {}).find((m8) => toCountry(m8?.country) === country);
    const own = locale || entry?.locale;
    const loc = own || cfg.locale;
    const lang = language !== void 0 ? toLanguage(language) : entry ? entry.language ? toLanguage(entry.language) : void 0 : cfg.language;
    const changed = country !== String(cfg.country || "").toUpperCase() || lang !== cfg.language || loc !== cfg.locale;
    cfg.country = country;
    cfg.language = lang || void 0;
    cfg.locale = loc;
    if (remember) rememberMarket({ country, language: lang, locale: own });
    if (!changed) {
      renderCountrySelects();
      return Cart.state;
    }
    clearProductCache();
    const jobs = [];
    if (language !== void 0) clearLocalization();
    if (Cart.id()) jobs.push(Cart.setBuyerIdentity({ countryCode: country }, { create: false }).catch((err) => reportError(err, "cart country")));
    pruneLive();
    liveLists.forEach((list) => jobs.push(list.load()));
    liveProducts.forEach((el) => {
      if (el.closest(listSelector())) return;
      mountedProducts.delete(el);
      mountProduct(el);
    });
    renderCountrySelects();
    emit("country-changed", { country, language: cfg.language });
    await Promise.all(jobs);
    return Cart.state;
  }

  // src/parts/markets.js
  window.Tether.__parts.markets = markets_ui_exports;
})();
