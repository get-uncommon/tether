(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // server/src/shared/api-versions.ts
  var STOREFRONT_API_VERSION = "2026-07";

  // src/api-version.ts
  var QUARTERLY_VERSION = /^(\d{4})-(01|04|07|10)$/;
  var AVERAGE_MONTH_MS = 30.44 * 24 * 3600 * 1e3;
  function parseVersion(version) {
    const match = QUARTERLY_VERSION.exec(typeof version === "string" ? version : "");
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  }
  var isQuarterlyVersion = (version) => parseVersion(version) !== null;

  // server/src/shared/json.ts
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function field(value, key) {
    return isRecord(value) ? value[key] : void 0;
  }

  // server/src/shared/metafield-ref.ts
  var METAFIELD_KEY = /^[A-Za-z0-9_.-]+$/;
  var METAFIELD_NAMESPACE = /^(\$app(:[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+)$/;
  var isMetafieldIdentifier = (namespace, key) => METAFIELD_NAMESPACE.test(namespace) && METAFIELD_KEY.test(key);
  function metafieldIdentifierOf(ref) {
    const dot = ref.indexOf(".");
    if (dot <= 0) return null;
    const namespace = ref.slice(0, dot);
    const key = ref.slice(dot + 1);
    return isMetafieldIdentifier(namespace, key) ? { namespace, key } : null;
  }

  // src/config-sections.ts
  var HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
  var COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  var GLOBAL_NAME = /^[A-Za-z_$][\w$]*$/;
  var SITE_ORIGIN = "https://site.invalid";
  var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]"]);
  var MARKET_SOURCES = ["saved", "server", "webflow"];
  var CONSENT_MODES = [
    "no-banner",
    "default-banner",
    "custom-banner"
  ];
  var isText = (value) => typeof value === "string" && value !== "";
  var isFunction = (value) => typeof value === "function";
  function domainOption(value, invalid) {
    if (typeof value !== "string" || !value) return "";
    const host = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (isHostname(host)) return host;
    invalid("domain", value);
    return "";
  }
  function isSiteOrHttpsUrl(value) {
    if (!isText(value)) return false;
    try {
      const url2 = new URL(value, `${SITE_ORIGIN}/`);
      if (url2.origin === SITE_ORIGIN) return true;
      return url2.protocol === "https:" || url2.protocol === "http:" && LOOPBACK_HOSTS.has(url2.hostname);
    } catch {
      return false;
    }
  }
  function partsUrlOption(value, invalid) {
    if (value === void 0 || value === null || value === "") return null;
    if (typeof value === "string" && (isSiteOrHttpsUrl(value) || isPageOrigin(value))) return value;
    invalid("partsUrl", value);
    return null;
  }
  function isPageOrigin(value) {
    if (typeof location === "undefined") return false;
    try {
      return new URL(value).origin === location.origin;
    } catch {
      return false;
    }
  }
  function toHttpsOrigin(value) {
    if (typeof value !== "string") return null;
    try {
      const url2 = new URL(value);
      return url2.protocol === "https:" && url2.href === new URL(url2.origin).href ? url2.origin : null;
    } catch {
      return null;
    }
  }
  function embedOriginsOption(value, invalid) {
    if (!Array.isArray(value)) {
      invalid("embedOrigins", value);
      return [];
    }
    const origins = [];
    const entries = value;
    for (const entry of entries) {
      const origin = toHttpsOrigin(entry);
      if (origin) origins.push(origin);
      else invalid("embedOrigin", entry);
    }
    return origins;
  }
  function toMetafieldIdentifier(ref) {
    if (typeof ref === "string") return metafieldIdentifierOf(ref);
    if (typeof ref !== "object" || ref === null) return null;
    const namespace = Reflect.get(ref, "namespace");
    const key = Reflect.get(ref, "key");
    if (typeof namespace !== "string" || typeof key !== "string") return null;
    return isMetafieldIdentifier(namespace, key) ? { namespace, key } : null;
  }
  function metafieldsOption(value, invalid) {
    if (!Array.isArray(value)) {
      invalid("metafields", value);
      return [];
    }
    const refs = [];
    const entries = value;
    for (const ref of entries) {
      const identifier = toMetafieldIdentifier(ref);
      if (identifier) refs.push(typeof ref === "string" ? ref : identifier);
      else invalid("metafield", ref);
    }
    return refs;
  }
  var when = (check) => (value) => check(value) ? value : void 0;
  var isHostname = (value) => isText(value) && HOSTNAME.test(value);
  var isCookieName = (value) => isText(value) && COOKIE_NAME.test(value);
  var isDataLayer = (value) => typeof value === "boolean" || isText(value) && GLOBAL_NAME.test(value);
  var url = when(isSiteOrHttpsUrl);
  var text = when(isText);
  var flag = when((value) => typeof value === "boolean");
  var hook = when(isFunction);
  function sectionOption(name, value, schema, invalid) {
    if (value === null || value === void 0) return null;
    if (!isRecord(value)) {
      invalid(name, value);
      return null;
    }
    const section = {};
    for (const key in schema) {
      const field2 = value[key];
      if (field2 === void 0) continue;
      const parsed = schema[key](field2);
      if (parsed === void 0) invalid(`${name}.${key}`, field2);
      else section[key] = parsed;
    }
    return section;
  }
  var ACCOUNT = {
    server: url,
    orderUrl: url,
    subscriptionsUrl: url,
    paymentUrl: url,
    logoutUrl: url,
    locale: text,
    navigate: hook
  };
  var ACCOUNT_NEEDS_SERVER = "customer accounts need the Worker since 0.7.0: set account.server";
  var LOCALE_MARKET = { country: text, language: text, locale: text };
  var MARKETS = {
    // A single source name counts as a list of one.
    detect: (value) => {
      if (typeof value === "boolean") return value;
      const names = Array.isArray(value) ? value : [value];
      return typeof value === "string" || Array.isArray(value) ? MARKET_SOURCES.filter((source) => names.includes(source)) : void 0;
    },
    locales: (value) => {
      if (!isRecord(value)) return void 0;
      const locales = {};
      for (const [locale, entry] of Object.entries(value)) {
        const market = sectionOption(`markets.locales.${locale}`, entry, LOCALE_MARKET, () => void 0);
        if (market) locales[locale] = market;
      }
      return locales;
    },
    cookie: when(isCookieName),
    remember: flag,
    strict: flag
  };
  var SHOPIFY_ANALYTICS = {
    consent: (value) => CONSENT_MODES.find((mode) => mode === value),
    proxy: (value) => value !== void 0 && Boolean(value)
  };
  var ANALYTICS = {
    dataLayer: when(isDataLayer),
    shopify: (value) => typeof value === "boolean" ? value : sectionOption("analytics.shopify", value, SHOPIFY_ANALYTICS, () => void 0) ?? void 0,
    onEvent: hook
  };
  function accountOption(value, invalid, warn2) {
    const account = sectionOption("account", value, ACCOUNT, invalid);
    if (account === null) return null;
    const { server } = account;
    if (server === void 0) {
      warn2(ACCOUNT_NEEDS_SERVER);
      return null;
    }
    return { ...account, server };
  }
  var marketsOption = (value, invalid) => sectionOption("markets", value, MARKETS, invalid);
  var analyticsOption = (value, invalid) => sectionOption("analytics", value, ANALYTICS, invalid);

  // server/src/shared/market-codes.ts
  var COUNTRY = /^[A-Z]{2}$/;
  var NOT_A_COUNTRY = /* @__PURE__ */ new Set(["XX", "T1"]);
  var REGIONAL_LANGUAGES = /* @__PURE__ */ new Set(["PT_BR", "PT_PT", "ZH_CN", "ZH_TW"]);
  var LANGUAGE = /^[A-Z]{2,3}$/;
  function toCountry(value) {
    const code = (typeof value === "string" ? value : "").trim().toUpperCase();
    if (!COUNTRY.test(code) || NOT_A_COUNTRY.has(code)) return null;
    return code;
  }
  function toLanguage(value) {
    const raw = (typeof value === "string" ? value : "").trim().replace("-", "_").toUpperCase();
    if (REGIONAL_LANGUAGES.has(raw)) return raw;
    const primary = raw.split("_")[0] ?? "";
    return LANGUAGE.test(primary) ? primary : null;
  }

  // src/shopify-values.ts
  var MAX_CONNECTION_SIZE = 250;
  function isHttpsUrl(url2) {
    if (typeof url2 !== "string") return false;
    try {
      return new URL(url2).protocol === "https:";
    } catch {
      return false;
    }
  }
  function formatMoney(money, locale) {
    if (!money) return "";
    const amount = parseFloat(money.amount);
    if (Number.isNaN(amount)) return "";
    try {
      return new Intl.NumberFormat(locale || void 0, { style: "currency", currency: money.currencyCode }).format(
        amount
      );
    } catch {
      return `${money.currencyCode} ${amount.toFixed(2)}`;
    }
  }
  function productUrl(productPath, handle, id) {
    if (!/\{(handle|id)\}/.test(productPath)) {
      return handle ? `${productPath.replace(/\/$/, "")}/${encodeURIComponent(handle)}` : null;
    }
    const numericId2 = id ? id.split("/").at(-1) ?? "" : "";
    if (productPath.includes("{handle}") && !handle) return null;
    if (productPath.includes("{id}") && !numericId2) return null;
    return productPath.replace(/\{handle\}/g, encodeURIComponent(handle ?? "")).replace(/\{id\}/g, encodeURIComponent(numericId2));
  }
  function productKey(raw) {
    const value = String(raw ?? "").trim();
    if (!value) return null;
    if (value.startsWith("gid://")) return value;
    if (/^\d+$/.test(value)) return `gid://shopify/Product/${value}`;
    return /\/products\/([^/?#]+)/.exec(value)?.[1] ?? value;
  }

  // src/config.ts
  var DEFAULTS = {
    domain: "",
    token: "",
    apiVersion: STOREFRONT_API_VERSION,
    country: void 0,
    language: void 0,
    locale: void 0,
    markets: null,
    prefix: "tether",
    productPath: "/product",
    collectionPath: "/collection",
    metafields: [],
    embedOrigins: [],
    imagesFirst: 25,
    variantsFirst: 100,
    sellingPlanGroupsFirst: 10,
    sellingPlansFirst: 25,
    collectionFirst: 24,
    retries: 2,
    requestTimeout: 15e3,
    revalidate: true,
    storageKey: "",
    cartDrawerOpenClass: "is-open",
    openCartOnAdd: true,
    cartFocus: true,
    checkoutTarget: "_self",
    defaultPurchase: "one-time",
    variantUrl: false,
    maxAge: 60,
    lowStock: 5,
    searchDelay: 150,
    autoMount: true,
    observe: false,
    astro: true,
    partsUrl: null,
    analytics: null,
    account: null,
    warningText: null,
    formatMoney: null,
    onLayoutChange: null,
    onCartOpen: null,
    onCartClose: null,
    onLineEnter: null,
    onLineLeave: null,
    onValueChange: null,
    onError: null,
    debug: false
  };
  var cfg = { ...DEFAULTS };
  function refuseChange(key) {
    warn(`Tether.config is read-only (${String(key)}): pass options to Tether.init() instead`);
    return false;
  }
  var readOnlyViews = /* @__PURE__ */ new WeakMap();
  var READ_ONLY = {
    get: (object, key) => viewOf(Reflect.get(object, key)),
    // A descriptor's value is the view too, so `Object.getOwnPropertyDescriptor` doesn't hand out the live object.
    getOwnPropertyDescriptor(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (descriptor) descriptor.value = viewOf(descriptor.value);
      return descriptor;
    },
    set: (_object, key) => refuseChange(key),
    deleteProperty: (_object, key) => refuseChange(key),
    defineProperty: (_object, key) => refuseChange(key)
  };
  function viewOf(value) {
    return typeof value === "object" && value !== null ? readOnlyView(value) : value;
  }
  function readOnlyView(target) {
    let view = readOnlyViews.get(target);
    if (!view) {
      view = new Proxy(target, READ_ONLY);
      readOnlyViews.set(target, view);
    }
    return view;
  }
  var configView = new Proxy(cfg, READ_ONLY);
  var PREFIX = /^[a-z][a-z0-9-]*$/;
  var SWITCH_OPTIONS = [
    "revalidate",
    "openCartOnAdd",
    "cartFocus",
    "variantUrl",
    "autoMount",
    "observe",
    "astro",
    "debug"
  ];
  var TEXT_OPTIONS = ["token", "productPath", "collectionPath"];
  var COUNT_OPTIONS = [
    "imagesFirst",
    "variantsFirst",
    "sellingPlanGroupsFirst",
    "sellingPlansFirst",
    "collectionFirst",
    "retries",
    "requestTimeout",
    "maxAge",
    "lowStock",
    "searchDelay"
  ];
  var HOOK_OPTIONS = [
    "warningText",
    "formatMoney",
    "onLayoutChange",
    "onCartOpen",
    "onCartClose",
    "onLineEnter",
    "onLineLeave",
    "onValueChange",
    "onError"
  ];
  function invalidOption(name, value, fallback) {
    if (value !== void 0) warn(`invalid ${name} ${JSON.stringify(value)}: using ${JSON.stringify(fallback)}`);
    return fallback;
  }
  function dropped(name, value) {
    warn(`invalid ${name} ${JSON.stringify(value)}: ignored`);
  }
  function warnUnknownKeys(options) {
    for (const key of Object.keys(options)) {
      if (!Object.hasOwn(DEFAULTS, key)) warn(`unknown option ${JSON.stringify(key)}: ignored`);
    }
  }
  function setHook(config, name, value) {
    if (typeof value === "function") {
      config[name] = value;
    } else if (value !== void 0 && value !== null) {
      dropped(name, value);
    }
  }
  var MAX_TIMER_MS = 2147483647;
  var MAX_RETRIES = 10;
  var CONNECTION_RANGE = { min: 1, max: MAX_CONNECTION_SIZE };
  var COUNT_RANGES = {
    imagesFirst: CONNECTION_RANGE,
    variantsFirst: CONNECTION_RANGE,
    sellingPlanGroupsFirst: CONNECTION_RANGE,
    sellingPlansFirst: CONNECTION_RANGE,
    collectionFirst: CONNECTION_RANGE,
    requestTimeout: { max: MAX_TIMER_MS },
    searchDelay: { max: MAX_TIMER_MS },
    retries: { max: MAX_RETRIES }
  };
  function countOption(name, value) {
    const { min = 0, max: maximum } = COUNT_RANGES[name] ?? {};
    if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
      return invalidOption(name, value, DEFAULTS[name]);
    }
    if (maximum === void 0 || value <= maximum) return value;
    warn(`${name} ${String(value)} is more than its maximum: using ${String(maximum)}`);
    return maximum;
  }
  function switchOption(name, value) {
    return typeof value === "boolean" ? value : invalidOption(name, value, DEFAULTS[name]);
  }
  function textOption(name, value) {
    return typeof value === "string" ? value : invalidOption(name, value, DEFAULTS[name]);
  }
  var CLASS_TOKEN = /^\S+$/;
  function classOption(name, value) {
    return typeof value === "string" && CLASS_TOKEN.test(value) ? value : invalidOption(name, value, DEFAULTS[name]);
  }
  function localeOption(value) {
    if (value === void 0 || value === null || value === "") return void 0;
    try {
      if (typeof value === "string" && Intl.getCanonicalLocales(value).length) return value;
    } catch {
    }
    dropped("locale", value);
    return void 0;
  }
  function choiceOption(name, value, choices) {
    return choices.find((choice) => choice === value) ?? invalidOption(name, value, choices[0]);
  }
  function apiVersionOption(value) {
    if (value === "unstable") {
      warn('apiVersion "unstable" changes without notice. Pin a dated version (e.g. 2026-07).');
      return value;
    }
    return isQuarterlyVersion(value) ? value : invalidOption("apiVersion", value, DEFAULTS.apiVersion);
  }
  function codeOption(name, value, parse) {
    if (value === void 0 || value === null || value === "") return void 0;
    const code = parse(value);
    if (code !== null) return code;
    dropped(name, value);
    return void 0;
  }
  function resolveConfig(options) {
    warnUnknownKeys(options);
    const domain = domainOption(options.domain, dropped);
    const prefix = typeof options.prefix === "string" && PREFIX.test(options.prefix) ? options.prefix : invalidOption("prefix", options.prefix, DEFAULTS.prefix);
    const resolved = {
      ...DEFAULTS,
      domain,
      apiVersion: apiVersionOption(options.apiVersion),
      country: codeOption("country", options.country, toCountry),
      locale: localeOption(options.locale),
      partsUrl: partsUrlOption(options.partsUrl, dropped),
      language: codeOption("language", options.language, toLanguage),
      markets: marketsOption(options.markets, dropped),
      analytics: analyticsOption(options.analytics, dropped),
      account: accountOption(options.account, dropped, warn),
      prefix,
      storageKey: typeof options.storageKey === "string" && options.storageKey ? options.storageKey : `${prefix}:cart:${domain}`,
      metafields: metafieldsOption(options.metafields ?? [], dropped),
      embedOrigins: embedOriginsOption(options.embedOrigins ?? [], dropped),
      checkoutTarget: choiceOption("checkoutTarget", options.checkoutTarget, ["_self", "_blank"]),
      defaultPurchase: choiceOption("defaultPurchase", options.defaultPurchase, ["one-time", "subscription"]),
      cartDrawerOpenClass: classOption("cartDrawerOpenClass", options.cartDrawerOpenClass)
    };
    for (const name of COUNT_OPTIONS) resolved[name] = countOption(name, options[name]);
    for (const name of SWITCH_OPTIONS) resolved[name] = switchOption(name, options[name]);
    for (const name of TEXT_OPTIONS) resolved[name] = textOption(name, options[name]);
    for (const name of HOOK_OPTIONS) setHook(resolved, name, options[name]);
    return resolved;
  }
  var parseMarkets = (value) => marketsOption(value, dropped);
  function configure(options = {}) {
    const resolved = resolveConfig(options);
    for (const key of Object.keys(cfg)) {
      if (!(key in resolved)) Reflect.deleteProperty(cfg, key);
    }
    return Object.assign(cfg, resolved);
  }
  var isConfigured = () => Boolean(cfg.domain && cfg.token);
  function log(...args) {
    if (cfg.debug) console.log(`[${cfg.prefix}]`, ...args);
  }
  function warn(...args) {
    console.warn(`[${cfg.prefix}]`, ...args);
  }
  function reportError(error, context) {
    warn(context, error instanceof Error && error.message ? error.message : error);
    if (!cfg.onError) return;
    try {
      cfg.onError(error, context);
    } catch (hookError) {
      warn("onError threw", hookError);
    }
  }
  var reportedHookFailures = /* @__PURE__ */ new Set();
  var MAX_REMEMBERED_HOOK_FAILURES = 100;
  function callHook(name, hook2, fallback) {
    try {
      return hook2();
    } catch (error) {
      const failure = error instanceof Error && `${name}: ${error.message}`;
      if (!failure || !reportedHookFailures.has(failure)) {
        if (failure && reportedHookFailures.size < MAX_REMEMBERED_HOOK_FAILURES) reportedHookFailures.add(failure);
        reportError(error, name);
      }
      return fallback?.();
    }
  }

  // server/src/shared/error-message.ts
  function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/client.ts
  var TetherError = class extends Error {
    constructor(message, { status: status2, errors, userErrors, code } = {}) {
      super(message);
      __publicField(this, "name", "TetherError");
      __publicField(this, "code");
      __publicField(this, "status");
      __publicField(this, "errors");
      __publicField(this, "userErrors");
      this.code = code ?? (status2 ? `HTTP_${status2}` : "ERROR");
      this.status = status2;
      this.errors = errors;
      this.userErrors = userErrors;
    }
  };
  function matches(value, shape) {
    if (typeof shape === "function") return shape(value);
    if (typeof shape === "string") return shape === "object" ? isRecord(value) : typeof value === shape;
    if (isShapeList(shape)) return Array.isArray(value) && value.every((item) => matches(item, shape[0]));
    return isRecord(value) && Object.entries(shape).every(([key, inner]) => inner === void 0 || matches(value[key], inner));
  }
  var isShapeList = (shape) => Array.isArray(shape);
  var orNull = (shape) => (value) => value === null || matches(value, shape);
  var shaped = (shape) => (data) => matches(data, shape);
  function endpoint(conf = cfg) {
    return `https://${conf.domain}/api/${conf.apiVersion}/graphql.json`;
  }
  var STRINGS_AND_COMMENTS = /"(?:\\.|[^"\\\n])*"|#[^\n]*/g;
  var OPERATION_START = /^\s*(?:query|mutation)(?:\s+\w+)?\s*(?:\([^)]*\))?/;
  function operationOf(document2) {
    return /\bmutation\b/.test(document2.replace(STRINGS_AND_COMMENTS, "")) ? "mutation" : "query";
  }
  function inContext(query2, { country, language }) {
    const args = [];
    if (country) args.push(`country: ${country}`);
    if (language) args.push(`language: ${language}`);
    if (!args.length) return query2;
    const tag = `@inContext(${args.join(", ")})`;
    const blanked = query2.replace(STRINGS_AND_COMMENTS, (text2) => " ".repeat(text2.length));
    const selectionStart = blanked.indexOf("{");
    if (blanked.slice(0, selectionStart).includes("@inContext")) return query2;
    if (blanked.trimStart().startsWith("{")) return `query ${tag} ${query2.slice(selectionStart)}`;
    const header = OPERATION_START.exec(blanked);
    if (!header) return query2;
    const end = header[0].length;
    return `${query2.slice(0, end).trimEnd()} ${tag} ${query2.slice(end).trimStart()}`;
  }
  function withContext(query2, ctx = cfg) {
    const country = toCountry(ctx.country) ?? void 0;
    const language = toLanguage(ctx.language) ?? void 0;
    return inContext(query2, { country, language });
  }
  var RETRY_BACKOFF_MS = 300;
  var THROTTLE_BACKOFF_MS = 500;
  var MAX_BACKOFF_MS = 3e4;
  var SECURITY_REJECTION = 430;
  var MS_PER_SECOND = 1e3;
  var INVENTORY_FIELD = "quantityAvailable";
  var storesWithoutInventory = /* @__PURE__ */ new Set();
  var storeOf = (conf) => `${conf.domain} ${conf.apiVersion} ${conf.token}`;
  function queryText(conf, query2, access, { context, operation }) {
    const written = typeof query2 === "string" ? query2 : query2(access);
    const text2 = context ? inContext(written, conf) : written;
    if (conf.maxAge <= 0 || operation === "mutation") return text2;
    return `${text2} #${Math.floor(Date.now() / (conf.maxAge * MS_PER_SECOND))}`;
  }
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function statusText(status2, conf) {
    if (status2 === 401 || status2 === 403) {
      const adminHint = conf.token.startsWith("shpat_") ? ", not an Admin API token (shpat_\u2026)" : "";
      return `Shopify rejected the Storefront token for ${conf.domain} (${status2}): use the public Storefront API token (Headless channel)${adminHint}`;
    }
    if (status2 === 404) {
      return `Store or API version not found (404): check domain ${conf.domain} and apiVersion ${conf.apiVersion}`;
    }
    return `HTTP ${status2} from ${conf.domain}`;
  }
  function toGraphQLError(value) {
    const message = field(value, "message");
    const code = field(field(value, "extensions"), "code");
    const text2 = typeof message === "string" ? message : "";
    return typeof code === "string" ? { message: text2, extensions: { code } } : { message: text2 };
  }
  function toGraphQLResponse(json) {
    if (!isRecord(json)) return null;
    const { data, errors } = json;
    if (errors === void 0 || errors === null) return { data };
    if (!Array.isArray(errors)) return null;
    return { data, errors: errors.map(toGraphQLError) };
  }
  function invalidResponse(res, conf) {
    return res.ok ? new TetherError(`Invalid response (${res.status})`, { code: "INVALID_RESPONSE", status: res.status }) : new TetherError(statusText(res.status, conf), { status: res.status });
  }
  function graphQLFailure(res, errors, conf, code) {
    const message = errors.map((error) => error.message).filter(Boolean).join(" | ");
    let text2 = message || "Storefront API error";
    if (!res.ok) text2 = res.status === 401 || res.status === 403 || !message ? statusText(res.status, conf) : message;
    return new TetherError(text2, { status: res.status, errors, code });
  }
  function networkFailure(error, retry) {
    if (retry === "any") return { kind: "retry", backoffMs: RETRY_BACKOFF_MS };
    throw new TetherError(`Network error: ${messageOf(error)}`, { code: "NETWORK" });
  }
  function graphQLOutcome(res, conf, query2, errors, data, retry, operation) {
    if (query2.includes(INVENTORY_FIELD) && errors.some((error) => error.message.includes(INVENTORY_FIELD))) {
      return { kind: "inventory-refused", error: graphQLFailure(res, errors, conf) };
    }
    const codes = errors.map((error) => error.extensions?.code);
    if (retry !== "none" && codes.includes("THROTTLED")) return { kind: "retry", backoffMs: THROTTLE_BACKOFF_MS };
    const serverError = codes.includes("INTERNAL_SERVER_ERROR");
    if (retry === "any" && serverError) return { kind: "retry", backoffMs: RETRY_BACKOFF_MS };
    const unclear = res.ok && (serverError || operation === "mutation" && data == null);
    throw graphQLFailure(res, errors, conf, unclear ? "SERVER_ERROR" : void 0);
  }
  async function withTimeout(ms, send2) {
    if (!ms) return send2(null);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException("signal timed out", "TimeoutError"));
    }, ms);
    try {
      return await send2(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
  async function attempt(conf, query2, variables, isData, retry, operation, signal) {
    let res;
    try {
      res = await (conf.fetch ?? fetch)(endpoint(conf), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": conf.token },
        body: JSON.stringify({ query: query2, variables }),
        // A `fetch` given to the server helpers has to honour the signal, as the platform's does.
        signal
      });
    } catch (error) {
      return networkFailure(error, retry);
    }
    if (res.status === SECURITY_REJECTION) {
      throw new TetherError("Shopify security rejection (430)", { status: SECURITY_REJECTION });
    }
    if (retry !== "none" && res.status === 429 || retry === "any" && res.status >= 500) {
      return { kind: "retry", backoffMs: RETRY_BACKOFF_MS };
    }
    let json;
    try {
      json = await res.json();
    } catch (error) {
      if (error instanceof SyntaxError) throw invalidResponse(res, conf);
      return networkFailure(error, retry);
    }
    const body = toGraphQLResponse(json);
    if (!body) throw invalidResponse(res, conf);
    const { data, errors = [] } = body;
    if (errors.length) return graphQLOutcome(res, conf, query2, errors, data, retry, operation);
    if (!res.ok) throw new TetherError(statusText(res.status, conf), { status: res.status });
    if (!isData(data)) throw invalidResponse(res, conf);
    return { kind: "data", data };
  }
  async function request(conf, query2, variables, isData, { context = true, operation = "query" } = {}) {
    if (!conf.domain || !conf.token) {
      throw new TetherError("Tether is not configured: domain and token are required", { code: "NOT_CONFIGURED" });
    }
    const store = storeOf(conf);
    const retryWhileLeft = operation === "mutation" ? "not-run" : "any";
    let retries = 0;
    for (; ; ) {
      const access = { inventory: !storesWithoutInventory.has(store) };
      const sent = queryText(conf, query2, access, { context, operation });
      const retry = retries < conf.retries ? retryWhileLeft : "none";
      const outcome = await withTimeout(
        conf.requestTimeout,
        (signal) => attempt(conf, sent, variables, isData, retry, operation, signal)
      );
      switch (outcome.kind) {
        case "data":
          return outcome.data;
        case "inventory-refused":
          if (typeof query2 === "string" || !access.inventory) throw outcome.error;
          log(`the token can't read inventory: ${INVENTORY_FIELD} is left out from now on`);
          storesWithoutInventory.add(store);
          break;
        case "retry":
          await sleep(Math.min(outcome.backoffMs * 2 ** retries, MAX_BACKOFF_MS));
          retries += 1;
          log("retry", retries);
          break;
      }
    }
  }
  function gql(query2, variables, isData, options) {
    return request(cfg, query2, variables, isData, options);
  }
  var hasData = (data) => typeof data === "object" && data !== null;
  function untypedQuery(conf, text2, variables = {}, options) {
    return request(conf, text2, variables, hasData, { ...options, operation: operationOf(text2) });
  }
  function query(text2, variables, options) {
    return untypedQuery(cfg, text2, variables, options);
  }
  function unwrap(payload, name) {
    if (!payload) throw new TetherError(`${name}: empty response`);
    const userErrors = payload.userErrors ?? [];
    if (userErrors.length) {
      throw new TetherError(userErrors.map((error) => error.message).join(" | "), { userErrors });
    }
    return payload;
  }

  // src/markup.ts
  var attr = (name) => `${cfg.prefix}-${name}`;
  var sel = (name, value) => value === void 0 ? `[${attr(name)}]` : `[${attr(name)}="${value}"]`;
  var get = (el, name) => el.getAttribute(attr(name));
  var has = (el, name) => el.hasAttribute(attr(name));
  function qsa(root, selector) {
    if (!root) return [];
    return [...root.querySelectorAll(selector)];
  }
  var scoped = (root, selector, scopeSelector) => qsa(root, selector).filter((el) => el.closest(scopeSelector) === root);
  var ANALYTICS_EVENTS = [
    "product-ready",
    "list-ready",
    "cart-updated",
    "cart-toggled",
    "checkout",
    "search"
  ];
  var ownEvents = /* @__PURE__ */ new WeakMap();
  function ownEvent(name, detail) {
    const event = new CustomEvent(`${cfg.prefix}:${name}`, { detail, bubbles: true });
    ownEvents.set(event, name);
    return event;
  }
  function isOwnEvent(event, name) {
    return ownEvents.get(event) === name;
  }
  function emit(name, detail, target = document) {
    target.dispatchEvent(ownEvent(name, detail));
  }

  // src/store-html.ts
  var HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
  var ALLOWED_ELEMENTS = /* @__PURE__ */ new Set([
    ...["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "div", "br", "hr", "blockquote", "code", "pre"],
    ...["strong", "em", "b", "i", "u", "s", "small", "sub", "sup"],
    ...["ul", "ol", "li", "dl", "dt", "dd"],
    ...["table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td"],
    ...["a", "img", "picture", "source", "video", "figure", "figcaption", "iframe"]
  ]);
  var REMOVED_WITH_CONTENT = /* @__PURE__ */ new Set(["script", "style", "template", "noscript", "textarea", "select", "title"]);
  var GLOBAL_ATTRIBUTES = /* @__PURE__ */ new Set(["style", "title", "lang", "dir", "role", "align", "width", "height"]);
  var ELEMENT_ATTRIBUTES = /* @__PURE__ */ new Map([
    ["a", /* @__PURE__ */ new Set(["href", "target", "rel", "hreflang"])],
    ["img", /* @__PURE__ */ new Set(["src", "srcset", "sizes", "alt", "loading", "decoding"])],
    ["source", /* @__PURE__ */ new Set(["src", "srcset", "sizes", "type", "media"])],
    ["video", /* @__PURE__ */ new Set(["src", "poster", "controls", "autoplay", "muted", "loop", "playsinline", "preload"])],
    ["iframe", /* @__PURE__ */ new Set(["src", "allow", "allowfullscreen", "frameborder", "loading"])],
    ["blockquote", /* @__PURE__ */ new Set(["cite"])],
    ["ol", /* @__PURE__ */ new Set(["start", "type", "reversed"])],
    ["li", /* @__PURE__ */ new Set(["value"])],
    ["table", /* @__PURE__ */ new Set(["border", "cellpadding", "cellspacing", "summary"])],
    ["col", /* @__PURE__ */ new Set(["span"])],
    ["colgroup", /* @__PURE__ */ new Set(["span"])],
    ["th", /* @__PURE__ */ new Set(["colspan", "rowspan", "headers", "scope", "valign"])],
    ["td", /* @__PURE__ */ new Set(["colspan", "rowspan", "headers", "valign"])]
  ]);
  var URL_ATTRIBUTES = /* @__PURE__ */ new Set(["href", "src", "poster", "cite"]);
  var SCRIPT_URL = /^(javascript|vbscript|data):/i;
  var DATA_IMAGE = /^data:image\/(png|gif|jpeg|webp|avif);/i;
  var OUT_OF_PLACE_PROPERTIES = /* @__PURE__ */ new Set([
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "-webkit-box-reflect"
  ]);
  var OUT_OF_PLACE_PREFIXES = ["inset", "transform", "translate", "rotate", "scale", "offset"];
  var VIEWPORT_LENGTH = /\d(?:[sld]?v|cq)(?:w|h|i|b|min|max)\b/i;
  var PAINTS_BEYOND = /^(?:outline|box-shadow|text-shadow|filter|text-decoration|text-underline-offset|text-stroke)|^(?:border-image|mask-border|mask-box-image)(?:-outset)?$/;
  var MAX_PAINT_PX = 40;
  var NEGATIVE_LIMITS = /* @__PURE__ */ new Map([
    ["letter-spacing", { px: 4, em: 0.25 }],
    ["word-spacing", { px: 4, em: 0.25 }],
    ["text-indent", { px: MAX_PAINT_PX }]
  ]);
  var NUMBER = /(?<![\w#.-])[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(%|[a-z]+)?/gi;
  var NON_LENGTH_FUNCTION = /(?<![\w-])(?!drop-shadow\(|blur\()[\w-]+\([^()]*\)/g;
  var COMPUTED_VALUE = /(?:var|calc|min|max|clamp|env|attr)\(/i;
  var FETCHING_VALUE = /url\(|expression\(|@import/i;
  var IGNORED_IN_SCHEME = /[\u0000- ]/g;
  var IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-presentation";
  var IFRAME_FEATURES = /* @__PURE__ */ new Set([
    ...["autoplay", "encrypted-media", "picture-in-picture", "fullscreen", "clipboard-write"],
    ...["accelerometer", "gyroscope", "web-share"]
  ]);
  var IFRAME_REFERRER_POLICY = "strict-origin-when-cross-origin";
  var EMBED_ORIGINS = [
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
    "https://www.loom.com",
    "https://fast.wistia.net"
  ];
  function isAllowedAttribute(tag, name) {
    return GLOBAL_ATTRIBUTES.has(name) || name.startsWith("aria-") || (ELEMENT_ATTRIBUTES.get(tag)?.has(name) ?? false);
  }
  function isSafeUrl(tag, name, value) {
    const url2 = value.replace(IGNORED_IN_SCHEME, "");
    if (!SCRIPT_URL.test(url2)) return true;
    return tag === "img" && name === "src" && DATA_IMAGE.test(url2);
  }
  function urlOrNull(value, base) {
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  }
  function pageOf(document2, styleParser, embedOrigins) {
    const baseUrl = document2.baseURI;
    const origin = urlOrNull(baseUrl)?.origin ?? "null";
    return {
      origin: origin === "null" ? null : origin,
      baseUrl,
      styleParser,
      embedOrigins: /* @__PURE__ */ new Set([...EMBED_ORIGINS, ...embedOrigins])
    };
  }
  function isAllowedEmbed(value, page) {
    const url2 = urlOrNull(value.trim(), page.baseUrl);
    return url2 !== null && url2.origin !== page.origin && page.embedOrigins.has(url2.origin);
  }
  function allowedFeatures(value) {
    const features = value.split(";").map((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase() ?? "");
    return [...new Set(features.filter((feature) => IFRAME_FEATURES.has(feature)))].join("; ");
  }
  function isOutOfPlace(property, value) {
    if (OUT_OF_PLACE_PROPERTIES.has(property) || OUT_OF_PLACE_PREFIXES.some((prefix) => property.startsWith(prefix))) {
      return true;
    }
    if (VIEWPORT_LENGTH.test(value)) return true;
    const limits = NEGATIVE_LIMITS.get(property);
    if (limits) return COMPUTED_VALUE.test(value) || movesBackTooFar(value, limits);
    return property.startsWith("margin") && value.includes("-");
  }
  function movesBackTooFar(value, limits) {
    return [...value.matchAll(NUMBER)].some(([number = "", unit = ""]) => {
      const amount = parseFloat(number);
      if (amount >= 0) return false;
      const limit = limits[unit.toLowerCase()];
      return limit === void 0 || -amount > limit;
    });
  }
  function paintsTooFar(property, value) {
    if (!PAINTS_BEYOND.test(property.replace(/^-webkit-/, ""))) return false;
    if (COMPUTED_VALUE.test(value)) return true;
    return [...value.replace(NON_LENGTH_FUNCTION, "").matchAll(NUMBER)].some(([number = "", unit = ""]) => {
      const amount = Math.abs(parseFloat(number));
      return amount !== 0 && (unit.toLowerCase() !== "px" || amount > MAX_PAINT_PX);
    });
  }
  function cleanStyle(value, styleParser) {
    const style = styleParser.style;
    style.cssText = value;
    const properties = Array.from({ length: style.length }, (_, index) => style.item(index));
    for (const property of properties) {
      const value2 = style.getPropertyValue(property);
      const remove = isOutOfPlace(property, value2) || paintsTooFar(property, value2) || FETCHING_VALUE.test(value2);
      if (remove) style.removeProperty(property);
    }
    const cleaned = style.cssText;
    styleParser.removeAttribute("style");
    return cleaned;
  }
  function cleanAttributes(element, page) {
    const tag = element.localName;
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const isUrl = URL_ATTRIBUTES.has(name);
      const keep = isAllowedAttribute(tag, name) && (!isUrl || isSafeUrl(tag, name, attribute.value));
      if (!keep) element.removeAttribute(attribute.name);
    }
    const style = element.getAttribute("style");
    if (style === null) return;
    const cleaned = cleanStyle(style, page.styleParser);
    if (cleaned === "") element.removeAttribute("style");
    else element.setAttribute("style", cleaned);
  }
  var SAME_TAB_TARGETS = /* @__PURE__ */ new Set(["", "_self", "_parent", "_top"]);
  function hardenEmbedsAndLinks(element) {
    if (element.localName === "iframe") {
      const allow = allowedFeatures(element.getAttribute("allow") ?? "");
      if (allow === "") element.removeAttribute("allow");
      else element.setAttribute("allow", allow);
      element.setAttribute("sandbox", IFRAME_SANDBOX);
      element.setAttribute("referrerpolicy", IFRAME_REFERRER_POLICY);
      return;
    }
    if (element.localName !== "a") return;
    const target = element.getAttribute("target");
    if (target === null || SAME_TAB_TARGETS.has(target.toLowerCase())) return;
    const rel = new Set((element.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    rel.add("noreferrer");
    element.setAttribute("rel", [...rel].join(" "));
  }
  function cleanElement(element, page) {
    const tag = element.localName;
    const isHtml = element.namespaceURI === HTML_NAMESPACE;
    if (isHtml && REMOVED_WITH_CONTENT.has(tag)) {
      element.remove();
      return;
    }
    if (!isHtml || !ALLOWED_ELEMENTS.has(tag)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    if (tag === "iframe" && !isAllowedEmbed(element.getAttribute("src") ?? "", page)) {
      element.remove();
      return;
    }
    cleanAttributes(element, page);
    hardenEmbedsAndLinks(element);
  }
  function storeHtmlFragment(html, document2 = globalThis.document, embedOrigins = []) {
    const template = document2.createElement("template");
    template.innerHTML = html ?? "";
    const page = pageOf(document2, template, embedOrigins);
    for (const element of [...template.content.querySelectorAll("*")]) cleanElement(element, page);
    return template.content;
  }

  // src/images.ts
  function imageUrl(url2, { width, height, crop } = {}) {
    if (!url2) return url2;
    let parsed;
    try {
      parsed = new URL(url2);
    } catch (error) {
      if (error instanceof TypeError) return url2;
      throw error;
    }
    if (width) parsed.searchParams.set("width", String(width));
    if (height) parsed.searchParams.set("height", String(height));
    if (crop) parsed.searchParams.set("crop", crop);
    return parsed.toString();
  }
  function sizeAttribute(el, name) {
    return el.getAttribute(name) ?? el.getAttribute(attr(name)) ?? el.getAttribute(`data-${name}`);
  }
  function cdnUrl(url2, el) {
    if (!url2 || !el) return url2;
    const width = sizeAttribute(el, "max-width");
    const height = sizeAttribute(el, "max-height");
    return imageUrl(url2, { width, height, crop: width || height ? sizeAttribute(el, "crop") : null });
  }
  var withoutQuery = (url2) => url2.replace(/\?.*$/, "");
  function sameImage(a, b) {
    if (!a || !b) return false;
    return withoutQuery(a) === withoutQuery(b);
  }
  function cssUrl(url2) {
    const hasScheme = /^\s*[a-z][a-z0-9+.-]*:/i.test(url2);
    if (hasScheme && !/^\s*(https?:|data:image\/)/i.test(url2)) return "none";
    const escaped = url2.replace(/["\\\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
    return `url("${escaped}")`;
  }
  function setImage(el, url2, alt) {
    if (!url2) return;
    const src = cdnUrl(url2, el);
    if (el.tagName !== "IMG") {
      el.style.backgroundImage = cssUrl(src);
      return;
    }
    if (sameImage(el.getAttribute("src"), src)) {
      if (alt != null && !el.getAttribute("alt")) el.setAttribute("alt", alt);
      return;
    }
    el.removeAttribute("srcset");
    el.removeAttribute("sizes");
    el.setAttribute("src", src);
    if (alt != null) el.setAttribute("alt", alt);
    if (!el.getAttribute("loading")) el.setAttribute("loading", "lazy");
  }

  // src/repeaters.ts
  var templates = /* @__PURE__ */ new WeakMap();
  var hasTemplate = (container) => Boolean(templates.get(container));
  var copyOf = (template) => template.cloneNode(true);
  function templateOf(container) {
    const known = templates.get(container);
    if (known !== void 0) return known;
    const first = container.firstElementChild;
    const template = first ? copyOf(first) : null;
    templates.set(container, template);
    container.replaceChildren();
    return template;
  }
  function repeat(container, items, render2) {
    const template = templateOf(container);
    if (!template) {
      if (items.length) warn("repeater without a template child", container);
      return;
    }
    container.replaceChildren();
    items.forEach((item, index) => {
      const node = copyOf(template);
      render2(node, item, index);
      container.appendChild(node);
    });
  }
  function leave(node, onLeave) {
    const done = () => {
      node.remove();
    };
    if (!onLeave) {
      done();
      return;
    }
    callHook(
      "repeater onLeave",
      () => {
        onLeave(node, done);
      },
      done
    );
  }
  function insertFresh(container, wanted, fresh, onEnter) {
    wanted.forEach((node, index) => {
      if (!fresh.has(node)) return;
      const previous = wanted[index - 1];
      if (previous?.parentNode === container) previous.after(node);
      else container.prepend(node);
      if (!onEnter) return;
      callHook("repeater onEnter", () => {
        onEnter(node);
      });
    });
  }
  function repeatKeyed(container, items, keyOf, render2, { onEnter, onLeave } = {}) {
    const template = templateOf(container);
    if (!template) {
      warn("repeater without a template child", container);
      return;
    }
    const keyAttribute = `data-${cfg.prefix}-key`;
    const leavingAttribute = `data-${cfg.prefix}-leaving`;
    const live = () => [...container.children].filter(
      (node) => node.hasAttribute(keyAttribute) && !node.hasAttribute(leavingAttribute)
    );
    const existing = new Map(live().map((node) => [node.getAttribute(keyAttribute), node]));
    const wanted = [];
    const fresh = /* @__PURE__ */ new Set();
    items.forEach((item, index) => {
      const key = String(keyOf(item, index));
      let node = existing.get(key);
      if (node) existing.delete(key);
      else {
        node = copyOf(template);
        node.setAttribute(keyAttribute, key);
        fresh.add(node);
      }
      render2(node, item, index, fresh.has(node));
      wanted.push(node);
    });
    const staying = wanted.filter((node) => !fresh.has(node));
    const current = live().filter((node) => staying.includes(node));
    const inOrder = current.length === staying.length && current.every((node, index) => node === staying[index]);
    if (!inOrder) {
      existing.forEach((node) => {
        node.remove();
      });
      wanted.forEach((node) => container.appendChild(node));
      return;
    }
    insertFresh(container, wanted, fresh, onEnter);
    existing.forEach((node) => {
      node.setAttribute(leavingAttribute, "");
      node.removeAttribute(keyAttribute);
      node.style.pointerEvents = "none";
      node.inert = true;
      leave(node, onLeave);
    });
  }

  // src/dom.ts
  var SEEN = "data-tether-seen";
  var SHOWN = "data-tether-shown";
  var PREVIOUS_DISPLAY = "data-tether-prev-display";
  var LAYOUT_DEBOUNCE_MS = 120;
  function productUrl2(handle, id) {
    return productUrl(cfg.productPath || "/product", handle, id);
  }
  function formatOr(format, fallback) {
    try {
      return format();
    } catch (error) {
      if (error instanceof RangeError) return fallback;
      throw error;
    }
  }
  function formatPercent(percentage, locale = cfg.locale) {
    if (!percentage) return "";
    const format = () => new Intl.NumberFormat(locale || void 0, { style: "percent", maximumFractionDigits: 0 }).format(percentage / 100);
    return formatOr(format, `${percentage}%`);
  }
  function formatMoney2(money) {
    if (!money) return "";
    const { formatMoney: siteFormat, locale } = cfg;
    const builtIn = () => formatMoney(money, locale);
    return siteFormat ? callHook("formatMoney", () => siteFormat(money, locale), builtIn) : builtIn();
  }
  function formatDate(iso) {
    if (!iso) return "";
    return formatOr(() => new Date(iso).toLocaleDateString(cfg.locale || void 0), "");
  }
  function setStoreHtml(el, html) {
    el.replaceChildren(storeHtmlFragment(html, el.ownerDocument, cfg.embedOrigins));
  }
  var isInput = (el) => el.tagName === "INPUT";
  var isTextField = (el) => isInput(el) || el.tagName === "TEXTAREA";
  var isField = (el) => isTextField(el) || el.tagName === "SELECT";
  var isElement = (target) => target instanceof window.Element;
  function setText(el, value) {
    const text2 = value == null ? "" : String(value);
    if (isTextField(el)) el.value = text2;
    else el.textContent = text2;
  }
  var readText = (el) => isTextField(el) ? el.value : el.textContent;
  function setTextTracked(el, value) {
    const before = readText(el);
    setText(el, value);
    if (before !== readText(el) && el.hasAttribute(SEEN)) {
      callHook("onValueChange", () => cfg.onValueChange?.(el, before));
    }
    el.setAttribute(SEEN, "1");
  }
  function reveal(el) {
    if (el.hasAttribute(SHOWN)) return;
    el.setAttribute(SHOWN, "");
    el.removeAttribute("hidden");
    const previous = el.getAttribute(PREVIOUS_DISPLAY);
    if (previous !== null) {
      el.style.display = previous;
      el.removeAttribute(PREVIOUS_DISPLAY);
    } else if (el.style.display === "none") {
      el.style.display = "";
    }
    if (typeof getComputedStyle === "function" && getComputedStyle(el).display === "none") {
      el.style.display = el.getAttribute(attr("display")) || "block";
    }
  }
  function show(el, visible) {
    if (visible) {
      reveal(el);
      return;
    }
    el.removeAttribute(SHOWN);
    if (!el.hasAttribute(PREVIOUS_DISPLAY) && el.style.display !== "none") {
      el.setAttribute(PREVIOUS_DISPLAY, el.style.display);
    }
    el.style.display = "none";
  }
  var CHECKABLE = 'input[type="radio"],input[type="checkbox"]';
  var CHECKED_ROLES = ["radio", "checkbox", "switch", "menuitemradio", "menuitemcheckbox"];
  var BUTTON_INPUTS = ["button", "submit", "reset"];
  function chosenState(el) {
    const role = el.getAttribute("role");
    if (role === "button") return "aria-pressed";
    if (role && CHECKED_ROLES.includes(role)) return "aria-checked";
    if (role === "option" || role === "tab") return "aria-selected";
    if (role) return null;
    if (isInput(el)) return BUTTON_INPUTS.includes(el.type) ? "aria-pressed" : null;
    return el.querySelector(CHECKABLE) ? null : "aria-pressed";
  }
  function setSelected(el, selected) {
    el.classList.toggle("is-selected", selected);
    const state = chosenState(el);
    if (state === "aria-pressed" && el.tagName !== "BUTTON" && !isInput(el)) {
      el.setAttribute("role", "button");
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    }
    if (state) el.setAttribute(state, String(selected));
    if (isInput(el) && el.matches(CHECKABLE)) el.checked = selected;
    const input = el.querySelector(CHECKABLE);
    if (input && isInput(input)) input.checked = selected;
  }
  var UNAVAILABLE_NOTE = "tether-unavailable";
  function describeUnavailable(control, unavailable) {
    if (unavailable && !document.getElementById(UNAVAILABLE_NOTE)) {
      const note = document.createElement("span");
      note.id = UNAVAILABLE_NOTE;
      note.hidden = true;
      note.textContent = "Unavailable";
      document.body.append(note);
    }
    const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && id !== UNAVAILABLE_NOTE);
    if (unavailable) ids.push(UNAVAILABLE_NOTE);
    if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
    else control.removeAttribute("aria-describedby");
  }
  function setUnavailable(el, unavailable, choosing) {
    el.classList.toggle("is-unavailable", unavailable);
    const isControl = chosenState(el) !== null || isInput(el);
    const control = isControl ? el : el.querySelector(CHECKABLE);
    if (!control) return;
    if (choosing === "picks-closest") describeUnavailable(control, unavailable);
    else control.setAttribute("aria-disabled", String(unavailable));
  }
  var layoutTimer;
  var pageGlobal = (name) => Reflect.get(window, name);
  function refreshScrollTrigger() {
    const scrollTrigger = pageGlobal("ScrollTrigger");
    if (typeof scrollTrigger !== "function") return;
    const refresh = Reflect.get(scrollTrigger, "refresh");
    if (typeof refresh === "function") Reflect.apply(refresh, scrollTrigger, []);
  }
  function notifyLayoutChanged(reason) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      callHook("layout-changed", () => {
        if (cfg.onLayoutChange) cfg.onLayoutChange(reason);
        else refreshScrollTrigger();
      });
      emit("layout-changed", { reason });
    }, LAYOUT_DEBOUNCE_MS);
  }
  function watchImages(root, reason) {
    const loading = [...root.querySelectorAll("img")].filter((img) => !img.complete);
    let left = loading.length;
    const done = () => {
      left -= 1;
      if (left === 0) notifyLayoutChanged(`${reason}:images`);
    };
    loading.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
  }
  function busy(el, task) {
    if (el.getAttribute("aria-busy") === "true") return Promise.resolve(void 0);
    el.setAttribute("aria-busy", "true");
    return Promise.resolve().then(task).finally(() => {
      el.removeAttribute("aria-busy");
    });
  }
  function parseJSONAttr(el, name) {
    const raw = el ? get(el, name) : null;
    if (!raw) return null;
    try {
      const json = JSON.parse(raw);
      return json;
    } catch {
      warn(`invalid JSON in ${attr(name)}`, el);
      return null;
    }
  }
  var INTEGER_TEXT = /^-?\d+$/;
  var invalidIntegerAttributes = /* @__PURE__ */ new WeakMap();
  function warnInvalidAttribute(el, name, message) {
    const warned = invalidIntegerAttributes.get(el) ?? /* @__PURE__ */ new Set();
    invalidIntegerAttributes.set(el, warned);
    if (warned.has(name)) return;
    warned.add(name);
    warn(`${attr(name)} ${message}`, el);
  }
  function integerAttribute(el, name, { min, max, fallback }) {
    const raw = get(el, name)?.trim();
    if (!raw) return fallback;
    const value = INTEGER_TEXT.test(raw) ? Number(raw) : Number.NaN;
    if (Number.isNaN(value) || value < min) {
      warnInvalidAttribute(
        el,
        name,
        `${JSON.stringify(raw)} is not a whole number from ${String(min)}: using ${String(fallback)}`
      );
      return fallback;
    }
    if (max === void 0 || value <= max) return value;
    warnInvalidAttribute(el, name, `${raw} is more than its maximum: using ${String(max)}`);
    return max;
  }
  function attributeText(value) {
    if (value === null || value === void 0) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  }
  function attributesFromJson(json) {
    if (Array.isArray(json)) {
      const entries = json;
      return entries.filter(isRecord).map((entry) => ({ key: attributeText(entry["key"]), value: attributeText(entry["value"]) }));
    }
    if (!isRecord(json)) return [];
    return Object.entries(json).map(([key, value]) => ({ key, value: attributeText(value) }));
  }
  function toAttributes(attributes) {
    if (!attributes) return [];
    if (Array.isArray(attributes)) {
      return attributes.map((attribute) => ({ key: String(attribute.key), value: String(attribute.value ?? "") }));
    }
    return Object.entries(attributes).map(([key, value]) => ({ key, value: String(value ?? "") }));
  }

  // src/shopify-fields.ts
  var IMAGE_FIELDS = "url altText width height";

  // src/fragments.ts
  var MONEY = "amount currencyCode";
  var FULL_ACCESS = { inventory: true };
  var inventoryField = (access) => access.inventory ? "quantityAvailable" : "";
  function metafieldsField(metafields) {
    const identifiers = [];
    for (const ref of metafields) {
      const identifier = toMetafieldIdentifier(ref);
      if (identifier) identifiers.push(identifier);
    }
    if (!identifiers.length) return "";
    const list = identifiers.map(({ namespace, key }) => `{namespace: ${JSON.stringify(namespace)}, key: ${JSON.stringify(key)}}`).join(", ");
    return `metafields(identifiers:[${list}]){namespace key type value reference{... on MediaImage{image{${IMAGE_FIELDS}}}}}`;
  }
  var SELLING_PLAN_FIELDS = ` id name description recurringDeliveries options{name value}priceAdjustments{orderCount adjustmentValue{__typename ... on SellingPlanPercentagePriceAdjustment{adjustmentPercentage}... on SellingPlanFixedAmountPriceAdjustment{adjustmentAmount{${MONEY}}}... on SellingPlanFixedPriceAdjustment{price{${MONEY}}}}}`;
  var ALLOCATION_FIELDS = ` sellingPlan{id}checkoutChargeAmount{${MONEY}}remainingBalanceChargeAmount{${MONEY}}priceAdjustments{price{${MONEY}}compareAtPrice{${MONEY}}perDeliveryPrice{${MONEY}}unitPrice{${MONEY}}}`;
  function productFragment(o = cfg, access = FULL_ACCESS) {
    return ` fragment TetherProduct on Product{id handle title description descriptionHtml productType vendor tags availableForSale publishedAt onlineStoreUrl requiresSellingPlan seo{title description}featuredImage{${IMAGE_FIELDS}}images(first:${o.imagesFirst}){nodes{${IMAGE_FIELDS}}}options{name optionValues{name swatch{color image{previewImage{${IMAGE_FIELDS}}}}}}priceRange{minVariantPrice{${MONEY}}maxVariantPrice{${MONEY}}}compareAtPriceRange{minVariantPrice{${MONEY}}maxVariantPrice{${MONEY}}}${metafieldsField(o.metafields)} sellingPlanGroups(first:${o.sellingPlanGroupsFirst}){nodes{name appName options{name values}sellingPlans(first:${o.sellingPlansFirst}){nodes{${SELLING_PLAN_FIELDS}}}}}variants(first:${o.variantsFirst}){nodes{id title availableForSale currentlyNotInStock ${inventoryField(access)} sku barcode selectedOptions{name value}image{${IMAGE_FIELDS}}price{${MONEY}}compareAtPrice{${MONEY}}unitPrice{${MONEY}}sellingPlanAllocations(first:${o.sellingPlansFirst}){nodes{${ALLOCATION_FIELDS}}}}}}`;
  }
  function cartFragment(access = FULL_ACCESS) {
    return ` fragment TetherCart on Cart{id checkoutUrl totalQuantity note createdAt updatedAt attributes{key value}buyerIdentity{countryCode email}discountCodes{code applicable}cost{subtotalAmount{${MONEY}}totalAmount{${MONEY}}checkoutChargeAmount{${MONEY}}}lines(first:100){nodes{id quantity attributes{key value}cost{totalAmount{${MONEY}}subtotalAmount{${MONEY}}amountPerQuantity{${MONEY}}compareAtAmountPerQuantity{${MONEY}}}discountAllocations{discountedAmount{${MONEY}}}sellingPlanAllocation{sellingPlan{id name description recurringDeliveries options{name value}}checkoutChargeAmount{${MONEY}}priceAdjustments{price{${MONEY}}compareAtPrice{${MONEY}}perDeliveryPrice{${MONEY}}}}merchandise{... on ProductVariant{id title sku availableForSale requiresShipping ${inventoryField(access)} image{${IMAGE_FIELDS}}price{${MONEY}}compareAtPrice{${MONEY}}selectedOptions{name value}product{id title handle vendor featuredImage{${IMAGE_FIELDS}}}}}... on ComponentizableCartLine{lineComponents{id quantity merchandise{... on ProductVariant{id title product{title handle}}}}}}}}`;
  }

  // src/selling-plans.ts
  var selling_plans_exports = {};
  __export(selling_plans_exports, {
    GID: () => GID,
    allPlans: () => allPlans,
    allocationFor: () => allocationFor,
    findPlan: () => findPlan,
    hasPlans: () => hasPlans,
    planAdjustment: () => planAdjustment,
    planCheckoutCharge: () => planCheckoutCharge,
    planPrice: () => planPrice,
    planSavings: () => planSavings,
    plansForVariant: () => plansForVariant,
    toGid: () => toGid
  });

  // src/amounts.ts
  var DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
  function toScaledInteger(amount, fractionDigits) {
    const match = DECIMAL.exec(amount.trim());
    if (!match) return null;
    const [, sign = "", whole = "0", fraction = ""] = match;
    const digits = BigInt(`${whole}${fraction.padEnd(fractionDigits, "0")}`);
    return sign === "-" ? -digits : digits;
  }
  var fractionLength = (amount) => amount.split(".")[1]?.length ?? 0;
  function isGreaterAmount(amount, other) {
    if (amount == null || other == null) return false;
    const fractionDigits = Math.max(fractionLength(amount.trim()), fractionLength(other.trim()));
    const scaled = toScaledInteger(amount, fractionDigits);
    const scaledOther = toScaledInteger(other, fractionDigits);
    if (scaled === null || scaledOther === null) return false;
    return scaled > scaledOther;
  }
  var DEFAULT_FRACTION_DIGITS = 2;
  var fractionDigitsByCurrency = /* @__PURE__ */ new Map();
  function currencyFractionDigits(currencyCode) {
    const known = fractionDigitsByCurrency.get(currencyCode);
    if (known !== void 0) return known;
    let digits = DEFAULT_FRACTION_DIGITS;
    try {
      const format = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode });
      digits = format.resolvedOptions().maximumFractionDigits ?? DEFAULT_FRACTION_DIGITS;
    } catch {
    }
    fractionDigitsByCurrency.set(currencyCode, digits);
    return digits;
  }
  function toMinorUnits(money) {
    return Math.round(parseFloat(money.amount) * 10 ** currencyFractionDigits(money.currencyCode));
  }
  function fromMinorUnits(minorUnits, currencyCode) {
    const digits = currencyFractionDigits(currencyCode);
    return { amount: (minorUnits / 10 ** digits).toFixed(digits), currencyCode };
  }

  // src/selling-plans.ts
  var PERCENT = 100;
  function toGid(value, type) {
    const text2 = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (!text2) return null;
    if (text2.startsWith("gid://")) return text2;
    if (/^\d+$/.test(text2)) return `gid://shopify/${type}/${text2}`;
    return text2;
  }
  var GID = {
    product: (value) => toGid(value, "Product"),
    variant: (value) => toGid(value, "ProductVariant"),
    sellingPlan: (value) => toGid(value, "SellingPlan")
  };
  function allPlans(product) {
    const groups = product?.sellingPlanGroups?.nodes ?? [];
    return groups.flatMap((group) => group.sellingPlans.nodes.map((plan) => ({ ...plan, group })));
  }
  function hasPlans(product) {
    return allPlans(product).length > 0;
  }
  function allocationFor(variant, planId) {
    if (!variant || !planId) return null;
    const allocations = variant.sellingPlanAllocations?.nodes ?? [];
    return allocations.find((allocation) => allocation.sellingPlan.id === planId) ?? null;
  }
  function plansForVariant(product, variant) {
    return allPlans(product).filter((plan) => allocationFor(variant, plan.id));
  }
  function planPrice(variant, planId) {
    const adjustment = allocationFor(variant, planId)?.priceAdjustments[0];
    return adjustment?.perDeliveryPrice ?? adjustment?.price ?? variant?.price ?? null;
  }
  function planCheckoutCharge(variant, planId) {
    const allocation = allocationFor(variant, planId);
    return allocation?.checkoutChargeAmount ?? allocation?.priceAdjustments[0]?.price ?? variant?.price ?? null;
  }
  function planSavings(variant, planId) {
    const onPlanPrice = planPrice(variant, planId);
    if (!variant || !onPlanPrice) return { amount: null, percentage: 0 };
    const oneTime = parseFloat(variant.price.amount);
    const onPlan = parseFloat(onPlanPrice.amount);
    if (!Number.isFinite(oneTime) || !Number.isFinite(onPlan) || oneTime <= 0 || onPlan >= oneTime) {
      return { amount: null, percentage: 0 };
    }
    const saved = toMinorUnits(variant.price) - toMinorUnits(onPlanPrice);
    return {
      amount: fromMinorUnits(saved, variant.price.currencyCode),
      percentage: Math.round((1 - onPlan / oneTime) * PERCENT)
    };
  }
  function planAdjustment(plan) {
    const value = plan?.priceAdjustments[0]?.adjustmentValue;
    if (!value) return null;
    switch (value.__typename) {
      case "SellingPlanPercentagePriceAdjustment":
        return { type: "percentage", value: value.adjustmentPercentage };
      case "SellingPlanFixedAmountPriceAdjustment":
        return { type: "amount", value: value.adjustmentAmount };
      case "SellingPlanFixedPriceAdjustment":
        return { type: "price", value: value.price };
      default:
        return null;
    }
  }
  function findPlan(product, ref) {
    if (!ref) return null;
    const plans = allPlans(product);
    const gid = GID.sellingPlan(ref);
    const needle = ref.trim().toLowerCase();
    return plans.find((plan) => plan.id === gid) ?? plans.find((plan) => plan.name.toLowerCase() === needle) ?? plans.find((plan) => plan.options.some((option) => option.value.toLowerCase() === needle)) ?? null;
  }

  // src/product-shape.ts
  var MONEY2 = { amount: "string", currencyCode: "string" };
  var PRODUCT = {
    id: "string",
    handle: "string",
    title: "string",
    options: ["object"],
    images: { nodes: ["object"] },
    priceRange: { minVariantPrice: MONEY2, maxVariantPrice: MONEY2 },
    variants: { nodes: [{ id: "string", price: MONEY2, selectedOptions: ["object"] }] }
  };
  var isProductShape = (value) => field(value, "id") !== "" && field(value, "handle") !== "" && matches(value, PRODUCT);
  var PRODUCT_NODE = (node) => isRecord(node) && (node["id"] === void 0 || matches(node, PRODUCT));

  // src/cart/cart-shape.ts
  var LINE = {
    id: "string",
    quantity: "number",
    attributes: ["object"],
    cost: { totalAmount: MONEY2, subtotalAmount: MONEY2, amountPerQuantity: MONEY2 },
    merchandise: { id: "string", selectedOptions: ["object"], product: "object" }
  };
  var CART = {
    id: "string",
    checkoutUrl: "string",
    totalQuantity: "number",
    attributes: ["object"],
    discountCodes: ["object"],
    cost: { totalAmount: MONEY2, subtotalAmount: MONEY2 },
    lines: { nodes: [LINE] }
  };

  // src/cart/drawer.ts
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var FOCUS_AFTER_OPEN_MS = 60;
  var openWithoutDrawer = false;
  var announcedOpen = false;
  var returnFocus = null;
  var pageWatcher = null;
  var isFocusable = (el) => el !== null && "focus" in el;
  var focusables = (drawer) => qsa(drawer, FOCUSABLE).filter((el) => el.offsetParent !== null || el === document.activeElement);
  var drawers = () => qsa(document, sel("cart-drawer"));
  var isOpenDrawer = (drawer) => drawer.classList.contains(cfg.cartDrawerOpenClass);
  var hasFocusInside = (all) => all.some((drawer) => drawer.contains(document.activeElement));
  var isManual = (drawer) => get(drawer, "cart-drawer") === "manual";
  function isOpen() {
    const openClassed = [...document.getElementsByClassName(cfg.cartDrawerOpenClass)];
    return openClassed.some((el) => el.matches(sel("cart-drawer"))) || openWithoutDrawer && !drawers().length;
  }
  function announceChange() {
    const open = isOpen();
    if (open === announcedOpen) return;
    const all = drawers();
    if (open) announceOpen(all.filter(isOpenDrawer));
    else announceClosed(all, document.activeElement === document.body || hasFocusInside(all));
  }
  function syncDrawerAria() {
    qsa(document, sel("cart-open")).forEach((button) => {
      button.setAttribute("aria-expanded", String(isOpen()));
    });
    drawers().forEach((drawer) => {
      if (!drawer.hasAttribute("role")) drawer.setAttribute("role", "dialog");
      if (!drawer.hasAttribute("aria-label") && !drawer.hasAttribute("aria-labelledby")) {
        drawer.setAttribute("aria-label", get(drawer, "cart-label") || "Cart");
      }
      const open = isOpenDrawer(drawer);
      drawer.setAttribute("aria-modal", String(open));
      drawer.setAttribute("aria-hidden", String(!open));
      drawer.inert = !open;
    });
    if (pageWatcher) return;
    pageWatcher = new MutationObserver(announceChange);
    pageWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true
    });
  }
  function focusInto(drawer) {
    const target = focusables(drawer)[0] ?? drawer;
    if (target === drawer && !drawer.hasAttribute("tabindex")) drawer.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  function announceOpen(opened) {
    announcedOpen = true;
    syncDrawerAria();
    const [first] = opened;
    if (cfg.cartFocus && first) {
      returnFocus = isFocusable(document.activeElement) ? document.activeElement : null;
      setTimeout(() => {
        focusInto(first);
      }, FOCUS_AFTER_OPEN_MS);
    }
    callHook("onCartOpen", () => cfg.onCartOpen?.(opened));
    emit("cart-toggled", { open: true });
  }
  function announceClosed(all, hadFocus) {
    announcedOpen = false;
    openWithoutDrawer = false;
    syncDrawerAria();
    if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    callHook("onCartClose", () => cfg.onCartClose?.(all));
    emit("cart-toggled", { open: false });
  }
  function openCart() {
    if (isOpen()) return;
    const all = drawers();
    const opened = all.filter((drawer) => !isManual(drawer));
    if (all.length && !opened.length) return;
    openWithoutDrawer = !all.length;
    opened.forEach((drawer) => {
      drawer.classList.add(cfg.cartDrawerOpenClass);
    });
    announceOpen(opened);
  }
  function closeCart() {
    if (!isOpen()) return;
    const all = drawers();
    const hadFocus = hasFocusInside(all);
    all.forEach((drawer) => {
      drawer.classList.remove(cfg.cartDrawerOpenClass);
    });
    announceClosed(all, hadFocus);
  }
  function toggleCart() {
    if (isOpen()) closeCart();
    else openCart();
  }
  function trapFocus(event) {
    if (event.key !== "Tab" || !cfg.cartFocus || !isOpen()) return;
    const drawer = drawers().find(isOpenDrawer);
    if (!drawer) return;
    const inside = focusables(drawer);
    const first = inside[0];
    const last = inside.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    const leaving = event.shiftKey ? active === first : active === last;
    if (drawer.contains(active) && !leaving) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }

  // src/loader.ts
  var MISS_CACHE_MS = 1e4;
  var FRESH_MS = 6e4;
  var productCache = /* @__PURE__ */ new Map();
  var stale = /* @__PURE__ */ new Set();
  var freshAt = /* @__PURE__ */ new Map();
  var queued = /* @__PURE__ */ new Map();
  var flushScheduled = false;
  var generation = 0;
  var isGid = (key) => key.startsWith("gid://");
  var normalizeProductKey = productKey;
  function primeProduct(product) {
    if (!product) return;
    const loaded = Promise.resolve(product);
    productCache.set(product.handle, loaded);
    productCache.set(product.id, loaded);
  }
  function getProduct(rawKey) {
    const key = normalizeProductKey(rawKey);
    if (!key) return Promise.reject(new TetherError("empty product key", { code: "NOT_FOUND" }));
    const cached = productCache.get(key);
    if (cached) return cached;
    const loading = new Promise((resolve, reject) => {
      queued.set(key, { resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(() => void flush(), 0);
      }
    });
    productCache.set(key, loading);
    return loading;
  }
  var withProductFragment = (operation) => (access) => `${operation}${productFragment(cfg, access)}`;
  function batchQuery(keys) {
    const ids = keys.filter(isGid);
    const handles = keys.filter((key) => !isGid(key));
    const definitions = [];
    const selections = [];
    const variables = {};
    if (ids.length) {
      definitions.push("$ids: [ID!]!");
      variables["ids"] = ids;
      selections.push(`byId:nodes(ids:$ids){... on Product{...TetherProduct}}`);
    }
    handles.forEach((handle, index) => {
      definitions.push(`$h${index}: String!`);
      variables[`h${index}`] = handle;
      selections.push(`h${index}:product(handle:$h${index}){...TetherProduct}`);
    });
    const query2 = withProductFragment(`query TetherProducts(${definitions.join(",")}){${selections.join(" ")}}`);
    return { query: query2, variables, handles };
  }
  function forgetMissLater(key, batchGeneration) {
    if (batchGeneration !== generation) return;
    const miss = productCache.get(key);
    setTimeout(() => {
      if (productCache.get(key) === miss) productCache.delete(key);
    }, MISS_CACHE_MS);
  }
  function isBatchData(data) {
    if (!isRecord(data)) return false;
    const { byId = [], ...byHandle } = data;
    return matches(byId, [orNull(PRODUCT_NODE)]) && Object.values(byHandle).every(orNull(PRODUCT));
  }
  async function flush() {
    flushScheduled = false;
    const batchGeneration = generation;
    const batch = [...queued];
    queued.clear();
    const keys = batch.map(([key]) => key);
    const { query: query2, variables, handles } = batchQuery(keys);
    log("fetch products", keys);
    let data;
    try {
      data = await gql(query2, variables, isBatchData);
    } catch (error) {
      batch.forEach(([key, waiter]) => {
        if (batchGeneration === generation) productCache.delete(key);
        waiter.reject(error);
      });
      return;
    }
    const found = /* @__PURE__ */ new Map();
    for (const product of data.byId ?? []) if (product?.id) found.set(product.id, product);
    handles.forEach((handle, index) => {
      const product = data[`h${index}`];
      if (product) found.set(handle, product);
    });
    const now = Date.now();
    batch.forEach(([key, waiter]) => {
      const product = found.get(key);
      if (!product) {
        forgetMissLater(key, batchGeneration);
        waiter.reject(new TetherError(`Product not found: ${key}`, { code: "NOT_FOUND" }));
        return;
      }
      if (batchGeneration === generation) {
        primeProduct(product);
        freshAt.set(product.handle, now);
        freshAt.set(product.id, now);
      }
      waiter.resolve(product);
    });
  }
  function clearProductCache() {
    for (const key of productCache.keys()) if (!queued.has(key)) productCache.delete(key);
    generation += 1;
    stale.clear();
    freshAt.clear();
  }
  function hydrateProducts(products) {
    for (const product of products ?? []) {
      if (!product.id || !product.handle) continue;
      const loadedAgo = Date.now() - (freshAt.get(product.handle) ?? 0);
      if (loadedAgo < FRESH_MS && productCache.has(product.handle)) continue;
      primeProduct(product);
      stale.add(product.handle);
      stale.add(product.id);
    }
  }
  function takeStale(rawKey) {
    const key = normalizeProductKey(rawKey);
    if (!key || !stale.has(key)) return false;
    stale.delete(key);
    void productCache.get(key)?.then((product) => {
      stale.delete(product.handle);
      stale.delete(product.id);
    }, failureIsReportedByTheRender);
    return true;
  }
  function failureIsReportedByTheRender() {
  }
  function refreshProduct(key) {
    const normalized = normalizeProductKey(key);
    if (normalized) productCache.delete(normalized);
    return getProduct(key);
  }

  // src/product-render.ts
  var NTH_IMAGE_BIND = /^image:(\d+)$/;
  var METAFIELD_BIND = "metafield:";
  var MULTI_LINE_METAFIELD = /^(rich_text|multi_line_text)_field$/;
  var ALL_PLAN_GROUPS = ["", "true", "all", "*"];
  var isSelect = (el) => el.tagName === "SELECT";
  var selectsIn = (scope, selector) => scope.$(`select${selector}`).filter(isSelect);
  function renderGallery(el, product) {
    const images = product.images.nodes;
    const rendered = [...el.children].map((node) => node.tagName === "IMG" ? node : node.querySelector("img"));
    const same = !hasTemplate(el) && rendered.length === images.length && rendered.every((img, index) => sameImage(img?.getAttribute("src"), images[index]?.url));
    if (same) return;
    repeat(el, images, (node, image) => {
      const target = node.matches(`img,${sel("bind", "image")}`) ? node : qsa(node, "img")[0] ?? node;
      setImage(target, image.url, image.altText || product.title);
    });
  }
  function renderMetafield(el, product, ref) {
    const dot = ref.indexOf(".");
    const namespace = ref.slice(0, dot);
    const key = ref.slice(dot + 1);
    const metafield = (product.metafields ?? []).find((field2) => field2?.namespace === namespace && field2.key === key);
    if (!metafield) {
      setText(el, "");
      return;
    }
    const image = metafield.reference?.image;
    if (image) {
      setImage(el, image.url, image.altText);
      return;
    }
    if (MULTI_LINE_METAFIELD.test(metafield.type)) el.style.whiteSpace = "pre-line";
    setText(el, metafield.value);
  }
  var PRODUCT_TEXTS = new Map(
    Object.entries({
      title: (product) => product.title,
      "description-text": (product) => product.description,
      vendor: (product) => product.vendor,
      type: (product) => product.productType,
      handle: (product) => product.handle,
      "published-at": (product) => formatDate(product.publishedAt),
      "min-price": (product) => formatMoney2(product.priceRange.minVariantPrice),
      "max-price": (product) => formatMoney2(product.priceRange.maxVariantPrice)
    })
  );
  function renderTags(el, product) {
    const exclude = (el.getAttribute("exclude") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const tags = product.tags.filter((tag) => !exclude.includes(tag));
    repeat(el, tags, (node, tag) => {
      setText(node, tag);
    });
  }
  function renderProductBind(el, key, product) {
    const text2 = PRODUCT_TEXTS.get(key);
    if (text2) {
      setText(el, text2(product));
      return;
    }
    switch (key) {
      case "description":
        setStoreHtml(el, product.descriptionHtml);
        break;
      case "featured-image":
        setImage(el, product.featuredImage?.url, product.featuredImage?.altText || product.title);
        break;
      case "url":
      case "link": {
        const url2 = productUrl2(product.handle, product.id);
        if (url2) el.setAttribute("href", url2);
        if (key === "url" && !el.firstElementChild && !el.textContent.trim()) setText(el, product.title);
        break;
      }
      case "images":
        renderGallery(el, product);
        break;
      case "tags":
        renderTags(el, product);
        break;
      default:
        renderIndexedBind(el, key, product);
    }
  }
  function renderIndexedBind(el, key, product) {
    const nth = NTH_IMAGE_BIND.exec(key);
    if (nth) {
      const image = product.images.nodes[Number(nth[1]) - 1] ?? product.featuredImage;
      setImage(el, image?.url, image?.altText || product.title);
    } else if (key.startsWith(METAFIELD_BIND)) {
      renderMetafield(el, product, key.slice(METAFIELD_BIND.length));
    }
  }
  function renderOptionLists(scope) {
    const { product } = scope;
    scope.$(sel("option-list")).forEach((container) => {
      const name = scope.optName(get(container, "option-list"));
      const option = product.options.find((candidate) => candidate.name === name);
      if (!option || option.optionValues.length <= 1 && has(container, "hide-single")) {
        show(container, false);
        return;
      }
      repeat(container, option.optionValues, (node, value) => {
        node.setAttribute(attr("option-value"), value.name);
        const text2 = qsa(node, sel("bind", "option-value"))[0];
        if (text2) setText(text2, value.name);
        else if (!node.firstElementChild) setText(node, value.name);
        const swatchEl = qsa(node, sel("bind", "swatch"))[0];
        const { swatch } = value;
        if (!swatchEl || !swatch) return;
        if (swatch.color) swatchEl.style.backgroundColor = swatch.color;
        if (swatch.image?.previewImage) setImage(swatchEl, swatch.image.previewImage.url, value.name);
      });
    });
  }
  function renderSelects(scope) {
    const { product } = scope;
    selectsIn(scope, sel("option")).forEach((select) => {
      const option = product.options.find((candidate) => candidate.name === scope.optName(get(select, "option")));
      if (!option) {
        show(select, false);
        return;
      }
      select.replaceChildren(...option.optionValues.map((value) => new Option(value.name, value.name)));
    });
    selectsIn(scope, sel("variant-select")).forEach((select) => {
      select.replaceChildren(...product.variants.nodes.map((variant) => new Option(variant.title, variant.id)));
    });
    selectsIn(scope, sel("plan")).forEach((select) => {
      const plans = scope.plans.map((plan) => new Option(plan.name, plan.id));
      const oneTime = !product.requiresSellingPlan && get(select, "plan") !== "subscription-only";
      const oneTimeLabel = select.getAttribute(attr("one-time-label")) || "One-time purchase";
      select.replaceChildren(...oneTime ? [new Option(oneTimeLabel, "")] : [], ...plans);
    });
  }
  function renderPlanLists(scope) {
    scope.$(sel("plan-list")).forEach((container) => {
      const raw = (get(container, "plan-list") ?? "").trim();
      const group = ALL_PLAN_GROUPS.includes(raw.toLowerCase()) ? null : raw;
      const plans = scope.plans.filter((plan) => !group || plan.group.name === group);
      repeat(container, plans, (node, plan) => {
        node.setAttribute(attr("plan-value"), plan.id);
        if (!node.firstElementChild && !node.querySelector(sel("plan-bind"))) setText(node, plan.name);
      });
    });
  }
  function writeProduct(scope) {
    scope.$(sel("bind")).forEach((el) => {
      renderProductBind(el, get(el, "bind") ?? "", scope.product);
    });
    renderOptionLists(scope);
    renderSelects(scope);
    renderPlanLists(scope);
  }

  // src/cart/render.ts
  var DEFAULT_TITLE = "Default Title";
  var quantityOf = (line, pending) => pending.get(line.id)?.quantity ?? line.quantity;
  var numericId = (gid) => gid.split("/").pop() ?? gid;
  function lineUrl(line) {
    const variant = line.merchandise;
    const base = productUrl2(variant.product.handle, variant.product.id);
    if (!base) return null;
    const query2 = new URLSearchParams();
    query2.set("variant", numericId(variant.id));
    const planId = line.sellingPlanAllocation?.sellingPlan.id;
    if (planId) query2.set("selling_plan", numericId(planId));
    return `${base}${base.includes("?") ? "&" : "?"}${query2.toString()}`;
  }
  var productTitle = (line) => line.merchandise.product.title;
  var LINE_TEXT = {
    title: productTitle,
    "product-title": productTitle,
    "variant-title": (line) => line.merchandise.title === DEFAULT_TITLE ? "" : line.merchandise.title,
    options: (line) => line.merchandise.selectedOptions.filter((option) => option.value !== DEFAULT_TITLE).map((option) => `${option.name}: ${option.value}`).join(", "),
    vendor: (line) => line.merchandise.product.vendor,
    sku: (line) => line.merchandise.sku ?? "",
    price: (line) => formatMoney2(line.cost.amountPerQuantity),
    "compare-at-price": (line) => formatMoney2(line.cost.compareAtAmountPerQuantity ?? line.merchandise.compareAtPrice),
    "line-total": (line) => formatMoney2(line.cost.totalAmount),
    "line-subtotal": (line) => formatMoney2(line.cost.subtotalAmount),
    quantity: (line, view) => quantityOf(line, view.pending),
    plan: (line) => line.sellingPlanAllocation?.sellingPlan.name ?? "",
    "plan-description": (line) => line.sellingPlanAllocation?.sellingPlan.description ?? "",
    components: (line) => (line.lineComponents ?? []).map((component) => `${component.quantity} \xD7 ${component.merchandise.product.title}`).join(", ")
  };
  var ATTRIBUTE_KEY = "attribute:";
  function lineValue(line, key, view) {
    if (Object.hasOwn(LINE_TEXT, key)) return LINE_TEXT[key]?.(line, view);
    if (!key.startsWith(ATTRIBUTE_KEY)) return void 0;
    const name = key.slice(ATTRIBUTE_KEY.length);
    return line.attributes.find((attribute) => attribute.key === name)?.value ?? "";
  }
  function fillPlanSelect(select, line, product) {
    const plans = allPlans(product);
    const allowOneTime = !product.requiresSellingPlan && get(select, "line-plan") !== "subscription-only";
    const oneTime = { value: "", label: select.getAttribute(attr("one-time-label")) || "One-time purchase" };
    const choices = [...allowOneTime ? [oneTime] : [], ...plans.map((plan) => ({ value: plan.id, label: plan.name }))];
    const signature = choices.map((choice) => choice.value).join("|");
    if (select.dataset["tetherSig"] !== signature) {
      select.replaceChildren(
        ...choices.map((choice) => {
          const option = document.createElement("option");
          option.value = choice.value;
          option.textContent = choice.label;
          return option;
        })
      );
      select.dataset["tetherSig"] = signature;
    }
    select.value = line.sellingPlanAllocation?.sellingPlan.id ?? "";
    show(select, plans.length > 0);
  }
  function renderLineState(node, line, view) {
    const isSubscription = Boolean(line.sellingPlanAllocation);
    node.classList.toggle("is-subscription", isSubscription);
    const warning = view.warnings.find((candidate) => candidate.target === line.id);
    node.classList.toggle("is-warning", Boolean(warning));
    const pending = view.pending.has(line.id);
    node.classList.toggle("is-busy", pending);
    if (pending) node.setAttribute("aria-busy", "true");
    else node.removeAttribute("aria-busy");
    qsa(node, sel("line", "warning")).forEach((el) => {
      setTextTracked(el, warning?.message ?? "");
    });
    const conditions = /* @__PURE__ */ new Map([
      ["subscription", isSubscription],
      ["one-time", !isSubscription],
      ["on-sale", isGreaterAmount(line.cost.compareAtAmountPerQuantity?.amount, line.cost.amountPerQuantity.amount)],
      ["has-components", (line.lineComponents ?? []).length > 0],
      ["warning", Boolean(warning)]
    ]);
    qsa(node, sel("line-show")).forEach((el) => {
      const key = get(el, "line-show");
      const visible = key === null ? void 0 : conditions.get(key);
      if (visible !== void 0) show(el, visible);
    });
  }
  function renderLine(node, line, view) {
    const variant = line.merchandise;
    node.setAttribute(attr("line-id"), line.id);
    qsa(node, sel("line")).forEach((el) => {
      const key = get(el, "line") ?? "";
      if (key === "image") {
        setImage(el, variant.image?.url ?? variant.product.featuredImage?.url, variant.product.title);
        return;
      }
      if (key === "url") {
        const url2 = lineUrl(line);
        if (url2) el.setAttribute("href", url2);
        return;
      }
      const value = lineValue(line, key, view);
      if (value !== void 0) setTextTracked(el, value);
    });
    renderLineState(node, line, view);
    const planSelects = qsa(node, sel("line-plan")).filter(isSelect);
    planSelects.forEach((select) => {
      getProduct(variant.product.handle).then((product) => {
        fillPlanSelect(select, line, product);
      }).catch((error) => {
        reportError(error, "line plan options");
      });
    });
  }
  function renderConditions(cart, view) {
    const count = cart?.totalQuantity ?? 0;
    const hasSubscription = (cart?.lines.nodes ?? []).some((line) => line.sellingPlanAllocation);
    const conditions = /* @__PURE__ */ new Map([
      ["cart-empty", count === 0],
      ["cart-filled", count > 0],
      ["cart-has-subscription", hasSubscription],
      ["cart-no-subscription", !hasSubscription],
      ["cart-has-discount", (cart?.discountCodes ?? []).some((code) => code.applicable)],
      ["cart-error", view.failed],
      ["cart-warning", view.warnings.length > 0]
    ]);
    qsa(document, sel("show")).forEach((el) => {
      const key = get(el, "show");
      const visible = key === null ? void 0 : conditions.get(key);
      if (visible === void 0 || el.closest(sel("product"))) return;
      show(el, visible);
    });
    qsa(document, sel("checkout")).forEach((el) => {
      el.classList.toggle("is-disabled", !count);
      el.setAttribute("aria-disabled", String(!count));
    });
  }
  function renderFields(cart) {
    qsa(document, `textarea${sel("cart-note")},input${sel("cart-note")}`).forEach((el) => {
      if (document.activeElement !== el) setText(el, cart?.note ?? "");
    });
    qsa(document, sel("cart-discounts")).forEach((container) => {
      repeat(container, cart?.discountCodes ?? [], (node, discount) => {
        node.setAttribute(attr("discount-code"), discount.code);
        const target = node.querySelector(sel("discount", "code")) ?? (node.firstElementChild ? null : node);
        if (target) setText(target, discount.code);
        node.classList.toggle("is-inapplicable", !discount.applicable);
      });
    });
  }
  function renderCart(view) {
    const { cart } = view;
    const money = (key) => cart ? formatMoney2(cart.cost[key]) : "";
    syncDrawerAria();
    qsa(document, sel("cart-count")).forEach((el) => {
      setTextTracked(el, cart?.totalQuantity ?? 0);
    });
    qsa(document, sel("cart-subtotal")).forEach((el) => {
      setTextTracked(el, money("subtotalAmount"));
    });
    qsa(document, sel("cart-total")).forEach((el) => {
      setTextTracked(el, money("totalAmount"));
    });
    qsa(document, sel("cart-checkout-charge")).forEach((el) => {
      setTextTracked(el, money("checkoutChargeAmount"));
    });
    renderConditions(cart, view);
    qsa(document, sel("cart-warning")).forEach((el) => {
      setTextTracked(el, [...new Set(view.warnings.map((warning) => warning.message))].join(" "));
    });
    renderFields(cart);
    qsa(document, sel("cart-lines")).forEach((container) => {
      repeatKeyed(
        container,
        cart?.lines.nodes ?? [],
        (line) => line.id,
        (node, line) => {
          renderLine(node, line, view);
        },
        { onEnter: cfg.onLineEnter, onLeave: cfg.onLineLeave }
      );
    });
    if (cart) notifyLayoutChanged("cart");
  }
  function showSavedCount(count) {
    qsa(document, sel("cart-count")).forEach((el) => {
      if (/^\s*0?\s*$/.test(el.textContent)) el.textContent = String(count);
    });
  }

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
  function removeStored(key, area = "localStorage") {
    try {
      window[area].removeItem(key);
    } catch {
    }
  }

  // server/src/shared/cart-id.ts
  var CART_ID = /^gid:\/\/shopify\/Cart\/[\w-]+(\?key=[\w-]+)?$/;

  // server/src/shared/serial.ts
  var settled = () => void 0;
  function createSerialQueue() {
    let tail = Promise.resolve();
    return (task) => {
      const result = tail.then(task);
      tail = result.then(settled, settled);
      return result;
    };
  }

  // src/cart/store.ts
  var status = { kind: "unknown" };
  var warnings = [];
  var pendingQuantities = /* @__PURE__ */ new Map();
  var cartStatus = () => status;
  function currentCart() {
    switch (status.kind) {
      case "ready":
      case "error":
        return status.cart;
      case "unknown":
      case "empty":
        return null;
    }
  }
  var currentWarnings = () => warnings;
  var statusOf = (cart) => cart ? { kind: "ready", cart } : { kind: "empty" };
  var seenKey = () => `${cfg.storageKey}:seen`;
  function savedCartId() {
    const stored = getStored(cfg.storageKey);
    if (!stored) return null;
    if (CART_ID.test(stored)) return stored;
    forgetSavedCart();
    return null;
  }
  function forgetSavedCart() {
    removeStored(cfg.storageKey);
  }
  function keepQuietly(cart) {
    status = statusOf(cart);
    if (cart) setStored(cfg.storageKey, cart.id);
  }
  function render() {
    renderCart({
      cart: currentCart(),
      warnings,
      pending: pendingQuantities,
      failed: status.kind === "error"
    });
  }
  function announce(reason) {
    render();
    emit("cart-updated", { cart: currentCart(), reason });
  }
  function commit(cart, reason) {
    keepQuietly(cart);
    setStored(seenKey(), `${Date.now()}|${cart?.totalQuantity ?? 0}`);
    announce(reason);
    return cart;
  }
  function settleLoad(outcome) {
    status = outcome.kind === "loaded" ? statusOf(outcome.cart) : { kind: "error", error: outcome.error, cart: currentCart() };
    announce("load");
  }
  function lastKnownCount() {
    const text2 = getStored(seenKey())?.split("|")[1] ?? "";
    const count = Number(text2);
    return /^\d+$/.test(text2) && Number.isSafeInteger(count) ? count : null;
  }
  function showLastKnownCount() {
    if (status.kind !== "unknown") return;
    const count = lastKnownCount();
    if (count !== null) showSavedCount(count);
  }
  function setWarnings(notes) {
    const siteText = (note) => callHook(
      "warningText",
      () => cfg.warningText?.(note),
      () => null
    );
    warnings = notes.filter((note, index) => notes.findIndex((other) => other.message === note.message) === index).map((note) => ({ ...note, message: siteText(note) || note.message }));
    if (warnings.length) emit("cart-warning", { warnings });
  }
  var runInOrder = createSerialQueue();
  var fillingTasks = 0;
  function queueFilling(enqueueTask) {
    fillingTasks++;
    return enqueueTask().finally(() => {
      fillingTasks--;
    });
  }
  var mayFill = () => fillingTasks > 0;
  function enqueue(task) {
    return runInOrder(task).then(
      (value) => {
        if (status.kind === "error") {
          status = statusOf(status.cart);
          render();
        }
        return value;
      },
      (error) => {
        status = { kind: "error", error, cart: currentCart() };
        render();
        emit("cart-error", { error });
        throw error;
      }
    );
  }
  var pendingQuantityOf = (line) => quantityOf(line, pendingQuantities);
  var meta = () => ({
    open: isOpen(),
    count: currentCart()?.totalQuantity ?? 0,
    loaded: status.kind !== "unknown",
    warnings: [...warnings]
  });
  function subscribe(listener) {
    const events = ["cart-updated", "cart-toggled"].map((name) => `${cfg.prefix}:${name}`);
    const call = () => {
      listener(currentCart(), meta());
    };
    events.forEach((name) => {
      document.addEventListener(name, call);
    });
    call();
    return () => {
      events.forEach((name) => {
        document.removeEventListener(name, call);
      });
    };
  }

  // src/cart/mutations.ts
  var UNKNOWN_CART_MESSAGE = /does not exist|not found|invalid id/i;
  var isPayloadOf = (name) => shaped({ [name]: orNull({ cart: orNull(CART) }) });
  function isCartGone(error) {
    if (!(error instanceof TetherError)) return false;
    if (error.userErrors?.some((userError) => userError.field?.[0] === "cartId")) return true;
    return (error.errors ?? []).some((graphQLError) => UNKNOWN_CART_MESSAGE.test(graphQLError.message));
  }
  function isUnclearFailure(error) {
    if (!(error instanceof TetherError)) return false;
    const { code, status: status2 = 0 } = error;
    return code === "NETWORK" || code === "INVALID_RESPONSE" || code === "SERVER_ERROR" || status2 >= 500;
  }
  function toLineInput(input, quantity = 1, options = {}) {
    const spec = typeof input === "object" && input !== null ? input : { ...options, quantity, ...input === null || input === void 0 ? {} : { variantId: input } };
    const merchandiseId = GID.variant(spec.merchandiseId || spec.variantId || spec.id);
    if (!merchandiseId) throw new TetherError("add(): variantId is required");
    const asked = parseInt(String(spec.quantity ?? 1), 10);
    const line = { merchandiseId, quantity: Math.max(1, asked || 1) };
    const planId = GID.sellingPlan(spec.sellingPlanId || spec.sellingPlan);
    if (planId) line.sellingPlanId = planId;
    const attributes = toAttributes(spec.attributes);
    if (attributes.length) line.attributes = attributes;
    return line;
  }
  function mutationText(name, args, inner) {
    return (access) => `mutation Tether_${name}(${args}){${name}(${inner}){cart{...TetherCart}userErrors{field message}warnings{code message target}}}${cartFragment(access)}`;
  }
  async function send(name, args, inner, variables) {
    const data = await gql(mutationText(name, args, inner), variables, isPayloadOf(name), { operation: "mutation" });
    const payload = unwrap(data[name], name);
    setWarnings(payload.warnings ?? []);
    return payload.cart;
  }
  function createCart(input) {
    const withIdentity = cfg.country ? { buyerIdentity: { countryCode: cfg.country }, ...input } : input;
    return send("cartCreate", "$input: CartInput!", "input: $input", { input: withIdentity });
  }
  async function mutateCart({ name, variable, type, value, create }) {
    const createInput = create ? { [variable]: value } : null;
    const cartId = savedCartId();
    if (!cartId) return createInput ? createCart(createInput) : null;
    try {
      return await send(name, `$cartId: ID!, $${variable}: ${type}`, `cartId: $cartId, ${variable}: $${variable}`, {
        [variable]: value,
        cartId
      });
    } catch (error) {
      if (!isCartGone(error)) throw error;
      forgetSavedCart();
      if (!createInput) throw error;
      log("cart expired, creating a new one");
      return createCart(createInput);
    }
  }
  async function fetchCart(id) {
    const data = await gql(
      (access) => `query TetherCart($id:ID!){cart(id:$id){...TetherCart}}${cartFragment(access)}`,
      { id },
      shaped({ cart: orNull(CART) })
    );
    return data.cart;
  }
  async function fetchCheckoutUrl(id) {
    const data = await gql(
      `query TetherCheckout($id:ID!){cart(id:$id){checkoutUrl}}`,
      { id },
      shaped({ cart: orNull({ checkoutUrl: "string" }) })
    );
    return data.cart?.checkoutUrl ?? null;
  }
  function toLineUpdate(lineId, patch) {
    const change = typeof patch === "number" ? { quantity: patch } : patch;
    const line = { id: lineId };
    if (change.quantity !== void 0) line["quantity"] = change.quantity;
    if ("sellingPlanId" in change)
      line["sellingPlanId"] = change.sellingPlanId ? GID.sellingPlan(change.sellingPlanId) : null;
    if (change.attributes) line["attributes"] = toAttributes(change.attributes);
    const variantId = change.merchandiseId || change.variantId;
    if (variantId) line["merchandiseId"] = GID.variant(variantId);
    return line;
  }
  var updateLines = (lines) => mutateCart({
    name: "cartLinesUpdate",
    variable: "lines",
    type: "[CartLineUpdateInput!]!",
    value: lines,
    create: false
  });
  var removeLines = (lineIds) => mutateCart({
    name: "cartLinesRemove",
    variable: "lineIds",
    type: "[ID!]!",
    value: lineIds,
    create: false
  });
  var setLineQuantity = (lineId, target) => target > 0 ? updateLines([{ id: lineId, quantity: target }]) : removeLines([lineId]);

  // src/cart/checkout.ts
  var resolveAccountCheckout = null;
  function setCheckoutResolver(resolver) {
    resolveAccountCheckout = resolver;
  }
  var askCheckoutUrl = (cartId) => fetchCheckoutUrl(cartId).then(
    (url2) => ({ kind: "url", url: url2 }),
    (error) => ({ kind: "failed", error })
  );
  async function accountCheckoutUrl() {
    if (!resolveAccountCheckout) return null;
    try {
      const url2 = await resolveAccountCheckout();
      return url2 && `${url2}${url2.includes("?") ? "&" : "?"}logged_in=true`;
    } catch (error) {
      reportError(error, "account checkout");
      return null;
    }
  }
  async function checkoutUrl(cartId) {
    const cartAnswer = askCheckoutUrl(cartId);
    const accountUrl = await accountCheckoutUrl();
    if (accountUrl) return accountUrl;
    const answer = await cartAnswer;
    if (answer.kind === "failed") throw answer.error;
    if (!answer.url) throw new TetherError("No checkoutUrl (cart empty or expired)");
    return answer.url;
  }
  function detachOpenerIfAllowed(tab) {
    try {
      tab.opener = null;
    } catch {
    }
  }
  function cartToCheckOut() {
    const cart = currentCart();
    return cart && !cart.totalQuantity ? null : savedCartId();
  }
  async function checkout(target = cfg.checkoutTarget) {
    if (!cartToCheckOut() && !mayFill()) return null;
    const tab = target === "_blank" ? window.open("", "_blank") : null;
    if (tab) detachOpenerIfAllowed(tab);
    try {
      await runInOrder(() => Promise.resolve());
      const cartId = cartToCheckOut();
      const url2 = cartId && await checkoutUrl(cartId);
      if (!url2) {
        tab?.close();
        return null;
      }
      if (!isHttpsUrl(url2)) throw new TetherError("The checkout URL is not https: not opened");
      if (tab?.closed) return null;
      emit("checkout", { url: url2, cart: currentCart() });
      (tab ?? window).location.href = url2;
      return url2;
    } catch (error) {
      tab?.close();
      reportError(error, "checkout failed");
      return null;
    }
  }

  // src/cart.ts
  var currentLines = () => currentCart()?.lines.nodes ?? [];
  async function reloadAfterUnclearFailure() {
    const id = savedCartId();
    if (!id) return;
    try {
      const cart = await fetchCart(id);
      if (!cart) forgetSavedCart();
      commit(cart, "load");
    } catch (error) {
      reportError(error, "cart reload after a failed change");
    }
  }
  var queuedLoad = null;
  function runChange(task) {
    queuedLoad = null;
    return enqueue(
      () => task().catch(async (error) => {
        if (isUnclearFailure(error)) await reloadAfterUnclearFailure();
        throw error;
      })
    );
  }
  function changeQuantity(lineId, delta) {
    const line = currentLines().find((candidate) => candidate.id === lineId);
    if (!line) return Promise.resolve(currentCart());
    const target = Math.max(0, pendingQuantityOf(line) + delta);
    const job = { quantity: target };
    pendingQuantities.set(lineId, job);
    announce("pending");
    const isLatest = () => pendingQuantities.get(lineId) === job;
    const sent = runChange(async () => {
      if (!isLatest()) return currentCart();
      const now = currentLines().find((candidate) => candidate.id === lineId);
      if (now?.quantity === target) return currentCart();
      const cart = await setLineQuantity(lineId, target);
      if (!isLatest()) {
        keepQuietly(cart);
        return cart;
      }
      return commit(cart, target > 0 ? "update" : "remove");
    });
    return sent.finally(() => {
      if (!isLatest()) return;
      pendingQuantities.delete(lineId);
      announce("settled");
    });
  }
  function discountCodesFrom(codes) {
    const current = (currentCart()?.discountCodes ?? []).map((discount) => discount.code);
    const list = typeof codes === "function" ? codes(current) : codes;
    return (Array.isArray(list) ? list : [list]).map((code) => code.trim()).filter(Boolean);
  }
  function mergedAttributes(attributes) {
    const merged = new Map((currentCart()?.attributes ?? []).map((attribute) => [attribute.key, attribute.value]));
    toAttributes(attributes).forEach((attribute) => merged.set(attribute.key, attribute.value));
    return [...merged].filter(([, value]) => value !== "").map(([key, value]) => ({ key, value }));
  }
  async function load() {
    const id = savedCartId();
    if (!id) {
      settleLoad({ kind: "loaded", cart: null });
      return null;
    }
    showLastKnownCount();
    try {
      const cart = await fetchCart(id);
      if (!cart) forgetSavedCart();
      settleLoad({ kind: "loaded", cart });
    } catch (error) {
      reportError(error, "cart load failed");
      if (isCartGone(error)) {
        forgetSavedCart();
        keepQuietly(null);
      }
      settleLoad({ kind: "failed", error });
    }
    return currentCart();
  }
  function reload() {
    const queueLoad = () => runInOrder(() => {
      queuedLoad = null;
      return load();
    });
    queuedLoad ?? (queuedLoad = savedCartId() ? queueFilling(queueLoad) : queueLoad());
    return queuedLoad;
  }
  var Cart = {
    init: reload,
    /** The saved cart's id. */
    id: savedCartId,
    get status() {
      return cartStatus();
    },
    get state() {
      return currentCart();
    },
    /** The cart's lines, a copy: changing it changes nothing in the cart. */
    get lines() {
      return [...currentLines()];
    },
    get count() {
      return currentCart()?.totalQuantity ?? 0;
    },
    /** True once the saved cart, or that there is none, is known. */
    get loaded() {
      return cartStatus().kind !== "unknown";
    },
    /**
     * The failure of the last load or change, until a change succeeds. Requests fail with an `Error`; anything else
     * thrown is wrapped, so the public type holds.
     */
    get lastError() {
      const current = cartStatus();
      if (current.kind !== "error") return null;
      return current.error instanceof Error ? current.error : new Error(String(current.error));
    },
    /** Shopify's notes on the last change, a copy. */
    get warnings() {
      return [...currentWarnings()];
    },
    /** Line id → the quantity quick clicks asked for. */
    get pendingQty() {
      return pendingQuantities;
    },
    /**
     * Sets where a logged-in customer checks out, or clears it with `null`: the account part's resolver answers the
     * customer's checkout URL for the cart (`null` uses the cart's own).
     */
    setCheckoutResolver,
    /**
     * Forgets the saved cart on this device, as if there were none: the page shows an empty cart and
     * `tether:cart-updated` fires with reason `load`. The next add starts a new cart.
     */
    forgetSaved() {
      forgetSavedCart();
      settleLoad({ kind: "loaded", cart: null });
    },
    render,
    subscribe,
    /**
     * `add(variantId, 2)`, `add({ variantId, quantity, sellingPlanId, attributes })`, or `add([line, line])` for
     * bundles in one request. Creates the cart when there is none.
     *
     * @throws {TetherError} (rejected) When the add fails, or Shopify answers it without a cart.
     */
    add(input, quantity = 1, options = {}) {
      const lines = (Array.isArray(input) ? input : [input]).map(
        (line) => toLineInput(line, quantity, options)
      );
      return queueFilling(
        () => runChange(async () => {
          const cart = await mutateCart({
            name: "cartLinesAdd",
            variable: "lines",
            type: "[CartLineInput!]!",
            value: lines,
            create: true
          });
          if (!cart) throw new TetherError("Shopify answered the add without a cart");
          commit(cart, "add");
          emit("added", { cart, lines });
          if (cfg.openCartOnAdd) openCart();
          return cart;
        })
      );
    },
    /**
     * `updateLine(lineId, 3)` or `updateLine(lineId, { quantity, sellingPlanId, attributes })`.
     *
     * @param patch A quantity of 0 or less removes the line.
     */
    updateLine(lineId, patch) {
      const quantity = typeof patch === "number" ? patch : patch.quantity;
      if (quantity !== void 0 && quantity <= 0) return Cart.removeLine(lineId);
      const line = toLineUpdate(lineId, patch);
      return runChange(async () => commit(await updateLines([line]), "update"));
    },
    changeQuantity,
    /** The quantity to show: the one asked for while an update is on its way. */
    quantityOf: pendingQuantityOf,
    removeLine(lineIds) {
      const ids = Array.isArray(lineIds) ? lineIds : [lineIds];
      return runChange(async () => commit(await removeLines(ids), "remove"));
    },
    /** Removes the lines the cart has when the change runs, so one queued just before it is cleared too. */
    clear() {
      return runChange(async () => {
        const ids = currentLines().map((line) => line.id);
        if (!ids.length) return currentCart();
        return commit(await removeLines(ids), "remove");
      });
    },
    setNote(note) {
      return runChange(
        async () => commit(
          await mutateCart({
            name: "cartNoteUpdate",
            variable: "note",
            type: "String!",
            value: note ?? "",
            create: true
          }),
          "note"
        )
      );
    },
    /**
     * Cart attributes, merged with the cart's (as it is when the change runs, so quick calls don't drop each other).
     *
     * @param attributes The value `''` removes a key.
     */
    setAttributes(attributes) {
      return runChange(async () => {
        const cart = await mutateCart({
          name: "cartAttributesUpdate",
          variable: "attributes",
          type: "[AttributeInput!]!",
          value: mergedAttributes(attributes),
          create: true
        });
        return commit(cart, "attributes");
      });
    },
    /** Replaces the discount codes; `[]` removes them all. */
    setDiscountCodes(codes) {
      return runChange(async () => {
        const cart = await mutateCart({
          name: "cartDiscountCodesUpdate",
          variable: "discountCodes",
          type: "[String!]!",
          value: discountCodesFrom(codes),
          create: true
        });
        return commit(cart, "discount");
      });
    },
    /**
     * Adds a code. A code Shopify doesn't accept is removed again, so it doesn't warn on every later change.
     *
     * @throws {TetherError} `INVALID_DISCOUNT` (rejected) when Shopify doesn't accept the code, or it is blank.
     */
    async applyDiscount(typed) {
      const code = typed.trim();
      if (!code) throw new TetherError("No discount code", { code: "INVALID_DISCOUNT" });
      const cart = await Cart.setDiscountCodes((current) => [.../* @__PURE__ */ new Set([...current, code])]);
      const wanted = code.toLowerCase();
      const applied = (cart?.discountCodes ?? []).find((discount) => discount.code.toLowerCase() === wanted);
      if (applied?.applicable) return cart;
      try {
        await Cart.removeDiscount(code);
      } catch (error) {
        reportError(error, "removing a discount code Shopify refused");
      }
      throw new TetherError(`Discount code not valid: ${code}`, { code: "INVALID_DISCOUNT" });
    },
    removeDiscount(code) {
      const unwanted = code.trim().toLowerCase();
      return Cart.setDiscountCodes((current) => current.filter((existing) => existing.toLowerCase() !== unwanted));
    },
    /**
     * Sets who is buying; a country changes the cart's currency and prices to that market's.
     *
     * @param options `create: false` forgets an expired cart instead of creating an empty one.
     */
    setBuyerIdentity(buyerIdentity, { create = true } = {}) {
      return runChange(async () => {
        const cart = await mutateCart({
          name: "cartBuyerIdentityUpdate",
          variable: "buyerIdentity",
          type: "CartBuyerIdentityInput!",
          value: buyerIdentity,
          create
        }).catch((error) => {
          if (create || !isCartGone(error)) throw error;
          return null;
        });
        return commit(cart, "buyer-identity");
      });
    },
    checkout,
    drawers,
    isOpen,
    open: openCart,
    close: closeCart,
    toggle: toggleCart
  };

  // src/product-state.ts
  var PERCENT2 = 100;
  var timesQuantity = (money, quantity) => fromMinorUnits(toMinorUnits(money) * quantity, money.currencyCode);
  var selectionOf = (variant) => Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value]));
  function findVariant(product, selected) {
    return product.variants.nodes.find(
      (variant) => variant.selectedOptions.every((option) => selected[option.name] === option.value)
    ) ?? null;
  }
  function isValueAvailable(product, selected, name, value) {
    return product.variants.nodes.some(
      (variant) => variant.availableForSale && variant.selectedOptions.every(
        (option) => option.name === name ? option.value === value : selected[option.name] === option.value
      )
    );
  }
  var purchasePlanId = (purchase) => purchase.kind === "subscription" ? purchase.planId : purchase.offeredPlanId;
  function linePurchase(purchase, variant) {
    if (purchase.kind === "subscription" && allocationFor(variant, purchase.planId)) return purchase;
    return { kind: "one-time" };
  }
  function normalisePurchase(product, variant, kind, preferredPlanId) {
    const plans = allPlans(product);
    const known = plans.find((plan) => plan.id === preferredPlanId) ?? plans[0];
    if (!known) return { kind: "one-time", offeredPlanId: null };
    const onVariant = allocationFor(variant, known.id) ? known : plans.find((plan) => allocationFor(variant, plan.id)) ?? known;
    if (product.requiresSellingPlan || kind === "subscription") return { kind: "subscription", planId: onVariant.id };
    return { kind: "one-time", offeredPlanId: onVariant.id };
  }
  function initialChoice(product, { variant, sellingPlan, defaultPlan, defaultPurchase }) {
    const variants = product.variants.nodes;
    const wantedId = GID.variant(variant);
    const start = variants.find((candidate) => candidate.id === wantedId) ?? variants.find((candidate) => candidate.availableForSale) ?? variants[0] ?? null;
    const fromUrl = findPlan(product, sellingPlan);
    const offered = fromUrl ?? findPlan(product, defaultPlan);
    const kind = fromUrl || defaultPurchase === "subscription" ? "subscription" : "one-time";
    return {
      selected: start ? selectionOf(start) : {},
      purchase: normalisePurchase(product, start, kind, offered?.id ?? null)
    };
  }
  function showConditions(variant, lowStock, variantCount, sale, requiresSellingPlan) {
    const stock = variant.quantityAvailable;
    const low = stock != null && stock > 0 && stock <= lowStock;
    const onSale = sale.compareAtPrice !== null;
    const onPlan = sale.line.kind === "subscription";
    return {
      "in-stock": variant.availableForSale,
      "out-of-stock": !variant.availableForSale,
      backorder: variant.availableForSale && variant.currentlyNotInStock,
      "on-sale": onSale,
      "not-on-sale": !onSale,
      "has-variants": variantCount > 1,
      "single-variant": variantCount === 1,
      "low-stock": low,
      "plenty-in-stock": variant.availableForSale && !low,
      "subscription-available": sale.subscriptionAvailable,
      "subscription-unavailable": !sale.subscriptionAvailable,
      "subscription-only": requiresSellingPlan,
      "one-time-available": !requiresSellingPlan,
      "subscription-selected": onPlan,
      "one-time-selected": !onPlan,
      "has-savings": onPlan ? sale.savings.percentage > 0 : onSale
    };
  }
  function productView(product, choice, lowStock) {
    const exact = findVariant(product, choice.selected);
    const variant = exact ?? product.variants.nodes[0];
    if (!variant) return null;
    const purchase = normalisePurchase(product, variant, choice.purchase.kind, purchasePlanId(choice.purchase));
    const planId = purchasePlanId(purchase);
    const plans = allPlans(product);
    const line = linePurchase(purchase, variant);
    const allocation = line.kind === "subscription" ? allocationFor(variant, line.planId) : null;
    const price = allocation ? planPrice(variant, planId) ?? variant.price : variant.price;
    const compareAt = allocation?.priceAdjustments[0]?.compareAtPrice ?? variant.compareAtPrice;
    const sale = {
      line,
      subscriptionAvailable: plans.some((plan) => allocationFor(variant, plan.id)),
      compareAtPrice: compareAt && parseFloat(compareAt.amount) > parseFloat(price.amount) ? compareAt : null,
      savings: planSavings(variant, planId)
    };
    return {
      ...sale,
      variant,
      selected: exact ? choice.selected : selectionOf(variant),
      purchase,
      plan: plans.find((plan) => plan.id === planId) ?? null,
      quantity: choice.quantity,
      price,
      show: showConditions(variant, lowStock, product.variants.nodes.length, sale, product.requiresSellingPlan)
    };
  }
  function variantBindTexts(view, format) {
    const { variant, plan, price, compareAtPrice, quantity } = view;
    const planId = purchasePlanId(view.purchase);
    const forQuantity = (money) => timesQuantity(money, Math.max(1, quantity));
    const checkoutCharge = () => {
      const charge = view.line.kind === "subscription" ? planCheckoutCharge(variant, planId) ?? price : price;
      return format.money(forQuantity(charge));
    };
    const discountPercentage = () => {
      if (!compareAtPrice) return "0%";
      return `${Math.round((1 - parseFloat(price.amount) / parseFloat(compareAtPrice.amount)) * PERCENT2)}%`;
    };
    const discountAmount = () => {
      if (!compareAtPrice) return "";
      return format.money(fromMinorUnits(toMinorUnits(compareAtPrice) - toMinorUnits(price), price.currencyCode));
    };
    const texts = {
      price: () => format.money(price),
      "total-price": () => format.money(forQuantity(price)),
      "one-time-price": () => format.money(variant.price),
      "subscription-price": () => format.money(planId ? planPrice(variant, planId) : null),
      "subscription-savings": () => format.percent(view.savings.percentage),
      "subscription-savings-amount": () => format.money(view.savings.amount),
      "checkout-charge": checkoutCharge,
      "plan-name": () => plan?.name,
      "plan-description": () => plan?.description,
      "plan-group": () => plan?.group.name,
      "compare-at-price": () => format.money(compareAtPrice),
      "unit-price": () => format.money(variant.unitPrice),
      "discount-percentage": discountPercentage,
      "discount-amount": discountAmount,
      "variant-title": () => variant.title,
      "variant-id": () => variant.id,
      sku: () => variant.sku,
      barcode: () => variant.barcode,
      stock: () => variant.quantityAvailable,
      quantity: () => quantity
    };
    return new Map(Object.entries(texts));
  }
  function planBindTexts(variant, planId, plan, format) {
    const adjustmentText = () => {
      const adjustment = planAdjustment(plan);
      if (!adjustment) return "";
      return adjustment.type === "percentage" ? `${adjustment.value}%` : format.money(adjustment.value);
    };
    const texts = {
      name: () => plan?.name,
      // The option values alone ("1 month"), without the price text a store may put in the plan name.
      option: () => (plan?.options ?? []).map((option) => option.value).join(", "),
      description: () => plan?.description,
      price: () => format.money(planPrice(variant, planId)),
      savings: () => format.percent(planSavings(variant, planId).percentage),
      "savings-amount": () => format.money(planSavings(variant, planId).amount),
      adjustment: adjustmentText
    };
    return new Map(Object.entries(texts));
  }

  // src/uri.ts
  function decodeOrKeep(text2) {
    try {
      return decodeURIComponent(text2);
    } catch (error) {
      if (error instanceof URIError) return text2;
      throw error;
    }
  }

  // src/status.ts
  var URL_SOURCE = "url:";
  function resolveProductKey(el, location2 = window.location, name = "product") {
    const raw = (get(el, name) ?? "").trim();
    if (!raw.toLowerCase().startsWith(URL_SOURCE)) return { key: raw || null, fromUrl: false, raw };
    const source = raw.slice(URL_SOURCE.length).trim();
    let key;
    if (source.toLowerCase() === "path") {
      const segments = location2.pathname.split("/").filter(Boolean);
      const segment = segments[segments.length - 1];
      key = segment === void 0 ? null : decodeOrKeep(segment);
    } else {
      key = new URLSearchParams(location2.search).get(source || "handle");
    }
    return { key: key?.trim() || null, fromUrl: true, raw };
  }
  var STATUS_KEYS = ["loading", "ready", "error", "not-found"];
  var isScopeStatus = (value) => STATUS_KEYS.some((status2) => status2 === value);
  var codeOf = (error) => typeof error === "object" && error !== null && "code" in error ? error.code : void 0;
  var isNotFound = (error) => codeOf(error) === "NOT_FOUND";
  var boundary = () => ["product", "collection", "products", "recommendations"].map((name) => sel(name)).join(",");
  var ownedBy = (el, root) => el === root || el.parentElement?.closest(boundary()) === root;
  function errorCode(error) {
    const code = codeOf(error);
    return typeof code === "string" && code ? code : "error";
  }
  function setScopeStatus(root, status2, error) {
    const notFound = status2 === "not-found";
    const failed = status2 === "error" || notFound;
    root.setAttribute(attr("state"), notFound ? "error" : status2);
    if (failed) root.setAttribute(attr("error"), notFound ? "not-found" : errorCode(error));
    else root.removeAttribute(attr("error"));
    scoped(root, sel("show"), boundary()).forEach((el) => {
      const shows = get(el, "show");
      if (isScopeStatus(shows)) show(el, shows === status2);
    });
    if (!failed) return;
    scoped(root, sel("add-to-cart"), boundary()).forEach((button) => {
      button.classList.add("is-disabled");
      button.setAttribute("aria-disabled", "true");
      if ("disabled" in button) button.disabled = true;
    });
  }

  // src/variant-render.ts
  var FORMAT = { money: formatMoney2, percent: formatPercent };
  function addButtonLabel(button) {
    const label = qsa(button, sel("add-label"))[0] ?? button;
    const original = label.dataset["tetherLabel"] ?? (isInput(label) ? label.value : label.textContent);
    label.dataset["tetherLabel"] = original;
    return { label, original };
  }
  function renderOptionStates(scope, view) {
    const { product } = scope;
    const selectedValue = (authored) => view.selected[scope.optName(authored)] ?? "";
    scope.$(sel("option-selected")).forEach((el) => {
      setText(el, selectedValue(get(el, "option-selected")));
    });
    scope.$(sel("option-list")).forEach((container) => {
      const name = scope.optName(get(container, "option-list"));
      qsa(container, sel("option-value")).forEach((node) => {
        const value = get(node, "option-value") ?? "";
        setSelected(node, view.selected[name] === value);
        const unavailable = !isValueAvailable(product, view.selected, name, value);
        setUnavailable(node, unavailable, "picks-closest");
        node.setAttribute("data-unavailable", unavailable ? "true" : "false");
      });
    });
    selectsIn(scope, sel("option")).forEach((select) => {
      select.value = selectedValue(get(select, "option"));
    });
    selectsIn(scope, sel("variant-select")).forEach((select) => {
      select.value = view.variant.id;
    });
  }
  function renderPurchaseStates(scope, view) {
    const { variant, purchase, line } = view;
    scope.$(sel("purchase")).forEach((el) => {
      if (isSelect(el)) {
        el.value = purchase.kind;
        return;
      }
      const mode = get(el, "purchase");
      setSelected(el, mode === purchase.kind);
      setUnavailable(
        el,
        mode === "subscription" ? !view.subscriptionAvailable : scope.product.requiresSellingPlan,
        "does-nothing"
      );
    });
    scope.$(sel("plan-value")).forEach((node) => {
      const planId = get(node, "plan-value") ?? "";
      setSelected(node, line.kind === "subscription" && planId === line.planId);
      setUnavailable(node, !allocationFor(variant, planId), "does-nothing");
      const plan = scope.plans.find((candidate) => candidate.id === planId);
      const texts = planBindTexts(variant, planId, plan, FORMAT);
      qsa(node, sel("plan-bind")).forEach((el) => {
        const text2 = texts.get(get(el, "plan-bind") ?? "");
        if (text2) setText(el, text2());
      });
    });
    selectsIn(scope, sel("plan")).forEach((select) => {
      select.value = line.kind === "subscription" ? line.planId : "";
    });
  }
  function renderConditions2(scope, view) {
    const conditions = new Map(Object.entries(view.show));
    STATUS_KEYS.forEach((status2) => conditions.set(status2, status2 === "ready"));
    scope.$(sel("show")).forEach((el) => {
      const key = get(el, "show") ?? "";
      const visible = conditions.get(key);
      if (visible === void 0) return;
      if (STATUS_KEYS.some((status2) => status2 === key) && !ownedBy(el, scope.root)) return;
      show(el, visible);
    });
  }
  function renderAddButtons(scope, view) {
    const disabled = !view.variant.availableForSale;
    scope.$(sel("add-to-cart")).forEach((button) => {
      button.classList.toggle("is-disabled", disabled);
      button.setAttribute("aria-disabled", String(disabled));
      if ("disabled" in button) button.disabled = disabled;
      const soldOutText = get(button, "soldout-text");
      const subscribeText = get(button, "subscribe-text");
      if (!soldOutText && !subscribeText) return;
      const { label, original } = addButtonLabel(button);
      let text2 = original;
      if (view.line.kind === "subscription" && subscribeText) text2 = subscribeText;
      if (disabled && soldOutText) text2 = soldOutText;
      if (button.getAttribute("aria-busy") !== "true") setText(label, text2);
    });
  }
  function writeVariant(scope, view) {
    const { variant } = view;
    const { product } = scope;
    const texts = variantBindTexts(view, FORMAT);
    scope.$(sel("bind")).forEach((el) => {
      const key = get(el, "bind") ?? "";
      if (key === "variant-image") {
        setImage(el, variant.image?.url || product.featuredImage?.url, variant.image?.altText || product.title);
        return;
      }
      const text2 = texts.get(key);
      if (text2) setText(el, text2());
    });
    renderOptionStates(scope, view);
    renderPurchaseStates(scope, view);
    renderConditions2(scope, view);
    scope.root.classList.toggle("is-subscription", view.line.kind === "subscription");
    scope.root.setAttribute(attr("purchase-mode"), view.line.kind);
    renderAddButtons(scope, view);
  }

  // src/product-events.ts
  var productSelector = () => sel("product");
  function closestOwn(scope, target, selector) {
    const el = target.closest(selector);
    return el?.closest(productSelector()) === scope.root ? el : null;
  }
  function onAddClick(scope, button) {
    const { label, original } = addButtonLabel(button);
    const addingText = get(button, "adding-text");
    busy(button, async () => {
      if (addingText) setText(label, addingText);
      try {
        await scope.addToCart();
      } catch (error) {
        reportError(error, "add to cart failed");
        emit("error", { error, context: "add-to-cart" }, scope.root);
      } finally {
        if (addingText) setText(label, original);
      }
    }).then(() => {
      scope.renderVariant();
    }).catch((error) => {
      reportError(error, "add to cart render");
    });
  }
  function onClick(scope, event, target) {
    const optionValue = closestOwn(scope, target, sel("option-value"));
    const optionList = optionValue?.closest(sel("option-list"));
    if (optionValue && optionList) {
      event.preventDefault();
      scope.select(scope.optName(get(optionList, "option-list")), get(optionValue, "option-value") ?? "");
      return;
    }
    const plan = closestOwn(scope, target, sel("plan-value"));
    if (plan) {
      event.preventDefault();
      scope.selectPlan(get(plan, "plan-value"));
      return;
    }
    const purchase = closestOwn(scope, target, `${sel("purchase")}:not(select)`);
    if (purchase) {
      if (purchase.tagName !== "INPUT") event.preventDefault();
      scope.setPurchase(purchaseKind(get(purchase, "purchase")));
      return;
    }
    const plus = closestOwn(scope, target, sel("qty-plus"));
    const minus = plus ? null : closestOwn(scope, target, sel("qty-minus"));
    if (plus || minus) {
      event.preventDefault();
      scope.setQuantity(scope.quantity + (plus ? 1 : -1));
      return;
    }
    const add = closestOwn(scope, target, sel("add-to-cart"));
    if (add) {
      event.preventDefault();
      onAddClick(scope, add);
    }
  }
  function onKeydown(event, target) {
    const { key } = event;
    const presses = key === " " || key === "Enter" && !target.matches("a[href]");
    const pressable = `:is(${sel("option-value")},${sel("plan-value")},${sel("purchase")})[role=button]:not(button,input)`;
    if (!presses || event.defaultPrevented || !target.matches(pressable)) return;
    event.preventDefault();
    target.click();
  }
  var purchaseKind = (value) => value === "subscription" ? "subscription" : "one-time";
  function onChange(scope, target) {
    const value = isField(target) ? target.value : "";
    if (target.matches(`select${sel("option")}`)) {
      scope.select(scope.optName(get(target, "option")), value);
    } else if (target.matches(`select${sel("variant-select")}`)) {
      scope.selectVariant(value);
    } else if (target.matches(`select${sel("plan")}`)) {
      if (value) scope.selectPlan(value);
      else scope.setPurchase("one-time");
    } else if (target.matches(`select${sel("purchase")}`)) {
      scope.setPurchase(purchaseKind(value));
    } else if (target.matches(sel("qty"))) {
      scope.setQuantity(value);
    }
  }
  function bindProductEvents(scope) {
    scope.root.addEventListener("click", (event) => {
      if (isElement(event.target)) onClick(scope, event, event.target);
    });
    scope.root.addEventListener("keydown", (event) => {
      if (event.target instanceof window.HTMLElement) onKeydown(event, event.target);
    });
    scope.root.addEventListener("change", (event) => {
      const { target } = event;
      if (isElement(target) && target.closest(productSelector()) === scope.root) onChange(scope, target);
    });
  }

  // src/product.ts
  var scopes = /* @__PURE__ */ new WeakMap();
  var productSelector2 = () => sel("product");
  var knownOptionNames = /* @__PURE__ */ new Map();
  function rememberOptionNames(products) {
    products.forEach((product) => {
      if (!knownOptionNames.has(product.handle)) {
        knownOptionNames.set(
          product.handle,
          product.options.map((option) => option.name)
        );
      }
    });
  }
  function lineAttributeValue(el) {
    if (isInput(el) && el.type === "checkbox") {
      if (!el.checked) return null;
      return el.value && el.value !== "on" ? el.value : "Yes";
    }
    if (isInput(el) && el.type === "radio") return el.checked ? el.value : null;
    return isField(el) && el.value || null;
  }
  var ProductScope = class {
    constructor(root, product) {
      __publicField(this, "root");
      __publicField(this, "product");
      __publicField(this, "plans");
      __publicField(this, "selected");
      /** How the visitor buys; `setPurchase` and `selectPlan` change it. */
      __publicField(this, "purchase");
      __publicField(this, "variant");
      __publicField(this, "quantity");
      this.root = root;
      this.product = product;
      this.plans = allPlans(product);
      const params = new URLSearchParams(window.location.search);
      const choice = initialChoice(product, {
        variant: params.get("variant") || get(root, "variant"),
        sellingPlan: params.get("selling_plan"),
        defaultPlan: get(root, "default-plan"),
        defaultPurchase: get(root, "default-purchase") || cfg.defaultPurchase
      });
      this.selected = choice.selected;
      this.purchase = choice.purchase;
      this.variant = null;
      this.quantity = has(root, "quantity") ? Math.max(0, parseInt(get(root, "quantity") ?? "", 10) || 0) : 1;
      scopes.set(root, this);
      root.setAttribute(attr("state"), "ready");
      root.removeAttribute(attr("error"));
      this.renderProduct();
      bindProductEvents(this);
      this.renderVariant();
      watchImages(root, "product");
      notifyLayoutChanged("product");
      emit("product-ready", { product, scope: this }, root);
    }
    /** New data for the same product (a country switch). Keeps the visitor's choice. */
    update(product) {
      const variantId = this.variant?.id;
      this.product = product;
      this.plans = allPlans(product);
      const same = product.variants.nodes.find((variant) => variant.id === variantId);
      if (same) this.selected = selectionOf(same);
      this.root.setAttribute(attr("state"), "ready");
      this.root.removeAttribute(attr("error"));
      this.renderProduct();
      this.renderVariant();
      notifyLayoutChanged("product");
      emit("product-updated", { product, scope: this }, this.root);
    }
    /** @returns Matches in this scope, including the root itself (a card link with tether-bind="link"). */
    $(selector) {
      const inner = scoped(this.root, selector, productSelector2());
      return this.root.matches(selector) ? [this.root, ...inner] : inner;
    }
    /**
     * @param authored An option name in the markup.
     * @returns The product's option of that name, or at that position in the build's language.
     */
    optName(authored) {
      if (!authored) return "";
      const { options } = this.product;
      if (options.some((option) => option.name === authored)) return authored;
      const index = (knownOptionNames.get(this.product.handle) ?? []).indexOf(authored);
      return options[index]?.name ?? authored;
    }
    get plan() {
      const planId = purchasePlanId(this.purchase);
      return this.plans.find((plan) => plan.id === planId) ?? null;
    }
    /** True when the current variant can be bought on a plan. */
    get subscriptionAvailable() {
      return this.plans.some((plan) => allocationFor(this.variant, plan.id));
    }
    /** True when the line is bought on a plan: subscribing, and the variant is on the plan. */
    get isSubscription() {
      return linePurchase(this.purchase, this.variant).kind === "subscription";
    }
    /** @returns What would be added to the cart right now. */
    getLine() {
      if (!this.variant) return null;
      const line = { merchandiseId: this.variant.id, quantity: this.quantity };
      const bought = linePurchase(this.purchase, this.variant);
      if (bought.kind === "subscription") line.sellingPlanId = bought.planId;
      const attributes = this.collectAttributes();
      if (attributes.length) line.attributes = attributes;
      return line;
    }
    /** @returns `tether-line-attributes` and the filled `tether-line-attribute` fields. */
    collectAttributes() {
      const fixed = attributesFromJson(parseJSONAttr(this.root, "line-attributes"));
      const fields = this.$(sel("line-attribute")).flatMap((el) => {
        const value = lineAttributeValue(el);
        return value === null ? [] : [{ key: get(el, "line-attribute") ?? "", value }];
      });
      return [...fixed, ...fields];
    }
    /**
     * Selects an option value. A combination no variant has moves to the closest variant with the value: the most other
     * choices kept, then one for sale.
     */
    select(name, value) {
      if (this.selected[name] === value) return;
      const withValue = this.product.variants.nodes.filter(
        (variant) => variant.selectedOptions.some((option) => option.name === name && option.value === value)
      );
      const [firstWithValue] = withValue;
      if (!firstWithValue) return;
      const next = { ...this.selected, [name]: value };
      if (!withValue.some((variant) => variant.selectedOptions.every((option) => next[option.name] === option.value))) {
        const score = (variant) => {
          const kept = variant.selectedOptions.filter(
            (option) => option.name !== name && this.selected[option.name] === option.value
          ).length;
          return kept * 2 + (variant.availableForSale ? 1 : 0);
        };
        const closest = withValue.reduce(
          (best, variant) => score(variant) > score(best) ? variant : best,
          firstWithValue
        );
        Object.assign(next, selectionOf(closest));
      }
      this.selected = next;
      this.renderVariant();
    }
    /** @param id A variant gid or numeric id. */
    selectVariant(id) {
      const variant = this.product.variants.nodes.find((candidate) => candidate.id === GID.variant(id));
      if (!variant) return;
      this.selected = selectionOf(variant);
      this.renderVariant();
    }
    setPurchase(kind) {
      const next = normalisePurchase(this.product, this.variant, kind, purchasePlanId(this.purchase));
      if (next.kind === this.purchase.kind) return;
      this.purchase = next;
      this.renderVariant();
    }
    /** @param ref A plan id, numeric id, name or option value. */
    selectPlan(ref) {
      const plan = findPlan(this.product, ref);
      if (!plan) return;
      this.purchase = { kind: "subscription", planId: plan.id };
      this.renderVariant();
    }
    setQuantity(quantity) {
      const minimum = has(this.root, "quantity") ? 0 : 1;
      this.quantity = Math.max(minimum, parseInt(String(quantity), 10) || 0);
      this.$(sel("qty")).forEach((el) => {
        setText(el, this.quantity);
      });
      this.renderVariant();
    }
    /** @returns The cart after adding; `null` when the variant can't be added. */
    async addToCart() {
      if (!this.variant?.availableForSale) return null;
      const line = this.getLine();
      if (!line || line.quantity < 1) return null;
      const added = { product: this.product, variant: this.variant, line };
      const cart = await Cart.add(line);
      emit("product-added", added, this.root);
      return cart;
    }
    /** Learns the markup's option names when they are the product's, then writes the product. */
    renderProduct() {
      const { product } = this;
      if (!knownOptionNames.has(product.handle)) {
        const authored = this.$(`${sel("option-list")},select${sel("option")}`).map(
          (el) => get(el, "option-list") || get(el, "option")
        );
        if (authored.some((name) => product.options.some((option) => option.name === name))) {
          rememberOptionNames([product]);
        }
      }
      writeProduct(this);
    }
    /** Derives the view of the current choice, keeps its variant, selection and purchase, and writes it. */
    renderVariant() {
      const view = productView(
        this.product,
        { selected: this.selected, purchase: this.purchase, quantity: this.quantity },
        cfg.lowStock
      );
      if (!view) {
        this.variant = null;
        return;
      }
      this.variant = view.variant;
      this.selected = view.selected;
      this.purchase = view.purchase;
      writeVariant(this, view);
      emit(
        "variant-changed",
        {
          product: this.product,
          variant: view.variant,
          selected: { ...view.selected },
          purchase: view.purchase.kind,
          sellingPlanId: view.line.kind === "subscription" ? view.line.planId : null
        },
        this.root
      );
    }
  };

  // src/mounting.ts
  var HYDRATE_SELECTOR = 'script[type="application/json"][data-tether-hydrate]';
  var mountedProducts = /* @__PURE__ */ new WeakSet();
  var mountedLists = /* @__PURE__ */ new WeakSet();
  var liveProducts = /* @__PURE__ */ new Set();
  var liveLists = /* @__PURE__ */ new Set();
  var latestRequest = /* @__PURE__ */ new WeakMap();
  function pruneLive() {
    liveProducts.forEach((el) => {
      if (!el.isConnected) liveProducts.delete(el);
    });
    liveLists.forEach((list) => {
      if (!list.root.isConnected) liveLists.delete(list);
    });
  }
  function within(root, selector) {
    const self = root.matches?.(selector) ? [root] : [];
    return [...self, ...qsa(root, selector)];
  }
  function applyPageTitle(el, product) {
    const template = get(el, "page-title");
    if (!template || typeof document === "undefined") return;
    const fields = /* @__PURE__ */ new Map([
      ["title", product.title],
      ["vendor", product.vendor || ""],
      ["type", product.productType || ""]
    ]);
    document.title = template.replace(/\{(\w+)\}/g, (placeholder, name) => fields.get(name) ?? placeholder);
  }
  function mountWithoutKey(el, { fromUrl, raw }) {
    if (fromUrl) {
      mountedProducts.add(el);
      setScopeStatus(el, "not-found");
      emit("product-not-found", { key: null, source: raw }, el);
    } else if (!el.closest(listSelector())) {
      warn(`[${attr("product")}] without a value. Bind it to the Shopify handle field, or use "url:handle".`, el);
    }
  }
  function showLoadFailure(el, key, { fromUrl, raw }, error) {
    const notFound = isNotFound(error);
    setScopeStatus(el, notFound ? "not-found" : "error", error);
    if (!notFound) {
      reportError(error, `product ${key}`);
      emit("error", { error, context: "product", key }, el);
      return;
    }
    emit("product-not-found", { key, source: raw }, el);
    if (fromUrl) log(`product not found: ${key}`);
    else reportError(error, `product ${key}`);
  }
  function mountProduct(el) {
    if (mountedProducts.has(el)) return false;
    const { key, ...source } = resolveProductKey(el);
    if (!key) {
      mountWithoutKey(el, source);
      return false;
    }
    mountedProducts.add(el);
    liveProducts.add(el);
    const request2 = {};
    latestRequest.set(el, request2);
    const isLatest = () => latestRequest.get(el) === request2;
    if (scopes.get(el)) el.setAttribute(attr("state"), "updating");
    else setScopeStatus(el, "loading");
    const loading = trackMarket(getProduct(key));
    loading.then((product) => {
      if (!isLatest()) return;
      const existing = scopes.get(el);
      if (existing) existing.update(product);
      else new ProductScope(el, product);
      applyPageTitle(el, product);
      if (cfg.revalidate && takeStale(key)) queueRefresh(key);
    }).catch((error) => {
      if (isLatest()) showLoadFailure(el, key, source, error);
    });
    return true;
  }
  function retryFailed() {
    pruneLive();
    liveProducts.forEach((el) => {
      if (el.getAttribute(attr("state")) !== "error" || el.getAttribute(attr("error")) === "not-found") return;
      mountedProducts.delete(el);
      mountProduct(el);
    });
  }
  var refreshQueue = /* @__PURE__ */ new Set();
  function queueRefresh(key) {
    if (!refreshQueue.size) setTimeout(flushRefresh, 0);
    refreshQueue.add(key);
  }
  function applyRefresh(key, fresh) {
    liveProducts.forEach((el) => {
      const scope = scopes.get(el);
      if (!scope || !el.isConnected) return;
      const rootKey = resolveProductKey(el).key;
      if (rootKey !== key && rootKey !== fresh.handle && rootKey !== fresh.id) return;
      if (JSON.stringify(scope.product) !== JSON.stringify(fresh)) scope.update(fresh);
    });
  }
  function flushRefresh() {
    const keys = [...refreshQueue];
    refreshQueue = /* @__PURE__ */ new Set();
    keys.forEach((key) => {
      refreshProduct(key).then((fresh) => {
        applyRefresh(key, fresh);
      }).catch((error) => {
        reportError(error, `refresh ${key}`);
      });
    });
  }
  var marketPending = null;
  var trackMarket = (loading) => {
    marketPending?.add(loading);
    return loading;
  };
  function settleMarket() {
    if (!marketPending) return;
    const waits = [...marketPending];
    void Promise.allSettled(waits).then(() => {
      if (!marketPending || waits.some((wait) => !marketPending?.has(wait))) return;
      if (waits.length !== marketPending.size) {
        settleMarket();
        return;
      }
      marketPending = null;
      document.documentElement.classList.remove(`${cfg.prefix}-market-pending`);
    });
  }
  function toHydratePayload(json) {
    if (!isRecord(json)) return { country: void 0, language: void 0, products: [] };
    const { products } = json;
    const entries = Array.isArray(products) ? products : [];
    return {
      country: toCountry(json["country"]) ?? void 0,
      language: toLanguage(json["language"]) ?? void 0,
      products: entries.filter(isProductShape)
    };
  }
  var readScripts = /* @__PURE__ */ new WeakSet();
  function hydrateFromPage(root = document) {
    within(root, HYDRATE_SELECTOR).forEach((script) => {
      if (readScripts.has(script)) return;
      readScripts.add(script);
      let json;
      try {
        json = JSON.parse(script.textContent);
      } catch (error) {
        warn("bad data-tether-hydrate", error);
        return;
      }
      const { country, language, products } = toHydratePayload(json);
      rememberOptionNames(products);
      if (country === cfg.country && language === cfg.language) {
        hydrateProducts(products);
        return;
      }
      log("hydration skipped: other market");
      if (!marketPending) {
        marketPending = /* @__PURE__ */ new Set();
        document.documentElement.classList.add(`${cfg.prefix}-market-pending`);
      }
    });
  }

  // src/markets.ts
  var storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;
  var pageStorage = { getItem: (key) => getStored(key) };
  function parseJsonOrNull(text2) {
    try {
      return JSON.parse(text2);
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
  var parseSavedMarket = (text2) => toMarket(parseJsonOrNull(text2));
  function readSavedMarket(storage = pageStorage) {
    const text2 = storage.getItem(storageKey());
    return text2 ? parseSavedMarket(text2) : null;
  }

  // src/page-market.ts
  var configuredMarket = { country: void 0, language: void 0, locale: void 0 };
  var lastPageHadOwnMarket = false;
  function pageMarket() {
    const meta2 = (name) => document.querySelector(`meta[name="${cfg.prefix}-page-${name}"]`)?.getAttribute("content") || void 0;
    const country = toCountry(meta2("country"));
    if (!country) return null;
    return { country, language: toLanguage(meta2("language")) ?? void 0, locale: meta2("locale") };
  }
  async function visitorMarket() {
    const markets = cfg.markets ?? {};
    if (markets.detect === false) return null;
    if (!markets.detect) return markets.remember === false ? null : readSavedMarket();
    try {
      return (await loadPart("markets")).detectMarket(markets);
    } catch (error) {
      reportError(error, "markets");
      return null;
    }
  }
  async function applyStartMarket(overrides) {
    configuredMarket = { country: cfg.country, language: cfg.language, locale: cfg.locale };
    const page = pageMarket();
    lastPageHadOwnMarket = page !== null;
    if (page) {
      cfg.country = page.country;
      cfg.language = page.language;
      if (page.locale) cfg.locale = page.locale;
      return;
    }
    const market = await visitorMarket();
    if (!market) return;
    if (market.country) cfg.country = market.country;
    if (market.language) cfg.language = market.language;
    if (market.locale && !overrides.locale) cfg.locale = market.locale;
    log("market", market);
  }
  var sameCode = (a, b) => (a ?? "").toUpperCase() === (b ?? "").toUpperCase();
  function marketForArrival() {
    const page = pageMarket();
    const leftOwnMarket = page === null && lastPageHadOwnMarket;
    lastPageHadOwnMarket = page !== null;
    const target = page ?? (leftOwnMarket ? readSavedMarket() ?? configuredMarket : null);
    if (!target?.country) return null;
    if (sameCode(target.country, cfg.country) && sameCode(target.language, cfg.language)) return null;
    return { country: target.country, language: target.language, locale: target.locale };
  }
  function setCountry(code, options) {
    return loadPart("markets").then((part) => part.setCountry(code, options));
  }

  // src/part-integrity.ts
  var PART_INTEGRITY = { "tether.diagnose.js": "sha384-yYZpcrRmwYqG6dTXD5m7YKPlcVuL3RPHCuaDzLnfJvdmmxH9Fe3ip1ADcX1WK70B", "tether.markets.js": "sha384-S7JkU2e6i2yPAj5AGjSTwC8yU9XbNWu6j+fE1J/Iz1YTY6KfjjLRgPysvkMVG7EY", "tether.search.js": "sha384-p2jiGj4lAuskufTrc4Fj5ZOLolIaev7WjGiP4GfJhSB76ctBq8a59nITuhULeaN4", "tether.lists.js": "sha384-LCYUAkLThJgVcSTYhECqeWmjiDhbVdIn5/miFjgHALLW/+JlUktQzVPfP1GybH2j", "tether.extras.js": "sha384-uJkQJolGR0au//Prn6yB574rHFC1QAWLWA636jHV91PKIi7JuFWNyh/xzXfry+BW", "tether.account.js": "sha384-yjq622iQCNxGNYVIeZLVIvpCma5OaJ0fXxO7bcQblpRN00yqNDrEdOr4CyHs1UYP", "tether.account-pages.js": "sha384-N9fVpwkQLuIJ7HWLatw5XHjvfwbih4syjvKrG0ZPJQBeUhbi4Kiipp513OgYrdaX", "tether.analytics.js": "sha384-IHf1OHNKpDytCTEPTgtkrL3te+eGnaL2Es6OX7Sim1n42ujJPih37Wb2sCk1lYRH" };

  // src/part-registry.ts
  function isTetherInternals(value) {
    return isRecord(value) && isRecord(value["__core"]) && isRecord(value["__parts"]);
  }

  // src/version.ts
  var VERSION = "0.10.1";

  // src/lazy-iife.ts
  var coreModules = {
    get "config.ts"() {
      return [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn];
    },
    get "client.ts"() {
      return [endpoint, gql, matches, orNull, shaped, TetherError, withTimeout];
    },
    get "dom.ts"() {
      return [
        ANALYTICS_EVENTS,
        attr,
        attributesFromJson,
        busy,
        emit,
        formatDate,
        formatMoney2,
        get,
        has,
        hasTemplate,
        integerAttribute,
        isElement,
        isOwnEvent,
        notifyLayoutChanged,
        parseJSONAttr,
        productUrl2,
        qsa,
        repeat,
        scoped,
        sel,
        setImage,
        setStoreHtml,
        setText,
        show
      ];
    },
    get "loader.ts"() {
      return [clearProductCache, getProduct, normalizeProductKey, primeProduct, withProductFragment];
    },
    get "selling-plans.ts"() {
      return [allPlans];
    },
    get "status.ts"() {
      return [boundary, isNotFound, resolveProductKey, setScopeStatus];
    },
    get "cart.ts"() {
      return [Cart];
    },
    get "product.ts"() {
      return [scopes];
    },
    get "collection.ts"() {
      return [listSelector];
    },
    get "mounting.ts"() {
      return [liveLists, liveProducts, mountedProducts, mountProduct, pruneLive, within];
    },
    get "market-codes.ts"() {
      return [toCountry, toLanguage];
    },
    get "page-market.ts"() {
      return [setCountry];
    },
    get "shopify-values.ts"() {
      return [isHttpsUrl, MAX_CONNECTION_SIZE];
    },
    // Parts that load other parts (account → account-pages) use this same loader.
    get "lazy.ts"() {
      return [loadPart];
    }
  };
  var MINIFIED_SCRIPT = /\.min\.js(\?|$)/;
  var coreScript = typeof document === "undefined" ? "" : document.currentScript?.getAttribute("src") ?? "";
  var coreScriptUrl = coreScript ? new URL(coreScript, document.baseURI).href : "";
  var JSDELIVR_ALIAS = /^(https:\/\/cdn\.jsdelivr\.net\/(gh|npm)\/@?[^/@]+\/[^/@]+)(@(latest|\d+(\.\d+)?))?\//;
  function exactReleaseFolder(folder) {
    return folder.replace(
      JSDELIVR_ALIAS,
      (_alias, path, source) => `${path}@${source === "gh" ? "v" : ""}${VERSION}/`
    );
  }
  var parts = /* @__PURE__ */ new Map();
  function partsFolder() {
    if (cfg.partsUrl) return new URL(cfg.partsUrl, document.baseURI).href;
    if (!coreScriptUrl) return null;
    return exactReleaseFolder(coreScriptUrl.replace(/[^/]*$/, ""));
  }
  function applyIntegrity(script, integrity) {
    script.integrity = integrity;
    if (new URL(script.src).origin !== window.location.origin) script.crossOrigin = "anonymous";
  }
  function loadScript(name, folder, file, integrity) {
    return new Promise((resolve, reject) => {
      const url2 = `${folder.replace(/\/?$/, "/")}${file}`;
      const script = document.createElement("script");
      script.src = url2;
      script.async = true;
      applyIntegrity(script, integrity);
      script.onload = () => {
        const tether = Reflect.get(window, "Tether");
        const part = isTetherInternals(tether) ? tether.__parts[name] : void 0;
        if (part) {
          resolve(part);
          return;
        }
        parts.delete(name);
        const problem = isTetherInternals(tether) ? "did not register" : "can't register: window.Tether is no longer this Tether script's, another script replaced it";
        reject(new Error(`${url2} ${problem}`));
      };
      script.onerror = () => {
        parts.delete(name);
        reject(
          new Error(
            `Could not load ${url2}, or it is not the file built with this Tether script. Host the same release's files next to the Tether script or at partsUrl.`
          )
        );
      };
      document.head.appendChild(script);
    });
  }
  function loadPart(name) {
    let loading = parts.get(name);
    if (!loading) {
      const folder = partsFolder();
      if (folder === null) {
        return Promise.reject(
          new Error(`The Tether script's own location is unknown, so its ${name} part can't be found: set partsUrl.`)
        );
      }
      const suffix = MINIFIED_SCRIPT.test(coreScriptUrl) || !coreScriptUrl ? ".min" : "";
      const file = `tether.${name}${suffix}.js`;
      const integrity = PART_INTEGRITY[file];
      if (integrity === void 0) {
        return Promise.reject(new Error(`This Tether script was built without ${file}, so it can't load that part.`));
      }
      loading = loadScript(name, folder, file, integrity);
      parts.set(name, loading);
    }
    return loading;
  }

  // src/collection.ts
  var listSelector = () => `${sel("collection")},${sel("products")},${sel("recommendations")}`;
  function mountedList(root) {
    setScopeStatus(root, "loading");
    return {
      root,
      load: () => loadPart("lists").then((part) => part.loadList(root)).catch((error) => {
        setScopeStatus(root, "error", error);
        reportError(error, "lists");
      })
    };
  }

  // src/analytics-queue.ts
  function queueAnalyticsEvents(load2) {
    const queue = [];
    const listening = new window.AbortController();
    const options = { signal: listening.signal };
    ANALYTICS_EVENTS.forEach((name) => {
      document.addEventListener(`${cfg.prefix}:${name}`, (event) => queue.push(event), options);
    });
    document.addEventListener("astro:page-load", (event) => queue.push(event), options);
    load2().then((part) => part.startAnalytics(queue)).catch((error) => {
      listening.abort();
      queue.length = 0;
      reportError(error, "analytics");
    });
    return queue;
  }

  // src/account-marks.ts
  var hintKey = () => `${cfg.prefix}:account-hint:${cfg.domain}`;
  function removeFromBothAreas(key) {
    removeStored(key, "sessionStorage");
    removeStored(key, "localStorage");
  }
  function forgetBrowserModeTokens() {
    removeFromBothAreas(`${cfg.prefix}:account:${cfg.domain}`);
    removeFromBothAreas(`${cfg.prefix}:account-login:${cfg.domain}`);
  }
  var isLoginOutcome = (value) => value === "in" || value === "expired" || value === "error";

  // src/part-use.ts
  function withPart(name, use) {
    loadPart(name).then(use).catch((error) => {
      reportError(error, name);
    });
  }

  // src/account-api.ts
  var ACCOUNT_ATTRIBUTES = [
    "account-login",
    "account-bind",
    "account-link",
    "orders",
    "order",
    "addresses",
    "subscriptions",
    "profile-form",
    "address-form"
  ];
  var accountSelector = () => [...ACCOUNT_ATTRIBUTES.map((name) => `[${attr(name)}]`), `[${attr("show")}^="logged-"]`].join(",");
  function hasLoginHint() {
    return Boolean(getStored(hintKey()));
  }
  function mountAccountIfUsed(root) {
    if (!cfg.account) return;
    const needed = within(root, accountSelector()).length > 0 || isLoginOutcome(new URLSearchParams(window.location.search).get("account")) || hasLoginHint();
    if (!needed) return;
    withPart("account", (part) => part.mountAccount(root));
  }
  function fromPart(name) {
    return (...args) => loadPart("account").then((part) => {
      const call = part[name];
      return call(...args);
    });
  }
  var accountApi = {
    login: fromPart("login"),
    logout: fromPart("logout"),
    isLoggedIn: fromPart("isLoggedIn"),
    customer: fromPart("customer"),
    orders: fromPart("orders"),
    order: fromPart("order"),
    updateProfile: fromPart("updateProfile"),
    addresses: fromPart("addresses"),
    saveAddress: fromPart("saveAddress"),
    deleteAddress: fromPart("deleteAddress"),
    subscriptions: fromPart("subscriptions"),
    subscriptionAction: fromPart("subscriptionAction"),
    requestReturn: fromPart("requestReturn"),
    render: fromPart("render"),
    mountAccount: fromPart("mountAccount")
  };

  // src/controls/cart-controls.ts
  var lineKeyAttribute = () => `data-${cfg.prefix}-key`;
  function lineOf(target) {
    const line = target.closest(`[${lineKeyAttribute()}]`);
    const id = line?.getAttribute(lineKeyAttribute());
    return line && id ? { line, id } : null;
  }
  function reportFailure(change, context) {
    change.catch((error) => {
      reportError(error, context);
    });
  }
  function onLineClick(event, target) {
    const found = lineOf(target);
    if (!found?.line.closest(sel("cart-lines"))) return;
    const { line, id } = found;
    if (target.closest(sel("line-remove"))) {
      event.preventDefault();
      line.classList.add("is-busy");
      reportFailure(Cart.removeLine(id), "cart line");
      return;
    }
    const delta = lineDelta(target);
    if (!delta || !Cart.lines.some((candidate) => candidate.id === id)) return;
    event.preventDefault();
    reportFailure(Cart.changeQuantity(id, delta), "cart line");
  }
  function lineDelta(target) {
    if (target.closest(sel("line-plus"))) return 1;
    if (target.closest(sel("line-minus"))) return -1;
    return 0;
  }
  function onClick2(event) {
    const { target } = event;
    if (!isElement(target)) return;
    if (target.closest(sel("cart-open"))) {
      event.preventDefault();
      Cart.toggle();
      return;
    }
    if (target.closest(sel("cart-close"))) {
      event.preventDefault();
      Cart.close();
      return;
    }
    const clear = target.closest(sel("cart-clear"));
    if (clear) {
      event.preventDefault();
      void busy(
        clear,
        () => Cart.clear().catch((error) => {
          reportError(error, "cart clear");
        })
      );
      return;
    }
    const checkout2 = target.closest(sel("checkout"));
    if (checkout2) {
      event.preventDefault();
      void busy(checkout2, () => Cart.checkout());
      return;
    }
    onLineClick(event, target);
  }
  function showLineBusy(line, change, context) {
    line.classList.add("is-busy");
    line.setAttribute("aria-busy", "true");
    reportFailure(change, context);
  }
  function onQuantityInput(input, { line, id }) {
    const typed = input.value.trim();
    if (INTEGER_TEXT.test(typed)) {
      showLineBusy(line, Cart.updateLine(id, Number(typed)), "cart line");
      return;
    }
    const current = Cart.lines.find((candidate) => candidate.id === id);
    if (current) input.value = String(Cart.quantityOf(current));
  }
  function onChange2(event) {
    const { target } = event;
    if (!isElement(target)) return;
    const found = lineOf(target);
    if (found && target instanceof window.HTMLInputElement && target.matches(sel("line", "quantity"))) {
      onQuantityInput(target, found);
    } else if (found && target instanceof window.HTMLSelectElement && target.matches(sel("line-plan"))) {
      showLineBusy(found.line, Cart.updateLine(found.id, { sellingPlanId: target.value || null }), "cart line plan");
    } else if (hasValue(target) && target.matches(sel("cart-note"))) {
      reportFailure(Cart.setNote(target.value), "cart note");
    }
  }
  var hasValue = (target) => target instanceof window.HTMLInputElement || target instanceof window.HTMLTextAreaElement || target instanceof window.HTMLSelectElement;
  function onKeydown2(event) {
    if (!Cart.isOpen()) return;
    if (event.key === "Escape") {
      Cart.close();
      return;
    }
    trapFocus(event);
  }
  function bindCartControls() {
    document.addEventListener("click", onClick2);
    document.addEventListener("change", onChange2);
    document.addEventListener("keydown", onKeydown2);
  }

  // src/controls/discount.ts
  function codeInputOf(form) {
    const input = form.querySelector(sel("discount-input")) ?? form.querySelector("input");
    return input instanceof window.HTMLInputElement ? input : null;
  }
  function onSubmit(event) {
    const { target } = event;
    const form = isElement(target) ? target.closest(sel("discount-form")) : null;
    if (!form) return;
    event.preventDefault();
    const input = codeInputOf(form);
    const code = input?.value.trim();
    if (!code) return;
    busy(form, () => loadPart("extras").then((part) => part.applyDiscountCode(form, input, code))).catch(
      (error) => {
        reportError(error, "discount");
      }
    );
  }
  function onInput(event) {
    const { target } = event;
    if (!isElement(target)) return;
    const form = target.closest(sel("discount-form"));
    if (!form) return;
    form.classList.remove("is-invalid");
    target.removeAttribute("aria-invalid");
  }
  function onClick3(event) {
    const { target } = event;
    const remove = isElement(target) ? target.closest(sel("discount-remove")) : null;
    if (!remove) return;
    event.preventDefault();
    const code = remove.closest(sel("discount-code"))?.getAttribute(attr("discount-code"));
    if (!code) return;
    Cart.removeDiscount(code).catch((error) => {
      reportError(error, "discount");
    });
  }
  function bindDiscountControls() {
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("input", onInput);
    document.addEventListener("click", onClick3);
  }

  // src/controls/extras.ts
  var addGroup = (button) => loadPart("extras").then((part) => part.addGroup(button));
  function onClick4(event) {
    const { target } = event;
    const button = target instanceof window.Element ? target.closest(sel("group-add")) : null;
    if (!button) return;
    event.preventDefault();
    busy(button, () => addGroup(button)).catch((error) => {
      reportError(error, "extras");
    });
  }
  function onStorage(event) {
    if (!cfg.domain || !event.key?.startsWith(`${cfg.prefix}:`)) return;
    withPart("extras", (part) => {
      part.onStorage(event);
    });
  }
  function onVariantChanged(event) {
    if (!isOwnEvent(event, "variant-changed")) return;
    const { target } = event;
    if (!(target instanceof window.Element)) return;
    if (!cfg.variantUrl && !target.hasAttribute(attr("variant-url"))) return;
    withPart("extras", (part) => {
      part.writeVariantUrl(target, event.detail);
    });
  }
  function bindExtrasControls() {
    document.addEventListener("click", onClick4);
    window.addEventListener("storage", onStorage);
    document.addEventListener(`${cfg.prefix}:variant-changed`, onVariantChanged);
  }

  // src/controls/navigation.ts
  var mountedBody = null;
  function rememberDocumentMount() {
    mountedBody = document.body;
  }
  async function onPageLoad(hooks) {
    await hooks.ready();
    const target = marketForArrival();
    if (!target) {
      if (mountedBody !== document.body) hooks.mount(document);
      return;
    }
    try {
      await setCountry(target.country, { language: target.language ?? null, locale: target.locale, remember: false });
    } catch (error) {
      reportError(error, "country");
    }
    hooks.mount(document);
  }
  function bindAstroRouter(hooks) {
    document.addEventListener("astro:page-load", () => {
      onPageLoad(hooks).catch((error) => {
        reportError(error, "page mount");
      });
    });
    document.addEventListener("astro:before-swap", () => {
      mountedBody = null;
      hooks.unmount();
    });
  }
  function onOnline() {
    retryFailed();
    liveLists.forEach((list) => {
      if (list.root.getAttribute(attr("state")) === "error") void list.load();
    });
  }
  function bindNavigation(hooks) {
    if (cfg.astro) bindAstroRouter(hooks);
    window.addEventListener("online", onOnline);
  }

  // src/index.ts
  var OBSERVE_DEBOUNCE_MS = 50;
  function pageConfig() {
    const config = pageGlobal("TETHER_CONFIG");
    return typeof config === "object" && config !== null ? Object.fromEntries(Object.entries(config)) : {};
  }
  var initPromise = null;
  var observer = null;
  var analyticsQueue = null;
  var controlsBound = false;
  function mountLists(root) {
    let count = 0;
    within(root, listSelector()).forEach((el) => {
      if (mountedLists.has(el)) return;
      mountedLists.add(el);
      count++;
      const list = mountedList(el);
      liveLists.add(list);
      el.addEventListener(`${cfg.prefix}:list-rendered`, (event) => {
        if (isOwnEvent(event, "list-rendered")) mount(event.detail.container);
      });
      void trackMarket(list.load());
    });
    return count;
  }
  function mountParts(root) {
    if (within(root, `${sel("country-select")},${sel("country-bind")}`).length) {
      withPart("markets", (part) => part.renderCountrySelects(root));
    }
    mountAccountIfUsed(root);
    if (within(root, sel("search")).length) {
      withPart("search", (part) => {
        part.mountSearch(root);
      });
    }
  }
  function mountWithin(root) {
    let count = mountLists(root);
    within(root, sel("product")).forEach((el) => {
      if (mountProduct(el)) count++;
    });
    mountParts(root);
    return count;
  }
  function mount(root = document) {
    if (!isConfigured()) return 0;
    if (root === document) rememberDocumentMount();
    pruneLive();
    hydrateFromPage(root.ownerDocument ?? document);
    const count = mountWithin(root);
    settleMarket();
    Cart.render();
    log(`mounted ${count} scope(s)`, root);
    return count;
  }
  function mountAdded(added) {
    const roots = added.filter(
      (root) => root.isConnected && !added.some((other) => other !== root && other.contains(root))
    );
    if (!roots.length || !isConfigured()) return;
    pruneLive();
    roots.forEach((root) => {
      hydrateFromPage(root);
    });
    const count = roots.reduce((sum, root) => sum + mountWithin(root), 0);
    settleMarket();
    Cart.render();
    log(`mounted ${count} scope(s) in ${roots.length} added element(s)`);
  }
  function unmount() {
    Cart.close();
  }
  function getScope(el) {
    const root = el?.closest(sel("product"));
    return root ? scopes.get(root) ?? null : null;
  }
  function bindControls() {
    if (controlsBound) return;
    controlsBound = true;
    bindCartControls();
    bindDiscountControls();
    bindExtrasControls();
    bindNavigation({ ready: () => initPromise ?? Promise.resolve(null), mount, unmount });
  }
  async function cartInPageMarket(cart) {
    const country = cfg.country;
    const cartCountry = cart?.buyerIdentity.countryCode;
    if (!country || !cartCountry || cartCountry === country) return cart;
    try {
      return await Cart.setBuyerIdentity({ countryCode: country }, { create: false });
    } catch (error) {
      reportError(error, "cart country");
      return cart;
    }
  }
  function init(overrides = {}) {
    if (initPromise && !Object.keys(overrides).length) return initPromise;
    configure({ ...pageConfig(), ...overrides });
    if (!isConfigured()) {
      warn("TETHER_CONFIG is missing domain or token. Tether is idle.");
      initPromise = Promise.resolve(null);
      return initPromise;
    }
    forgetBrowserModeTokens();
    bindControls();
    if (cfg.observe) startObserver();
    if (cfg.analytics) analyticsQueue ?? (analyticsQueue = queueAnalyticsEvents(() => loadPart("analytics")));
    initPromise = applyStartMarket(overrides).then(() => Cart.init()).then(cartInPageMarket).then((cart) => {
      emit("ready", { cart });
      return api;
    });
    return initPromise;
  }
  function startObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    let timer;
    const queued2 = /* @__PURE__ */ new Set();
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof window.Element) queued2.add(node);
        });
      });
      clearTimeout(timer);
      timer = setTimeout(() => {
        const added = [...queued2];
        queued2.clear();
        mountAdded(added);
      }, OBSERVE_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  var detectMarket = (markets) => loadPart("markets").then((part) => part.detectMarket(markets ?? cfg.markets));
  var getProducts = (query2) => loadPart("lists").then((part) => part.getProducts(query2));
  var getRecommendations = (product, intent) => loadPart("lists").then((part) => part.getRecommendations(product, intent));
  var getLocalization = () => loadPart("markets").then((part) => part.getLocalization());
  var diagnose = (options) => loadPart("diagnose").then((part) => part.diagnose({ ...options, version: VERSION }));
  function on(name, listener) {
    const type = `${cfg.prefix}:${name}`;
    const handler = (event) => {
      if (isOwnEvent(event, name)) listener(event.detail, event);
    };
    document.addEventListener(type, handler);
    return () => {
      document.removeEventListener(type, handler);
    };
  }
  var publicApi = {
    VERSION,
    init,
    mount,
    unmount,
    /** The live config, read-only. */
    get config() {
      return configView;
    },
    get ready() {
      return initPromise ?? Promise.resolve(null);
    },
    query,
    withContext,
    cart: Cart,
    getProduct,
    getProducts,
    getRecommendations,
    getScope,
    addGroup,
    account: accountApi,
    primeProduct,
    normalizeProductKey,
    clearProductCache,
    formatMoney: formatMoney2,
    imageUrl,
    plans: selling_plans_exports,
    TetherError,
    resolveProductKey,
    setCountry,
    detectMarket,
    getLocalization,
    diagnose,
    on
  };
  var internals = { __core: coreModules, __parts: {} };
  var api = Object.assign(publicApi, internals);
  var index_default = api;
  function autoStart() {
    Reflect.set(window, "Tether", api);
    const config = pageGlobal("TETHER_CONFIG");
    if (!config || field(config, "autoMount") === false || pageGlobal("TETHER_INTEGRATION")) return;
    const start = () => {
      init().then(() => mount(document)).catch((error) => {
        reportError(error, "init");
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") autoStart();
})();
