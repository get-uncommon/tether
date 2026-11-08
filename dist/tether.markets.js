(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/markets-ui.ts
  var markets_ui_exports = {};
  __export(markets_ui_exports, {
    detectMarket: () => detectMarket,
    getLocalization: () => getLocalization,
    renderCountrySelects: () => renderCountrySelects,
    setCountry: () => setCountry
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:client.ts
  var m2 = window.Tether.__core["client.ts"];
  var [endpoint, gql, matches, orNull, shaped, TetherError, withTimeout] = m2;

  // tether-core:cart.ts
  var m3 = window.Tether.__core["cart.ts"];
  var [Cart] = m3;

  // tether-core:collection.ts
  var m4 = window.Tether.__core["collection.ts"];
  var [listSelector] = m4;

  // tether-core:loader.ts
  var m5 = window.Tether.__core["loader.ts"];
  var [clearProductCache, getProduct, normalizeProductKey, primeProduct, withProductFragment] = m5;

  // tether-core:dom.ts
  var m6 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, busy, emit, formatDate, formatMoney, get, has, hasTemplate, integerAttribute, isElement, isField, isOwnEvent, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, scoped, sel, setImage, setStoreHtml, setText, show] = m6;

  // tether-core:mounting.ts
  var m7 = window.Tether.__core["mounting.ts"];
  var [liveLists, liveProducts, mountedProducts, mountProduct, pruneLive, within] = m7;

  // tether-core:market-codes.ts
  var m8 = window.Tether.__core["market-codes.ts"];
  var [toCountry, toLanguage] = m8;

  // src/storage.ts
  function getStored(key, area = "localStorage") {
    try {
      return window[area].getItem(key);
    } catch {
      return null;
    }
  }
  function setStored(key, value, area = "localStorage") {
    try {
      window[area].setItem(key, value);
    } catch {
    }
  }

  // src/uri.ts
  function decodeOrKeep(text) {
    try {
      return decodeURIComponent(text);
    } catch (error) {
      if (error instanceof URIError) return text;
      throw error;
    }
  }

  // src/markets.ts
  var DEFAULT_COOKIE = "tether_country";
  var storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;
  var pageStorage = { getItem: (key) => getStored(key) };
  function pageEnv() {
    const hasWindow = typeof window !== "undefined";
    return {
      document: typeof document !== "undefined" ? document : null,
      location: hasWindow ? window.location : null,
      storage: pageStorage,
      global: hasWindow ? window : {}
    };
  }
  function parseJsonOrNull(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
  function toMarket(value) {
    if (typeof value !== "object" || value === null) return null;
    const country = toCountry(Reflect.get(value, "country"));
    if (!country) return null;
    const locale = Reflect.get(value, "locale");
    return {
      country,
      language: toLanguage(Reflect.get(value, "language")) ?? void 0,
      locale: typeof locale === "string" && locale ? locale : void 0
    };
  }
  var parseSavedMarket = (text) => toMarket(parseJsonOrNull(text));
  function readSavedMarket(storage = pageStorage) {
    const text = storage.getItem(storageKey());
    return text ? parseSavedMarket(text) : null;
  }
  function readCookie(doc, name) {
    if (!doc || !name) return null;
    const cookie = doc.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return cookie ? decodeOrKeep(cookie.slice(name.length + 1)) : null;
  }
  function lookupLocale(locales, key) {
    if (!locales || !key) return null;
    const wanted = key.toLowerCase();
    const found = Object.keys(locales).find((name) => name.toLowerCase() === wanted);
    return found ? locales[found] ?? null : null;
  }
  function readServerHint(markets, env) {
    const meta = (name) => env.document?.querySelector(`meta[name="${name}"]`)?.getAttribute("content");
    const globalCountry = Reflect.get(env.global, "TETHER_COUNTRY");
    const globalLanguage = Reflect.get(env.global, "TETHER_LANGUAGE");
    const pageCountry = meta("tether-country") || readCookie(env.document, markets.cookie || DEFAULT_COOKIE);
    return {
      country: globalCountry || pageCountry,
      language: globalLanguage || meta("tether-language")
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
  function sourcesFor(detect) {
    if (!detect) return ["saved"];
    return detect === true ? MARKET_SOURCES : detect;
  }
  function detectMarket(markets = cfg.markets, env = pageEnv()) {
    const config = (markets === cfg.markets ? markets : parseMarkets(markets)) ?? {};
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
  function rememberMarket(market) {
    if (cfg.markets?.remember === false) return;
    const saved = { country: market.country, language: market.language || void 0, locale: market.locale || void 0 };
    setStored(storageKey(), JSON.stringify(saved));
  }

  // src/markets-ui.ts
  var DEFAULT_LABEL = "{name} ({currency})";
  var DEFAULT_BIND = "name";
  var localizationPromise = null;
  function clearLocalization() {
    localizationPromise = null;
  }
  var LOCALIZATION_QUERY = `query TetherLocalization{localization{country{isoCode name currency{isoCode symbol}}language{isoCode name}availableCountries{isoCode name currency{isoCode symbol}availableLanguages{isoCode name}}}}`;
  var COUNTRY = { isoCode: "string", name: "string", currency: "object" };
  var isLocalizationAnswer = shaped({
    localization: { country: COUNTRY, availableCountries: [COUNTRY] }
  });
  function getLocalization() {
    localizationPromise ?? (localizationPromise = gql(LOCALIZATION_QUERY, {}, isLocalizationAnswer).then(
      (data) => data.localization,
      (error) => {
        localizationPromise = null;
        throw error;
      }
    ));
    return localizationPromise;
  }
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
  var fillLabel = (template, country) => template.replace(/\{(name|code|currency|symbol)\}/g, (_match, field) => countryField(country, field));
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
  var followingSelects = false;
  function onCountrySelectChange(event) {
    const { target } = event;
    if (!(target instanceof window.HTMLSelectElement) || !target.matches(sel("country-select")) || !target.value) return;
    setCountry(target.value).catch((error) => {
      reportError(error, "country");
    });
  }
  function renderCountrySelects(root = document) {
    const selects = within(root, `select${sel("country-select")}`);
    const binds = within(root, sel("country-bind"));
    if (selects.length && !followingSelects) {
      followingSelects = true;
      document.addEventListener("change", onCountrySelectChange);
    }
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
    const changed = country !== cfg.country || nextLanguage !== cfg.language || nextLocale !== cfg.locale;
    const previousLanguage = cfg.language;
    cfg.country = country;
    cfg.language = nextLanguage || void 0;
    cfg.locale = nextLocale;
    if (remember) rememberMarket({ country, language: nextLanguage, locale: ownLocale });
    if (!changed) {
      void renderCountrySelects();
      return Cart.state;
    }
    if (cfg.language !== previousLanguage) clearLocalization();
    const jobs = rerenderInMarket(country);
    void renderCountrySelects();
    emit("country-changed", { country, language: cfg.language });
    await Promise.all(jobs);
    return Cart.state;
  }

  // server/src/shared/json.ts
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // src/part-registry.ts
  function isTetherInternals(value) {
    return isRecord(value) && isRecord(value["__core"]) && isRecord(value["__parts"]);
  }
  function registerPart(name, part) {
    const tether = Reflect.get(window, "Tether");
    if (!isTetherInternals(tether)) {
      throw new Error(`tether.${name}.js runs after the Tether script, which loads it, and needs its window.Tether`);
    }
    tether.__parts[name] = part;
  }

  // src/parts/markets.ts
  registerPart("markets", markets_ui_exports);
})();
