"use strict";
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
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, resolveConfig, toMetafieldIdentifier, warn } = m;

  // tether-core:client.js
  var m2 = window.Tether.__core["client.js"];
  var { TetherError, endpoint, gql, request, unwrap, withContext } = m2;

  // tether-core:cart.js
  var m3 = window.Tether.__core["cart.js"];
  var { Cart, trapFocus } = m3;

  // tether-core:collection.js
  var m4 = window.Tether.__core["collection.js"];
  var { ListScope, listSelector } = m4;

  // tether-core:loader.js
  var m5 = window.Tether.__core["loader.js"];
  var { clearProductCache, getProduct, getProducts, getRecommendations, hydrateProducts, normalizeProductKey, primeProduct, refreshProducts, takeStale } = m5;

  // tether-core:dom.js
  var m6 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setStoreHtml, setText, setTextTracked, show, toAttributes, watchImages } = m6;

  // tether-core:mounting.js
  var m7 = window.Tether.__core["mounting.js"];
  var { hydrateFromPage, liveLists, liveProducts, mountProduct, mountedLists, mountedProducts, pruneLive, retryFailed, settleMarket, trackMarket, within } = m7;

  // tether-core:market-codes.js
  var m8 = window.Tether.__core["market-codes.js"];
  var { toCountry, toLanguage } = m8;

  // src/markets.js
  var ALL_SOURCES = ["saved", "server", "webflow"];
  var DEFAULT_COOKIE = "tether_country";
  var storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;
  function localStorageIfAllowed() {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  function pageEnv() {
    const hasWindow = typeof window !== "undefined";
    return {
      document: typeof document !== "undefined" ? document : null,
      location: hasWindow ? window.location : null,
      storage: localStorageIfAllowed(),
      global: hasWindow ? window : {}
    };
  }
  function parseJsonOrNull(text) {
    try {
      return (
        /** @type {unknown} */
        JSON.parse(text)
      );
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
  function toMarket(value) {
    if (typeof value !== "object" || value === null) return null;
    const country = toCountry(Reflect.get(value, "country"));
    if (!country) return null;
    const locale = (
      /** @type {unknown} */
      Reflect.get(value, "locale")
    );
    return {
      country,
      language: toLanguage(Reflect.get(value, "language")) ?? void 0,
      locale: typeof locale === "string" && locale ? locale : void 0
    };
  }
  function readSavedMarket(storage = localStorageIfAllowed()) {
    const text = storage?.getItem(storageKey());
    return text ? toMarket(parseJsonOrNull(text)) : null;
  }
  function readCookie(doc, name) {
    if (!doc || !name) return null;
    const cookie = doc.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
  }
  function lookupLocale(locales, key) {
    if (!locales || !key) return null;
    const wanted = key.toLowerCase();
    const found = Object.keys(locales).find((name) => name.toLowerCase() === wanted);
    return found ? locales[found] ?? null : null;
  }
  function readServerHint(markets, env) {
    const meta = (name) => env.document?.querySelector(`meta[name="${name}"]`)?.getAttribute("content");
    return {
      country: Reflect.get(env.global, "TETHER_COUNTRY") || meta("tether-country") || readCookie(env.document, markets.cookie || DEFAULT_COOKIE),
      language: Reflect.get(env.global, "TETHER_LANGUAGE") || meta("tether-language")
    };
  }
  function readWebflowLocale(markets, env) {
    const segment = (env.location?.pathname ?? "/").split("/").find((part) => part !== "");
    const fromPath = lookupLocale(markets.locales, segment);
    if (fromPath) return fromPath;
    const lang = env.document?.documentElement.getAttribute("lang");
    if (!lang) return null;
    const mapped = lookupLocale(markets.locales, lang) ?? lookupLocale(markets.locales, lang.split("-")[0]);
    if (mapped) return { locale: lang, ...mapped };
    if (markets.locales && markets.strict) return null;
    const region = lang.split("-")[1];
    return { language: lang, country: region?.length === 2 ? region : null, locale: lang };
  }
  function readSource(source, markets, env) {
    switch (source) {
      case "saved":
        return markets.remember === false ? null : readSavedMarket(env.storage);
      case "server":
        return readServerHint(markets, env);
      case "webflow":
        return readWebflowLocale(markets, env);
    }
  }
  var isMarketSource = (name) => ALL_SOURCES.some((source) => source === name);
  function sourcesFor(detect) {
    if (!detect) return ["saved"];
    if (detect === true) return ALL_SOURCES;
    return (
      /** @type {unknown[]} */
      [detect].flat().filter(isMarketSource)
    );
  }
  function detectMarket(markets = cfg.markets, env = pageEnv()) {
    const config = markets ?? {};
    if (config.detect === false) return {};
    const sources = {};
    const found = { sources };
    for (const source of sourcesFor(config.detect)) {
      const hint = readSource(source, config, env);
      if (!hint) continue;
      const country = toCountry(hint.country);
      const language = toLanguage(hint.language);
      const locale = typeof hint.locale === "string" && hint.locale ? hint.locale : null;
      if (country && !found.country) {
        found.country = country;
        sources.country = source;
      }
      if (language && !found.language) {
        found.language = language;
        sources.language = source;
      }
      if (locale && !found.locale) {
        found.locale = locale;
        sources.locale = source;
      }
    }
    return found;
  }
  function storeIfAllowed(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      return;
    }
  }
  function rememberMarket(market) {
    if (cfg.markets?.remember === false) return;
    const saved = { country: market.country, language: market.language || void 0, locale: market.locale || void 0 };
    storeIfAllowed(storageKey(), JSON.stringify(saved));
  }
  var localizationPromise = null;
  function clearLocalization() {
    localizationPromise = null;
  }
  var LOCALIZATION_QUERY = `query TetherLocalization{localization{country{isoCode name currency{isoCode symbol}}language{isoCode name}availableCountries{isoCode name currency{isoCode symbol}availableLanguages{isoCode name}}}}`;
  function getLocalization() {
    if (!localizationPromise) {
      const loading = gql(LOCALIZATION_QUERY);
      localizationPromise = loading.then(
        (data) => data.localization,
        (error) => {
          localizationPromise = null;
          throw error;
        }
      );
    }
    return localizationPromise;
  }

  // src/markets-ui.js
  var DEFAULT_LABEL = "{name} ({currency})";
  var DEFAULT_BIND = "name";
  function countryField(country, field) {
    switch (field) {
      case "name":
        return country.name;
      case "code":
        return country.isoCode;
      case "currency":
        return country.currency.isoCode;
      case "symbol":
        return country.currency.symbol;
      default:
        return "";
    }
  }
  var fillLabel = (template, country) => template.replace(
    /\{(name|code|currency|symbol)\}/g,
    (_match, field) => countryField(country, field)
  );
  function fillCountrySelect(select, countries, current) {
    const template = select.getAttribute(attr("country-label")) || DEFAULT_LABEL;
    const only = (select.getAttribute(attr("countries")) || "").toUpperCase().split(/[\s,]+/).filter(Boolean);
    const listed = only.length ? only.map((code) => countries.find((country) => country.isoCode === code)).filter((country) => country !== void 0) : countries;
    select.replaceChildren(...listed.map((country) => new Option(fillLabel(template, country), country.isoCode)));
    select.value = current;
    if (select.value !== current) select.selectedIndex = -1;
    select.disabled = listed.length < 2 && !select.hasAttribute(attr("always-enabled"));
  }
  function fillCountries(selects, binds, localization) {
    const current = (cfg.country || localization.country.isoCode).toUpperCase();
    const countries = [...localization.availableCountries].sort(
      (a, b) => a.name.localeCompare(b.name, cfg.locale || void 0)
    );
    const inUse = countries.find((country) => country.isoCode === current) ?? localization.country;
    selects.forEach((select) => {
      fillCountrySelect(select, countries, current);
    });
    binds.forEach((el) => {
      el.textContent = countryField(inUse, get(el, "country-bind") || DEFAULT_BIND);
    });
  }
  function renderCountrySelects(root = document) {
    const selects = (
      /** @type {HTMLSelectElement[]} */
      within(root, `select${sel("country-select")}`)
    );
    const binds = within(root, sel("country-bind"));
    if (!selects.length && !binds.length) return Promise.resolve();
    return getLocalization().then((localization) => {
      fillCountries(selects, binds, localization);
    }).catch((error) => {
      reportError(error, "country select");
    });
  }
  var localeEntryFor = (country) => Object.values(cfg.markets?.locales ?? {}).find((entry) => toCountry(entry.country) === country);
  function languageFor(language, entry) {
    if (language !== void 0) return toLanguage(language);
    if (!entry) return cfg.language;
    return entry.language ? toLanguage(entry.language) : void 0;
  }
  function rerenderInMarket(country) {
    clearProductCache();
    const jobs = [];
    if (Cart.id()) {
      jobs.push(
        Cart.setBuyerIdentity({ countryCode: country }, { create: false }).catch((error) => {
          reportError(error, "cart country");
        })
      );
    }
    pruneLive();
    liveLists.forEach((list) => jobs.push(list.load()));
    liveProducts.forEach((el) => {
      if (el.closest(listSelector())) return;
      mountedProducts.delete(el);
      mountProduct(el);
    });
    return jobs;
  }
  async function setCountry(code, { language, locale, remember = true } = {}) {
    const country = toCountry(code);
    if (!country) throw new TetherError(`Not a country code: ${code}`, { code: "INVALID_COUNTRY" });
    const entry = localeEntryFor(country);
    const ownLocale = locale || entry?.locale;
    const nextLocale = ownLocale || cfg.locale;
    const nextLanguage = languageFor(language, entry);
    const changed = country !== cfg.country?.toUpperCase() || nextLanguage !== cfg.language || nextLocale !== cfg.locale;
    cfg.country = country;
    cfg.language = nextLanguage || void 0;
    cfg.locale = nextLocale;
    if (remember) rememberMarket({ country, language: nextLanguage, locale: ownLocale });
    if (!changed) {
      void renderCountrySelects();
      return Cart.state;
    }
    if (language !== void 0) clearLocalization();
    const jobs = rerenderInMarket(country);
    void renderCountrySelects();
    emit("country-changed", { country, language: cfg.language });
    await Promise.all(jobs);
    return Cart.state;
  }

  // src/parts/markets.js
  var { Tether } = (
    /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */
    window
  );
  if (!Tether) throw new Error("tether.markets.js runs after the Tether script, which loads it");
  Tether.__parts["markets"] = markets_ui_exports;
})();
