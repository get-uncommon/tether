"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/config.js
  var config_exports = {};
  __export(config_exports, {
    DEFAULTS: () => DEFAULTS,
    cfg: () => cfg,
    configure: () => configure,
    isConfigured: () => isConfigured,
    log: () => log,
    reportError: () => reportError,
    resolveConfig: () => resolveConfig,
    toMetafieldIdentifier: () => toMetafieldIdentifier,
    warn: () => warn
  });
  var DEFAULTS = {
    domain: "",
    token: "",
    apiVersion: "2026-07",
    country: void 0,
    language: void 0,
    locale: void 0,
    markets: null,
    prefix: "tether",
    productPath: "/product",
    collectionPath: "/collection",
    metafields: [],
    imagesFirst: 25,
    variantsFirst: 100,
    sellingPlanGroupsFirst: 10,
    sellingPlansFirst: 25,
    collectionFirst: 24,
    retries: 2,
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
  var PREFIX = /^[a-z][a-z0-9-]*$/;
  var METAFIELD_PART = /^[A-Za-z0-9_.-]+$/;
  var METAFIELD_NAMESPACE = /^(\$app(:[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+)$/;
  var COUNT_OPTIONS = [
    "imagesFirst",
    "variantsFirst",
    "sellingPlanGroupsFirst",
    "sellingPlansFirst",
    "collectionFirst",
    "retries",
    "maxAge",
    "lowStock"
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
  function countOption(name, value) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    return invalidOption(name, value, DEFAULTS[name]);
  }
  function choiceOption(name, value, choices) {
    return choices.find((choice) => choice === value) ?? invalidOption(name, value, choices[0]);
  }
  function domainOption(value) {
    if (typeof value !== "string") return "";
    return value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
  function toMetafieldIdentifier(ref) {
    let namespace;
    let key;
    if (typeof ref === "string") {
      const dot = ref.indexOf(".");
      namespace = dot > 0 ? ref.slice(0, dot) : "";
      key = ref.slice(dot + 1);
    } else if (typeof ref === "object" && ref !== null) {
      namespace = Reflect.get(ref, "namespace");
      key = Reflect.get(ref, "key");
    }
    if (typeof namespace !== "string" || typeof key !== "string") return null;
    return METAFIELD_NAMESPACE.test(namespace) && METAFIELD_PART.test(key) ? { namespace, key } : null;
  }
  function metafieldsOption(value) {
    if (!Array.isArray(value)) return invalidOption("metafields", value, []);
    const refs = [];
    for (
      const ref of
      /** @type {unknown[]} */
      value
    ) {
      const identifier = toMetafieldIdentifier(ref);
      if (identifier) refs.push(typeof ref === "string" ? ref : identifier);
      else invalidOption("metafield", ref, null);
    }
    return refs;
  }
  function resolveConfig(options) {
    const domain = domainOption(options.domain);
    const prefix = typeof options.prefix === "string" && PREFIX.test(options.prefix) ? options.prefix : invalidOption("prefix", options.prefix, DEFAULTS.prefix);
    const resolved = {
      ...DEFAULTS,
      ...options,
      domain,
      prefix,
      storageKey: options.storageKey || `${prefix}:cart:${domain}`,
      metafields: metafieldsOption(options.metafields ?? []),
      checkoutTarget: choiceOption("checkoutTarget", options.checkoutTarget, ["_self", "_blank"]),
      defaultPurchase: choiceOption("defaultPurchase", options.defaultPurchase, ["one-time", "subscription"])
    };
    for (const name of COUNT_OPTIONS) resolved[name] = countOption(name, options[name]);
    for (const name of HOOK_OPTIONS) if (typeof resolved[name] !== "function") resolved[name] = null;
    if (resolved.apiVersion === "unstable") {
      warn('apiVersion "unstable" changes without notice. Pin a dated version (e.g. 2026-07).');
    }
    return resolved;
  }
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

  // src/client.js
  var client_exports = {};
  __export(client_exports, {
    TetherError: () => TetherError,
    endpoint: () => endpoint,
    gql: () => gql,
    request: () => request,
    unwrap: () => unwrap,
    withContext: () => withContext
  });

  // src/market-codes.js
  var market_codes_exports = {};
  __export(market_codes_exports, {
    toCountry: () => toCountry,
    toLanguage: () => toLanguage
  });
  var COUNTRY = /^[A-Z]{2}$/;
  var NOT_A_COUNTRY = /* @__PURE__ */ new Set(["XX", "T1"]);
  var REGIONAL_LANGUAGES = /* @__PURE__ */ new Set(["PT_BR", "PT_PT", "ZH_CN", "ZH_TW"]);
  var LANGUAGE = /^[A-Z]{2,3}$/;
  function toCountry(value) {
    const code = (typeof value === "string" ? value : "").trim().toUpperCase();
    if (!COUNTRY.test(code) || NOT_A_COUNTRY.has(code)) return null;
    return (
      /** @type {CountryCode} */
      code
    );
  }
  function toLanguage(value) {
    const raw = (typeof value === "string" ? value : "").trim().replace("-", "_").toUpperCase();
    if (REGIONAL_LANGUAGES.has(raw)) return (
      /** @type {LanguageCode} */
      raw
    );
    const primary = raw.split("_")[0] ?? "";
    return LANGUAGE.test(primary) ? (
      /** @type {LanguageCode} */
      primary
    ) : null;
  }

  // src/client.js
  var TetherError = class extends Error {
    /**
     * @param {string} message
     * @param {TetherErrorDetails} [details]
     */
    constructor(message, { status: status2, errors, userErrors, code } = {}) {
      super(message);
      this.name = "TetherError";
      this.code = code ?? (status2 ? `HTTP_${status2}` : "ERROR");
      this.status = status2;
      this.errors = errors;
      this.userErrors = userErrors;
    }
  };
  function endpoint(conf = cfg) {
    return `https://${conf.domain}/api/${conf.apiVersion}/graphql.json`;
  }
  function withContext(query, ctx = cfg) {
    const args = [];
    const country = toCountry(ctx.country);
    const language = toLanguage(ctx.language);
    if (country) args.push(`country: ${country}`);
    if (language) args.push(`language: ${language}`);
    if (!args.length || query.includes("@inContext")) return query;
    const tag = `@inContext(${args.join(", ")})`;
    if (/^\s*\{/.test(query)) return `query ${tag} ${query.trimStart()}`;
    return query.replace(/^(\s*(?:query|mutation)(?:\s+\w+)?\s*(?:\([^)]*\))?)/, `$1 ${tag}`);
  }
  var RETRY_BACKOFF_MS = 300;
  var THROTTLE_BACKOFF_MS = 500;
  var SECURITY_REJECTION = 430;
  var INVENTORY_FIELD = "quantityAvailable";
  var storesWithoutInventory = /* @__PURE__ */ new Set();
  var storeOf = (conf) => `${conf.domain} ${conf.apiVersion} ${conf.token}`;
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
  function graphQLFailure(res, errors, conf) {
    const message = errors.map((error) => error.message).filter(Boolean).join(" | ");
    let text = message || "Storefront API error";
    if (!res.ok) text = res.status === 401 || res.status === 403 || !message ? statusText(res.status, conf) : message;
    return new TetherError(text, { status: res.status, errors });
  }
  async function attempt(conf, query, variables, canRetry) {
    let res;
    try {
      res = await (conf.fetch ?? fetch)(endpoint(conf), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": conf.token },
        body: JSON.stringify({ query, variables })
      });
    } catch (error) {
      if (canRetry) return { kind: "retry", backoffMs: RETRY_BACKOFF_MS };
      throw new TetherError(`Network error: ${error instanceof Error ? error.message : String(error)}`, {
        code: "NETWORK"
      });
    }
    if (res.status === SECURITY_REJECTION) {
      throw new TetherError("Shopify security rejection (430)", { status: SECURITY_REJECTION });
    }
    if (canRetry && (res.status === 429 || res.status >= 500)) {
      return { kind: "retry", backoffMs: RETRY_BACKOFF_MS };
    }
    let json;
    try {
      json = await res.json();
    } catch {
      const text = res.ok ? `Invalid response (${res.status})` : statusText(res.status, conf);
      throw new TetherError(text, { status: res.status });
    }
    const { data, errors = [] } = (
      /** @type {GraphQLResponse | null} */
      json ?? {}
    );
    if (errors.length) {
      if (query.includes(INVENTORY_FIELD) && errors.some((error) => error.message.includes(INVENTORY_FIELD))) {
        return { kind: "inventory-refused" };
      }
      if (canRetry && errors.some((error) => error.extensions?.code === "THROTTLED")) {
        return { kind: "retry", backoffMs: THROTTLE_BACKOFF_MS };
      }
      throw graphQLFailure(res, errors, conf);
    }
    if (!res.ok) throw new TetherError(statusText(res.status, conf), { status: res.status });
    return { kind: "data", data };
  }
  async function request(conf, query, variables = {}, { context = true } = {}) {
    if (!conf.domain || !conf.token) {
      throw new TetherError("Tether is not configured: domain and token are required", { code: "NOT_CONFIGURED" });
    }
    let text = context ? withContext(query, conf) : query;
    if (conf.maxAge > 0 && !/^\s*mutation\b/.test(text)) {
      text += ` #${Math.floor(Date.now() / (conf.maxAge * 1e3))}`;
    }
    const store = storeOf(conf);
    let retries = 0;
    for (; ; ) {
      const sent = storesWithoutInventory.has(store) ? text.replaceAll(INVENTORY_FIELD, "") : text;
      const outcome = await attempt(conf, sent, variables, retries < conf.retries);
      switch (outcome.kind) {
        case "data":
          return (
            /** @type {T} */
            outcome.data
          );
        case "inventory-refused":
          log(`the token can't read inventory: ${INVENTORY_FIELD} is left out from now on`);
          storesWithoutInventory.add(store);
          break;
        case "retry":
          retries += 1;
          log("retry", retries);
          await sleep(outcome.backoffMs * 2 ** retries);
          break;
      }
    }
  }
  var gql = (query, variables, options) => request(cfg, query, variables, options);
  function unwrap(payload, name) {
    if (!payload) throw new TetherError(`${name}: empty response`);
    const userErrors = payload.userErrors ?? [];
    if (userErrors.length) {
      throw new TetherError(userErrors.map((error) => error.message).join(" | "), { userErrors });
    }
    return payload;
  }

  // src/cart.js
  var cart_exports = {};
  __export(cart_exports, {
    Cart: () => Cart,
    trapFocus: () => trapFocus
  });

  // src/dom.js
  var dom_exports = {};
  __export(dom_exports, {
    attr: () => attr,
    busy: () => busy,
    cdnUrl: () => cdnUrl,
    emit: () => emit,
    formatDate: () => formatDate,
    formatMoney: () => formatMoney2,
    formatPercent: () => formatPercent,
    get: () => get,
    has: () => has,
    hasTemplate: () => hasTemplate,
    imageUrl: () => imageUrl,
    notifyLayoutChanged: () => notifyLayoutChanged,
    parseJSONAttr: () => parseJSONAttr,
    productUrl: () => productUrl2,
    qsa: () => qsa,
    repeat: () => repeat,
    repeatKeyed: () => repeatKeyed,
    sameImage: () => sameImage,
    scoped: () => scoped,
    sel: () => sel,
    setImage: () => setImage,
    setSelected: () => setSelected,
    setStoreHtml: () => setStoreHtml,
    setText: () => setText,
    setTextTracked: () => setTextTracked,
    show: () => show,
    toAttributes: () => toAttributes,
    watchImages: () => watchImages
  });

  // src/markup.js
  var attr = (name) => `${cfg.prefix}-${name}`;
  var sel = (name, value) => value === void 0 ? `[${attr(name)}]` : `[${attr(name)}="${value}"]`;
  var get = (el, name) => el.getAttribute(attr(name));
  var has = (el, name) => el.hasAttribute(attr(name));
  function qsa(root, selector) {
    if (!root) return [];
    return [.../** @type {NodeListOf<HTMLElement>} */
    root.querySelectorAll(selector)];
  }
  var scoped = (root, selector, scopeSelector) => qsa(root, selector).filter((el) => el.closest(scopeSelector) === root);
  function emit(name, detail, target = document) {
    target.dispatchEvent(new CustomEvent(`${cfg.prefix}:${name}`, { detail, bubbles: true }));
  }

  // src/store-html.js
  var store_html_exports = {};
  __export(store_html_exports, {
    storeHtmlFragment: () => storeHtmlFragment
  });
  var BLOCKED_ELEMENTS = /* @__PURE__ */ new Set([
    "SCRIPT",
    "OBJECT",
    "EMBED",
    "BASE",
    "META",
    "LINK",
    "NOSCRIPT",
    "TEMPLATE",
    // SVG animation can set an attribute such as href to a script URL after the attributes were checked.
    "ANIMATE",
    "SET"
  ]);
  var URL_ATTRIBUTES = /* @__PURE__ */ new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "data", "background"]);
  var SCRIPT_URL = /^\s*(javascript|vbscript|data):/i;
  var DATA_IMAGE = /^\s*data:image\/(png|gif|jpeg|webp|avif);/i;
  var IGNORED_IN_SCHEME = /[ - ]/g;
  function isUnsafeAttribute(element, attribute) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || name === "srcdoc") return true;
    const url = attribute.value.replace(IGNORED_IN_SCHEME, "");
    if (!URL_ATTRIBUTES.has(name) || !SCRIPT_URL.test(url)) return false;
    return !(element.tagName === "IMG" && name === "src" && DATA_IMAGE.test(url));
  }
  function clean(root) {
    for (const element of [...root.querySelectorAll("*")]) {
      if (BLOCKED_ELEMENTS.has(element.tagName.toUpperCase())) {
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        if (isUnsafeAttribute(element, attribute)) element.removeAttribute(attribute.name);
      }
    }
  }
  function storeHtmlFragment(html, document2 = globalThis.document) {
    const template = document2.createElement("template");
    template.innerHTML = html ?? "";
    clean(template.content);
    return template.content;
  }

  // src/shopify-values.js
  var shopify_values_exports = {};
  __export(shopify_values_exports, {
    STORE_ENV_NAMES: () => STORE_ENV_NAMES,
    formatMoney: () => formatMoney,
    isHttpsUrl: () => isHttpsUrl,
    isSecretShopifyToken: () => isSecretShopifyToken,
    productKey: () => productKey,
    productUrl: () => productUrl
  });
  var STORE_ENV_NAMES = {
    domain: ["PUBLIC_SHOPIFY_DOMAIN", "PUBLIC_SHOPIFY_STORE_DOMAIN", "SHOPIFY_DOMAIN"],
    token: ["PUBLIC_SHOPIFY_STOREFRONT_TOKEN", "PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SHOPIFY_STOREFRONT_TOKEN"]
  };
  function isHttpsUrl(url) {
    if (typeof url !== "string") return false;
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  }
  function isSecretShopifyToken(token) {
    return /^shp[a-z]{2}_/.test(token.trim());
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
    if (!/\{(handle|id)\}/.test(productPath)) return `${productPath.replace(/\/$/, "")}/${handle ?? String(handle)}`;
    const numericId2 = id ? id.split("/").pop() ?? "" : "";
    return productPath.replace(/\{handle\}/g, encodeURIComponent(handle ?? "")).replace(/\{id\}/g, encodeURIComponent(numericId2));
  }
  function productKey(raw) {
    const value = String(raw ?? "").trim();
    if (!value) return null;
    if (value.startsWith("gid://")) return value;
    if (/^\d+$/.test(value)) return `gid://shopify/Product/${value}`;
    return /\/products\/([^/?#]+)/.exec(value)?.[1] ?? value;
  }

  // src/images.js
  function imageUrl(url, { width, height, crop } = {}) {
    if (!url) return url;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      if (error instanceof TypeError) return url;
      throw error;
    }
    if (width) parsed.searchParams.set("width", String(width));
    if (height) parsed.searchParams.set("height", String(height));
    if (crop) parsed.searchParams.set("crop", crop);
    return (
      /** @type {Url} */
      parsed.toString()
    );
  }
  function sizeAttribute(el, name) {
    return el.getAttribute(name) ?? el.getAttribute(attr(name)) ?? el.getAttribute(`data-${name}`);
  }
  function cdnUrl(url, el) {
    if (!url || !el) return url;
    const width = sizeAttribute(el, "max-width");
    const height = sizeAttribute(el, "max-height");
    return imageUrl(url, { width, height, crop: width || height ? sizeAttribute(el, "crop") : null });
  }
  var sameImage = (a, b) => Boolean(a && b) && a?.split("?")[0] === b?.split("?")[0];
  function cssUrl(url) {
    const hasScheme = /^\s*[a-z][a-z0-9+.-]*:/i.test(url);
    if (hasScheme && !/^\s*(https?:|data:image\/)/i.test(url)) return "none";
    const escaped = url.replace(/["\\\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
    return `url("${escaped}")`;
  }
  function setImage(el, url, alt) {
    if (!url) return;
    const src = cdnUrl(url, el);
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

  // src/repeaters.js
  var templates = /* @__PURE__ */ new WeakMap();
  var hasTemplate = (container) => Boolean(templates.get(container));
  var copyOf = (template) => (
    /** @type {HTMLElement} */
    template.cloneNode(true)
  );
  function templateOf(container) {
    const known = templates.get(container);
    if (known !== void 0) return known;
    const first = container.firstElementChild;
    const template = first ? copyOf(
      /** @type {HTMLElement} */
      first
    ) : null;
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
    try {
      onLeave(node, done);
    } catch (error) {
      reportError(error, "repeater onLeave");
      done();
    }
  }
  function insertFresh(container, wanted, fresh, onEnter) {
    wanted.forEach((node, index) => {
      if (!fresh.has(node)) return;
      const previous = wanted[index - 1];
      if (previous?.parentNode === container) previous.after(node);
      else container.prepend(node);
      if (!onEnter) return;
      try {
        onEnter(node);
      } catch (error) {
        reportError(error, "repeater onEnter");
      }
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
    const live = () => [.../** @type {HTMLCollectionOf<HTMLElement>} */
    container.children].filter(
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

  // src/dom.js
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
    if (cfg.formatMoney) return cfg.formatMoney(money, cfg.locale);
    return formatMoney(money, cfg.locale);
  }
  function formatDate(iso) {
    if (!iso) return "";
    return formatOr(() => new Date(iso).toLocaleDateString(cfg.locale || void 0), "");
  }
  function setStoreHtml(el, html) {
    el.replaceChildren(storeHtmlFragment(html, el.ownerDocument));
  }
  var isTextField = (el) => el.tagName === "INPUT" || el.tagName === "TEXTAREA";
  var isInput = (el) => el.tagName === "INPUT";
  function setText(el, value) {
    const text = value == null ? "" : String(value);
    if (isTextField(el)) el.value = text;
    else el.textContent = text;
  }
  var readText = (el) => isTextField(el) ? el.value : el.textContent;
  function setTextTracked(el, value) {
    const before = readText(el);
    setText(el, value);
    if (before !== readText(el) && el.hasAttribute(SEEN) && cfg.onValueChange) {
      try {
        cfg.onValueChange(el, before);
      } catch (error) {
        reportError(error, "onValueChange");
      }
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
  function setSelected(el, selected) {
    el.classList.toggle("is-selected", selected);
    el.setAttribute("aria-pressed", selected ? "true" : "false");
    if (isInput(el) && (el.type === "radio" || el.type === "checkbox")) el.checked = selected;
    const input = el.querySelector('input[type="radio"],input[type="checkbox"]');
    if (input && isInput(input)) input.checked = selected;
  }
  var layoutTimer;
  function notifyLayoutChanged(reason) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      const { ScrollTrigger } = (
        /** @type {Window & { ScrollTrigger?: { refresh?: () => void } }} */
        window
      );
      if (cfg.onLayoutChange) cfg.onLayoutChange(reason);
      else ScrollTrigger?.refresh?.();
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
      return (
        /** @type {unknown} */
        JSON.parse(raw)
      );
    } catch {
      warn(`invalid JSON in ${attr(name)}`, el);
      return null;
    }
  }
  function toAttributes(attributes) {
    if (!attributes) return [];
    if (Array.isArray(attributes)) {
      return attributes.map((attribute) => ({ key: String(attribute.key), value: String(attribute.value ?? "") }));
    }
    return Object.entries(attributes).map(([key, value]) => ({ key, value: String(value ?? "") }));
  }

  // src/fragments.js
  var fragments_exports = {};
  __export(fragments_exports, {
    cartFragment: () => cartFragment,
    collectionFields: () => collectionFields,
    productFragment: () => productFragment
  });
  var MONEY = "amount currencyCode";
  var IMAGE = "url altText width height";
  function metafieldsField(metafields) {
    const identifiers = [];
    for (const ref of metafields) {
      const identifier = toMetafieldIdentifier(ref);
      if (identifier) identifiers.push(identifier);
    }
    if (!identifiers.length) return "";
    const list = identifiers.map(({ namespace, key }) => `{namespace: ${JSON.stringify(namespace)}, key: ${JSON.stringify(key)}}`).join(", ");
    return `metafields(identifiers:[${list}]){namespace key type value reference{... on MediaImage{image{${IMAGE}}}}}`;
  }
  var SELLING_PLAN_FIELDS = ` id name description recurringDeliveries options{name value}priceAdjustments{orderCount adjustmentValue{__typename ... on SellingPlanPercentagePriceAdjustment{adjustmentPercentage}... on SellingPlanFixedAmountPriceAdjustment{adjustmentAmount{${MONEY}}}... on SellingPlanFixedPriceAdjustment{price{${MONEY}}}}}`;
  var ALLOCATION_FIELDS = ` sellingPlan{id}checkoutChargeAmount{${MONEY}}remainingBalanceChargeAmount{${MONEY}}priceAdjustments{price{${MONEY}}compareAtPrice{${MONEY}}perDeliveryPrice{${MONEY}}unitPrice{${MONEY}}}`;
  function productFragment(o = cfg) {
    return ` fragment TetherProduct on Product{id handle title description descriptionHtml productType vendor tags availableForSale publishedAt onlineStoreUrl requiresSellingPlan seo{title description}featuredImage{${IMAGE}}images(first:${o.imagesFirst}){nodes{${IMAGE}}}options{name optionValues{name swatch{color image{previewImage{${IMAGE}}}}}}priceRange{minVariantPrice{${MONEY}}maxVariantPrice{${MONEY}}}compareAtPriceRange{minVariantPrice{${MONEY}}maxVariantPrice{${MONEY}}}${metafieldsField(o.metafields)} sellingPlanGroups(first:${o.sellingPlanGroupsFirst}){nodes{name appName options{name values}sellingPlans(first:${o.sellingPlansFirst}){nodes{${SELLING_PLAN_FIELDS}}}}}variants(first:${o.variantsFirst}){nodes{id title availableForSale currentlyNotInStock quantityAvailable sku barcode selectedOptions{name value}image{${IMAGE}}price{${MONEY}}compareAtPrice{${MONEY}}unitPrice{${MONEY}}sellingPlanAllocations(first:${o.sellingPlansFirst}){nodes{${ALLOCATION_FIELDS}}}}}}`;
  }
  function cartFragment() {
    return ` fragment TetherCart on Cart{id checkoutUrl totalQuantity note createdAt updatedAt attributes{key value}buyerIdentity{countryCode email}discountCodes{code applicable}cost{subtotalAmount{${MONEY}}totalAmount{${MONEY}}checkoutChargeAmount{${MONEY}}}lines(first:100){nodes{id quantity attributes{key value}cost{totalAmount{${MONEY}}subtotalAmount{${MONEY}}amountPerQuantity{${MONEY}}compareAtAmountPerQuantity{${MONEY}}}discountAllocations{discountedAmount{${MONEY}}}sellingPlanAllocation{sellingPlan{id name description recurringDeliveries options{name value}}checkoutChargeAmount{${MONEY}}priceAdjustments{price{${MONEY}}compareAtPrice{${MONEY}}perDeliveryPrice{${MONEY}}}}merchandise{... on ProductVariant{id title sku availableForSale requiresShipping quantityAvailable image{${IMAGE}}price{${MONEY}}compareAtPrice{${MONEY}}selectedOptions{name value}product{id title handle vendor featuredImage{${IMAGE}}}}}... on ComponentizableCartLine{lineComponents{id quantity merchandise{... on ProductVariant{id title product{title handle}}}}}}}}`;
  }
  function collectionFields() {
    return `
  id handle title description descriptionHtml
  image { ${IMAGE} }
  seo { title description }`;
  }

  // src/selling-plans.js
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
  function toGid(value, type) {
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (!text) return null;
    if (text.startsWith("gid://")) return text;
    if (/^\d+$/.test(text)) return `gid://shopify/${type}/${text}`;
    return text;
  }
  var GID = {
    /** @param {unknown} value */
    product: (value) => toGid(value, "Product"),
    /** @param {unknown} value */
    variant: (value) => toGid(value, "ProductVariant"),
    /** @param {unknown} value */
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
    const oneTime = parseFloat(variant?.price.amount ?? "");
    const onPlan = parseFloat(planPrice(variant, planId)?.amount ?? "");
    if (!variant || !Number.isFinite(oneTime) || !Number.isFinite(onPlan) || oneTime <= 0 || onPlan >= oneTime) {
      return { amount: null, percentage: 0 };
    }
    return {
      amount: { amount: (oneTime - onPlan).toFixed(2), currencyCode: variant.price.currencyCode },
      percentage: Math.round((1 - onPlan / oneTime) * 100)
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

  // src/cart/drawer.js
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var FOCUS_AFTER_OPEN_MS = 60;
  var openWithoutDrawer = false;
  var returnFocus = null;
  var isFocusable = (el) => el !== null && "focus" in el;
  var focusables = (drawer) => qsa(drawer, FOCUSABLE).filter((el) => el.offsetParent !== null || el === document.activeElement);
  var drawers = () => qsa(document, sel("cart-drawer"));
  var isOpenDrawer = (drawer) => drawer.classList.contains(cfg.cartDrawerOpenClass);
  function isOpen() {
    const all = drawers();
    return all.length ? all.some(isOpenDrawer) : openWithoutDrawer;
  }
  function syncDrawerAria(open) {
    qsa(document, sel("cart-open")).forEach((button) => {
      button.setAttribute("aria-expanded", String(open));
    });
    drawers().forEach((drawer) => {
      if (!drawer.hasAttribute("role")) drawer.setAttribute("role", "dialog");
      if (!drawer.hasAttribute("aria-label") && !drawer.hasAttribute("aria-labelledby")) {
        drawer.setAttribute("aria-label", get(drawer, "cart-label") || "Cart");
      }
      drawer.setAttribute("aria-modal", String(open));
      if (isOpenDrawer(drawer)) return;
      drawer.setAttribute("aria-hidden", "true");
      if (cfg.cartFocus) drawer.inert = true;
    });
  }
  function focusInto(drawer) {
    const target = focusables(drawer)[0] ?? drawer;
    if (target === drawer && !drawer.hasAttribute("tabindex")) drawer.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  function openCart() {
    if (isOpen()) return;
    openWithoutDrawer = true;
    const opened = drawers().filter((drawer) => get(drawer, "cart-drawer") !== "manual");
    opened.forEach((drawer) => {
      drawer.inert = false;
      drawer.classList.add(cfg.cartDrawerOpenClass);
      drawer.setAttribute("aria-hidden", "false");
    });
    syncDrawerAria(true);
    const [first] = opened;
    if (cfg.cartFocus && first) {
      returnFocus = isFocusable(document.activeElement) ? document.activeElement : null;
      setTimeout(() => {
        focusInto(first);
      }, FOCUS_AFTER_OPEN_MS);
    }
    cfg.onCartOpen?.(opened);
    emit("cart-toggled", { open: true });
  }
  function closeCart() {
    if (!isOpen()) return;
    openWithoutDrawer = false;
    const all = drawers();
    const hadFocus = all.some((drawer) => drawer.contains(document.activeElement));
    all.forEach((drawer) => {
      drawer.classList.remove(cfg.cartDrawerOpenClass);
      drawer.setAttribute("aria-hidden", "true");
      if (cfg.cartFocus) drawer.inert = true;
    });
    syncDrawerAria(false);
    if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    cfg.onCartClose?.(all);
    emit("cart-toggled", { open: false });
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

  // src/loader.js
  var loader_exports = {};
  __export(loader_exports, {
    clearProductCache: () => clearProductCache,
    getProduct: () => getProduct,
    getProducts: () => getProducts,
    getRecommendations: () => getRecommendations,
    hydrateProducts: () => hydrateProducts,
    normalizeProductKey: () => normalizeProductKey,
    primeProduct: () => primeProduct,
    refreshProducts: () => refreshProducts,
    takeStale: () => takeStale
  });
  var MISS_CACHE_MS = 1e4;
  var FRESH_MS = 6e4;
  var productCache = /* @__PURE__ */ new Map();
  var waiting = /* @__PURE__ */ new Map();
  var stale = /* @__PURE__ */ new Set();
  var freshAt = /* @__PURE__ */ new Map();
  var pending = [];
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
      waiting.set(key, { resolve, reject });
      pending.push(key);
      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(() => void flush(), 0);
      }
    });
    productCache.set(key, loading);
    return loading;
  }
  function batchQuery(keys) {
    const ids = keys.filter(isGid);
    const handles = keys.filter((key) => !isGid(key));
    const definitions = [];
    const selections = [];
    const variables = {};
    if (ids.length) {
      definitions.push("$ids: [ID!]!");
      variables["ids"] = ids;
      selections.push("byId: nodes(ids: $ids) { ... on Product { ...TetherProduct } }");
    }
    handles.forEach((handle, index) => {
      definitions.push(`$h${index}: String!`);
      variables[`h${index}`] = handle;
      selections.push(`h${index}: product(handle: $h${index}) { ...TetherProduct }`);
    });
    const query = `query TetherProducts(${definitions.join(",")}){${selections.join(" ")}}${productFragment()}`;
    return { query, variables, handles };
  }
  function settleWaiting(key, settle) {
    const waiter = waiting.get(key);
    waiting.delete(key);
    if (waiter) settle(waiter);
  }
  function forgetMissLater(key, batchGeneration) {
    if (batchGeneration !== generation) return;
    const miss = productCache.get(key);
    setTimeout(() => {
      if (productCache.get(key) === miss) productCache.delete(key);
    }, MISS_CACHE_MS);
  }
  async function flush() {
    flushScheduled = false;
    const batchGeneration = generation;
    const keys = pending.splice(0);
    if (!keys.length) return;
    const { query, variables, handles } = batchQuery(keys);
    log("fetch products", keys);
    let data;
    try {
      data = await gql(query, variables);
    } catch (error) {
      keys.forEach((key) => {
        settleWaiting(key, (waiter) => {
          if (batchGeneration === generation) productCache.delete(key);
          waiter.reject(error);
        });
      });
      return;
    }
    const found = /* @__PURE__ */ new Map();
    for (const product of data.byId ?? []) if (product) found.set(product.id, product);
    handles.forEach((handle, index) => {
      const product = data[`h${index}`];
      if (product) found.set(handle, product);
    });
    const now = Date.now();
    keys.forEach((key) => {
      settleWaiting(key, (waiter) => {
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
    });
  }
  function clearProductCache() {
    productCache.clear();
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
    });
    return true;
  }
  function refreshProducts(keys) {
    for (const key of keys) {
      const normalized = normalizeProductKey(key);
      if (normalized) productCache.delete(normalized);
    }
    return keys.map((key) => getProduct(key));
  }
  var COLLECTION_QUERY = `query TetherCollection($handle:String!,$first:Int!,$after:String,$sortKey:ProductCollectionSortKeys,$reverse:Boolean,$filters:[ProductFilter!]){collection(handle:$handle){${collectionFields()} products(first:$first,after:$after,sortKey:$sortKey,reverse:$reverse,filters:$filters){nodes{...TetherProduct}pageInfo{hasNextPage endCursor}}}}`;
  var SEARCH_QUERY = `query TetherSearch($first:Int!,$after:String,$query:String,$sortKey:ProductSortKeys,$reverse:Boolean){products(first:$first,after:$after,query:$query,sortKey:$sortKey,reverse:$reverse){nodes{...TetherProduct}pageInfo{hasNextPage endCursor}}}`;
  async function getProducts({
    collection,
    query,
    first = cfg.collectionFirst,
    after = null,
    sortKey,
    reverse = false,
    filters
  } = {}) {
    const fragment = productFragment();
    if (collection) {
      const data2 = await gql(`${COLLECTION_QUERY}
${fragment}`, {
        handle: collection,
        first,
        after,
        sortKey: sortKey || void 0,
        reverse,
        filters: filters ?? void 0
      });
      if (!data2.collection) throw new TetherError(`Collection not found: ${collection}`, { code: "NOT_FOUND" });
      const { products, ...rest } = data2.collection;
      products.nodes.forEach(primeProduct);
      return { collection: rest, products: products.nodes, pageInfo: products.pageInfo };
    }
    const data = await gql(`${SEARCH_QUERY}
${fragment}`, {
      first,
      after,
      query: query || void 0,
      sortKey: sortKey || void 0,
      reverse
    });
    data.products.nodes.forEach(primeProduct);
    return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
  }
  async function getRecommendations(product, intent = "RELATED") {
    const key = normalizeProductKey(typeof product === "object" ? product?.id : product);
    const byId = key?.startsWith("gid://") ?? false;
    const data = await gql(
      `query TetherRecs(${byId ? "$id: ID!" : "$handle: String!"},$intent:ProductRecommendationIntent){productRecommendations(${byId ? "productId: $id" : "productHandle: $handle"},intent:$intent){...TetherProduct}}${productFragment()}`,
      byId ? { id: key, intent } : { handle: key, intent }
    );
    const list = data.productRecommendations ?? [];
    list.forEach(primeProduct);
    return list;
  }

  // src/amounts.js
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

  // src/cart/render.js
  var DEFAULT_TITLE = "Default Title";
  var quantityOf = (line, pending2) => pending2.get(line.id)?.quantity ?? line.quantity;
  var numericId = (gid) => gid.split("/").pop() ?? gid;
  function lineUrl(line) {
    const variant = line.merchandise;
    const base = productUrl2(variant.product.handle, variant.product.id);
    const query = new URLSearchParams();
    query.set("variant", numericId(variant.id));
    const planId = line.sellingPlanAllocation?.sellingPlan.id;
    if (planId) query.set("selling_plan", numericId(planId));
    return `${base}${base.includes("?") ? "&" : "?"}${query.toString()}`;
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
    const pending2 = view.pending.has(line.id);
    node.classList.toggle("is-busy", pending2);
    if (pending2) node.setAttribute("aria-busy", "true");
    else node.removeAttribute("aria-busy");
    qsa(node, sel("line", "warning")).forEach((el) => {
      setTextTracked(el, warning?.message ?? "");
    });
    const conditions = {
      subscription: isSubscription,
      "one-time": !isSubscription,
      "on-sale": isGreaterAmount(line.cost.compareAtAmountPerQuantity?.amount, line.cost.amountPerQuantity.amount),
      "has-components": (line.lineComponents ?? []).length > 0,
      warning: Boolean(warning)
    };
    qsa(node, sel("line-show")).forEach((el) => {
      const key = get(el, "line-show");
      if (key !== null && Object.hasOwn(conditions, key)) show(el, conditions[
        /** @type {keyof conditions} */
        key
      ]);
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
        el.setAttribute("href", lineUrl(line));
        return;
      }
      const value = lineValue(line, key, view);
      if (value !== void 0) setTextTracked(el, value);
    });
    renderLineState(node, line, view);
    qsa(node, `select${sel("line-plan")}`).forEach((select) => {
      getProduct(variant.product.handle).then((product) => {
        fillPlanSelect(
          /** @type {HTMLSelectElement} */
          select,
          line,
          product
        );
      }).catch((error) => {
        reportError(error, "line plan options");
      });
    });
  }
  function renderConditions(cart, view) {
    const count = cart?.totalQuantity ?? 0;
    const hasSubscription = (cart?.lines.nodes ?? []).some((line) => line.sellingPlanAllocation);
    const conditions = {
      "cart-empty": count === 0,
      "cart-filled": count > 0,
      "cart-has-subscription": hasSubscription,
      "cart-no-subscription": !hasSubscription,
      "cart-has-discount": (cart?.discountCodes ?? []).some((code) => code.applicable),
      "cart-error": view.failed,
      "cart-warning": view.warnings.length > 0
    };
    qsa(document, sel("show")).forEach((el) => {
      const key = get(el, "show");
      if (key === null || !Object.hasOwn(conditions, key) || el.closest(sel("product"))) return;
      show(el, conditions[
        /** @type {keyof conditions} */
        key
      ]);
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
    syncDrawerAria(isOpen());
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
      if (/^\s*0?\s*$/.test(el.textContent)) el.textContent = count;
    });
  }

  // src/cart/store.js
  var status = { kind: "unknown" };
  var warnings = [];
  var pendingQuantities = /* @__PURE__ */ new Map();
  var customer = { accessToken: null, beforeCheckout: null };
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
  function readStorageIfAllowed(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function writeStorageIfAllowed(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
    }
  }
  var savedCartId = () => readStorageIfAllowed(cfg.storageKey) || null;
  function forgetSavedCart() {
    writeStorageIfAllowed(cfg.storageKey, null);
  }
  function keepQuietly(cart) {
    status = statusOf(cart);
    if (cart) writeStorageIfAllowed(cfg.storageKey, cart.id);
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
    writeStorageIfAllowed(seenKey(), `${Date.now()}|${cart?.totalQuantity ?? 0}`);
    announce(reason);
    return cart;
  }
  function settleLoad(outcome) {
    status = outcome.kind === "loaded" ? statusOf(outcome.cart) : { kind: "error", error: outcome.error, cart: null };
    announce("load");
  }
  function setFailure(error) {
    const cart = currentCart();
    status = error == null ? statusOf(cart) : { kind: "error", error, cart };
  }
  function showLastKnownCount() {
    if (status.kind !== "unknown") return;
    const count = readStorageIfAllowed(seenKey())?.split("|")[1];
    if (count) showSavedCount(count);
  }
  function setWarnings(notes) {
    warnings = notes.filter((note, index) => notes.findIndex((other) => other.message === note.message) === index).map((note) => ({ ...note, message: cfg.warningText?.(note) || note.message }));
    if (warnings.length) emit("cart-warning", { warnings });
  }
  var waitOnly = () => void 0;
  function serial() {
    let previous = Promise.resolve();
    return (task) => {
      const run = previous.then(task);
      previous = run.then(waitOnly, waitOnly);
      return run;
    };
  }
  var runInOrder = serial();
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
    warnings
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

  // src/cart/mutations.js
  var UNKNOWN_CART_MESSAGE = /does not exist|not found|invalid id/i;
  function isCartGone(error) {
    if (!(error instanceof TetherError)) return false;
    if (error.userErrors?.some((userError) => userError.field?.[0] === "cartId")) return true;
    return (error.errors ?? []).some((graphQLError) => UNKNOWN_CART_MESSAGE.test(graphQLError.message));
  }
  function toLineInput(input, quantity = 1, options = {}) {
    const spec = typeof input === "object" && input !== null ? input : { ...options, variantId: input, quantity };
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
    return `mutation Tether_${name}(${args}){${name}(${inner}){cart{...TetherCart}userErrors{field message}warnings{code message target}}}${cartFragment()}`;
  }
  async function send(name, args, inner, variables) {
    const data = await gql(mutationText(name, args, inner), variables);
    const payload = unwrap(data[name], name);
    setWarnings(payload.warnings ?? []);
    return payload.cart;
  }
  function createCart(input) {
    const buyerIdentity = {
      ...cfg.country ? { countryCode: cfg.country.toUpperCase() } : {},
      ...customer.accessToken ? { customerAccessToken: customer.accessToken } : {}
    };
    const withIdentity = Object.keys(buyerIdentity).length ? { buyerIdentity, ...input } : input;
    return send("cartCreate", "$input: CartInput!", "input: $input", { input: withIdentity });
  }
  async function mutateCart({ name, args, inner, variables, createInput }) {
    const cartId = savedCartId();
    if (!cartId) return createInput ? createCart(createInput) : null;
    try {
      return await send(name, `$cartId: ID!, ${args}`, `cartId: $cartId, ${inner}`, { ...variables, cartId });
    } catch (error) {
      if (!isCartGone(error)) throw error;
      forgetSavedCart();
      if (!createInput) throw error;
      log("cart expired, creating a new one");
      return createCart(createInput);
    }
  }
  async function fetchCart(id) {
    const data = await gql(`query TetherCart($id:ID!){cart(id:$id){...TetherCart}}${cartFragment()}`, { id });
    return data.cart;
  }
  async function fetchCheckoutUrl(id) {
    const data = await gql("query TetherCheckout($id: ID!) { cart(id: $id) { checkoutUrl } }", { id });
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
    args: "$lines: [CartLineUpdateInput!]!",
    inner: "lines: $lines",
    variables: { lines },
    createInput: null
  });
  var removeLines = (lineIds) => mutateCart({
    name: "cartLinesRemove",
    args: "$lineIds: [ID!]!",
    inner: "lineIds: $lineIds",
    variables: { lineIds },
    createInput: null
  });
  var setLineQuantity = (lineId, target) => target > 0 ? updateLines([{ id: lineId, quantity: target }]) : removeLines([lineId]);

  // src/cart/checkout.js
  var askCheckoutUrl = (cartId) => fetchCheckoutUrl(cartId).then(
    (url) => ({ kind: (
      /** @type {const} */
      "url"
    ), url }),
    (error) => ({ kind: (
      /** @type {const} */
      "failed"
    ), error })
  );
  async function accountCheckoutUrl() {
    if (!customer.beforeCheckout) return null;
    try {
      return await customer.beforeCheckout();
    } catch (error) {
      reportError(error, "account checkout");
      return null;
    }
  }
  async function checkoutUrl(cartId) {
    const cartAnswer = askCheckoutUrl(cartId);
    let url = await accountCheckoutUrl();
    if (!url) {
      const answer = await cartAnswer;
      if (answer.kind === "failed") throw answer.error;
      url = answer.url;
    }
    if (!url) throw new TetherError("No checkoutUrl (cart empty or expired)");
    if (!customer.accessToken) return url;
    return `${url}${url.includes("?") ? "&" : "?"}logged_in=true`;
  }
  function detachOpenerIfAllowed(tab) {
    try {
      tab.opener = null;
    } catch {
    }
  }
  async function checkout(target = cfg.checkoutTarget) {
    const cartId = savedCartId();
    const cart = currentCart();
    if (!cartId || cart && !cart.totalQuantity) return null;
    const tab = target === "_blank" ? window.open("", "_blank") : null;
    if (tab) detachOpenerIfAllowed(tab);
    try {
      const url = await checkoutUrl(cartId);
      if (!isHttpsUrl(url)) throw new TetherError("The checkout URL is not https: not opened");
      emit("checkout", { url, cart: currentCart() });
      if (tab && !tab.closed) tab.location.href = url;
      else window.location.href = url;
      return url;
    } catch (error) {
      tab?.close();
      reportError(error, "checkout failed");
      return null;
    }
  }

  // src/cart.js
  var currentLines = () => currentCart()?.lines.nodes ?? [];
  function changeQuantity(lineId, delta) {
    const line = currentLines().find((candidate) => candidate.id === lineId);
    if (!line) return Promise.resolve(currentCart());
    const target = Math.max(0, pendingQuantityOf(line) + delta);
    const job = { quantity: target };
    pendingQuantities.set(lineId, job);
    announce("pending");
    const isLatest = () => pendingQuantities.get(lineId) === job;
    const sent = enqueue(async () => {
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
  async function init() {
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
      if (isCartGone(error)) forgetSavedCart();
      settleLoad({ kind: "failed", error });
    }
    return currentCart();
  }
  var Cart = {
    init,
    /** @returns {string | null} The saved cart's id. */
    id: savedCartId,
    /** @returns {CartStatus} */
    get status() {
      return cartStatus();
    },
    /** @returns {ShopifyCart | null} */
    get state() {
      return currentCart();
    },
    /** @returns {readonly ShopifyCartLine[]} */
    get lines() {
      return currentLines();
    },
    /** @returns {number} */
    get count() {
      return currentCart()?.totalQuantity ?? 0;
    },
    /** @returns {boolean} True once the saved cart, or that there is none, is known. */
    get loaded() {
      return cartStatus().kind !== "unknown";
    },
    /** @returns {unknown} The failure of the last load or change, until a change succeeds. */
    get lastError() {
      const current = cartStatus();
      return current.kind === "error" ? current.error : null;
    },
    set lastError(error) {
      setFailure(error);
    },
    /** @returns {readonly CartWarning[]} Shopify's notes on the last change. */
    get warnings() {
      return currentWarnings();
    },
    /** @returns {ReadonlyMap<string, { quantity: number }>} Line id → the quantity quick clicks asked for. */
    get pendingQty() {
      return pendingQuantities;
    },
    /** @returns {string | null} The logged-in customer's Customer Account API token (set by the account part). */
    get customerAccessToken() {
      return customer.accessToken;
    },
    set customerAccessToken(token) {
      customer.accessToken = token || null;
    },
    /** @returns {(() => Promise<string | null>) | null} The account's own checkout URL (set by the account part). */
    get beforeCheckout() {
      return customer.beforeCheckout;
    },
    set beforeCheckout(fetchUrl) {
      customer.beforeCheckout = typeof fetchUrl === "function" ? fetchUrl : null;
    },
    /**
     * Links the cart to a logged-in customer, or unlinks it with `null`s. Carts created from now on belong to the
     * customer; `beforeCheckout` gives the checkout URL (`null` from it uses the cart's).
     *
     * @param {Partial<CustomerLink>} link Fields left out keep their value.
     */
    setCustomer(link) {
      if (link.accessToken !== void 0) customer.accessToken = link.accessToken;
      if (link.beforeCheckout !== void 0) customer.beforeCheckout = link.beforeCheckout;
    },
    /** Keeps a cart and shows it, as a change does; tests seed the cart with it. */
    _commit: commit,
    render,
    subscribe,
    /**
     * `add(variantId, 2)`, `add({ variantId, quantity, sellingPlanId, attributes })`, or `add([line, line])` for
     * bundles in one request. Creates the cart when there is none.
     *
     * @param {string | number | LineSpec | (string | number | LineSpec)[]} input
     * @param {number} [quantity]
     * @param {Omit<LineSpec, 'variantId' | 'quantity'>} [options]
     * @returns {Promise<ShopifyCart | null>}
     */
    add(input, quantity = 1, options = {}) {
      const lines = (Array.isArray(input) ? input : [input]).map((line) => toLineInput(line, quantity, options));
      return enqueue(async () => {
        const cart = await mutateCart({
          name: "cartLinesAdd",
          args: "$lines: [CartLineInput!]!",
          inner: "lines: $lines",
          variables: { lines },
          createInput: { lines }
        });
        commit(cart, "add");
        emit("added", { cart, lines });
        if (cfg.openCartOnAdd) openCart();
        return cart;
      });
    },
    /**
     * `updateLine(lineId, 3)` or `updateLine(lineId, { quantity, sellingPlanId, attributes })`.
     *
     * @param {string} lineId
     * @param {number | LinePatch} patch A quantity of 0 or less removes the line.
     * @returns {Promise<ShopifyCart | null>}
     */
    updateLine(lineId, patch) {
      const quantity = typeof patch === "number" ? patch : patch.quantity;
      if (quantity !== void 0 && quantity <= 0) return Cart.removeLine(lineId);
      const line = toLineUpdate(lineId, patch);
      return enqueue(async () => commit(await updateLines([line]), "update"));
    },
    changeQuantity,
    /**
     * @param {ShopifyCartLine} line
     * @returns {number} The quantity to show: the one asked for while an update is on its way.
     */
    quantityOf: pendingQuantityOf,
    /**
     * @param {string | string[]} lineIds
     * @returns {Promise<ShopifyCart | null>}
     */
    removeLine(lineIds) {
      const ids = Array.isArray(lineIds) ? lineIds : [lineIds];
      return enqueue(async () => commit(await removeLines(ids), "remove"));
    },
    /** @returns {Promise<ShopifyCart | null>} */
    clear() {
      const ids = currentLines().map((line) => line.id);
      if (!ids.length) return Promise.resolve(currentCart());
      return Cart.removeLine(ids);
    },
    /**
     * @param {string | null | undefined} note
     * @returns {Promise<ShopifyCart | null>}
     */
    setNote(note) {
      const variables = { note: note ?? "" };
      return enqueue(
        async () => commit(
          await mutateCart({
            name: "cartNoteUpdate",
            args: "$note: String!",
            inner: "note: $note",
            variables,
            createInput: variables
          }),
          "note"
        )
      );
    },
    /**
     * Cart attributes, merged with the cart's (as it is when the change runs, so quick calls don't drop each other).
     *
     * @param {Attributes} attributes The value `''` removes a key.
     * @returns {Promise<ShopifyCart | null>}
     */
    setAttributes(attributes) {
      return enqueue(async () => {
        const variables = { attributes: mergedAttributes(attributes) };
        const cart = await mutateCart({
          name: "cartAttributesUpdate",
          args: "$attributes: [AttributeInput!]!",
          inner: "attributes: $attributes",
          variables,
          createInput: variables
        });
        return commit(cart, "attributes");
      });
    },
    /**
     * Replaces the discount codes; `[]` removes them all.
     *
     * @param {string[] | string | ((current: string[]) => string[])} codes
     * @returns {Promise<ShopifyCart | null>}
     */
    setDiscountCodes(codes) {
      return enqueue(async () => {
        const variables = { discountCodes: discountCodesFrom(codes) };
        const cart = await mutateCart({
          name: "cartDiscountCodesUpdate",
          args: "$discountCodes: [String!]!",
          inner: "discountCodes: $discountCodes",
          variables,
          createInput: variables
        });
        return commit(cart, "discount");
      });
    },
    /**
     * Adds a code. A code Shopify doesn't accept is removed again, so it doesn't warn on every later change.
     *
     * @param {string} code
     * @returns {Promise<ShopifyCart | null>}
     * @throws {TetherError} `INVALID_DISCOUNT` (rejected) when Shopify doesn't accept the code.
     */
    async applyDiscount(code) {
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
    /**
     * @param {string} code
     * @returns {Promise<ShopifyCart | null>}
     */
    removeDiscount(code) {
      const unwanted = code.toLowerCase();
      return Cart.setDiscountCodes((current) => current.filter((existing) => existing.toLowerCase() !== unwanted));
    },
    /**
     * Sets who is buying; a country changes the cart's currency and prices to that market's.
     *
     * @param {{ countryCode?: string, email?: string, phone?: string, customerAccessToken?: string | null }} buyerIdentity
     * @param {{ create?: boolean }} [options] `create: false` forgets an expired cart instead of creating an empty one.
     * @returns {Promise<ShopifyCart | null>}
     */
    setBuyerIdentity(buyerIdentity, { create = true } = {}) {
      return enqueue(async () => {
        const cart = await mutateCart({
          name: "cartBuyerIdentityUpdate",
          args: "$buyerIdentity: CartBuyerIdentityInput!",
          inner: "buyerIdentity: $buyerIdentity",
          variables: { buyerIdentity },
          createInput: create ? { buyerIdentity } : null
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

  // src/product.js
  var product_exports = {};
  __export(product_exports, {
    ProductScope: () => ProductScope,
    rememberOptionNames: () => rememberOptionNames,
    scopes: () => scopes
  });

  // src/product-state.js
  var MINOR_UNITS_PER_UNIT = 100;
  var PERCENT = 100;
  var toMinorUnits = (money) => Math.round(parseFloat(money.amount) * MINOR_UNITS_PER_UNIT);
  var fromMinorUnits = (minorUnits, currencyCode) => ({
    amount: (minorUnits / MINOR_UNITS_PER_UNIT).toFixed(2),
    currencyCode
  });
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
  function normalisePurchase(product, variant, wanted) {
    const plans = allPlans(product);
    const known = plans.find((plan) => plan.id === wanted.planId) ?? plans[0];
    if (!known) return { kind: "one-time", planId: null };
    const onVariant = allocationFor(variant, known.id) ? known : plans.find((plan) => allocationFor(variant, plan.id)) ?? known;
    if (product.requiresSellingPlan || wanted.kind === "subscription")
      return { kind: "subscription", planId: onVariant.id };
    return { kind: "one-time", planId: onVariant.id };
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
      purchase: normalisePurchase(product, start, { kind, planId: offered?.id ?? null })
    };
  }
  function showConditions(variant, lowStock, variantCount, sale, requiresSellingPlan) {
    const stock = variant.quantityAvailable;
    const low = stock != null && stock > 0 && stock <= lowStock;
    const onSale = sale.compareAtPrice !== null;
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
      "subscription-selected": sale.isSubscription,
      "one-time-selected": !sale.isSubscription,
      "has-savings": sale.isSubscription ? sale.savings.percentage > 0 : onSale
    };
  }
  function productView(product, choice, lowStock) {
    const exact = findVariant(product, choice.selected);
    const variant = exact ?? product.variants.nodes[0];
    if (!variant) return null;
    const purchase = normalisePurchase(product, variant, choice.purchase);
    const { planId } = purchase;
    const plans = allPlans(product);
    const allocation = purchase.kind === "subscription" ? allocationFor(variant, planId) : null;
    const price = allocation ? planPrice(variant, planId) ?? variant.price : variant.price;
    const compareAt = allocation?.priceAdjustments[0]?.compareAtPrice ?? variant.compareAtPrice;
    const sale = {
      isSubscription: allocation !== null,
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
    const planId = view.purchase.planId;
    const forQuantity = (money) => timesQuantity(money, Math.max(1, quantity));
    const checkoutCharge = () => {
      const charge = view.isSubscription ? planCheckoutCharge(variant, planId) ?? price : price;
      return format.money(forQuantity(charge));
    };
    const discountPercentage = () => {
      if (!compareAtPrice) return "0%";
      return `${Math.round((1 - parseFloat(price.amount) / parseFloat(compareAtPrice.amount)) * PERCENT)}%`;
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

  // src/product-render.js
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
    const metafield = (product.metafields ?? []).find((field) => field?.namespace === namespace && field.key === key);
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
    const text = PRODUCT_TEXTS.get(key);
    if (text) {
      setText(el, text(product));
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
      case "link":
        el.setAttribute("href", productUrl2(product.handle, product.id));
        if (key === "url" && !el.firstElementChild && !el.textContent.trim()) setText(el, product.title);
        break;
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
        const text = qsa(node, sel("bind", "option-value"))[0];
        if (text) setText(text, value.name);
        else if (!node.firstElementChild) setText(node, value.name);
        const swatchEl = qsa(node, sel("bind", "swatch"))[0];
        const swatch = (
          /** @type {Swatch} */
          value.swatch
        );
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

  // src/status.js
  var status_exports = {};
  __export(status_exports, {
    STATUS_KEYS: () => STATUS_KEYS,
    boundary: () => boundary,
    isNotFound: () => isNotFound,
    ownedBy: () => ownedBy,
    resolveProductKey: () => resolveProductKey,
    setScopeStatus: () => setScopeStatus
  });
  var URL_SOURCE = "url:";
  function decodePathSegment(segment) {
    try {
      return decodeURIComponent(segment);
    } catch (error) {
      if (error instanceof URIError) return segment;
      throw error;
    }
  }
  function resolveProductKey(el, location = window.location, name = "product") {
    const raw = (get(el, name) ?? "").trim();
    if (!raw.toLowerCase().startsWith(URL_SOURCE)) return { key: raw || null, fromUrl: false, raw };
    const source = raw.slice(URL_SOURCE.length).trim();
    let key;
    if (source.toLowerCase() === "path") {
      const segments = location.pathname.split("/").filter(Boolean);
      const segment = segments[segments.length - 1];
      key = segment === void 0 ? null : decodePathSegment(segment);
    } else {
      key = new URLSearchParams(location.search).get(source || "handle");
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

  // src/variant-render.js
  var FORMAT = { money: formatMoney2, percent: formatPercent };
  var isInput2 = (el) => el.tagName === "INPUT";
  function addButtonLabel(button) {
    const label = qsa(button, sel("add-label"))[0] ?? button;
    const original = label.dataset["tetherLabel"] ?? (isInput2(label) ? label.value : label.textContent);
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
        node.classList.toggle("is-unavailable", unavailable);
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
    const { variant, purchase, isSubscription } = view;
    scope.$(sel("purchase")).forEach((el) => {
      if (isSelect(el)) {
        el.value = purchase.kind;
        return;
      }
      const mode = get(el, "purchase");
      setSelected(el, mode === purchase.kind);
      const unavailable = mode === "subscription" ? !view.subscriptionAvailable : scope.product.requiresSellingPlan;
      el.classList.toggle("is-unavailable", unavailable);
    });
    scope.$(sel("plan-value")).forEach((node) => {
      const planId = get(node, "plan-value") ?? "";
      setSelected(node, isSubscription && planId === purchase.planId);
      node.classList.toggle("is-unavailable", !allocationFor(variant, planId));
      const plan = scope.plans.find((candidate) => candidate.id === planId);
      const texts = planBindTexts(variant, planId, plan, FORMAT);
      qsa(node, sel("plan-bind")).forEach((el) => {
        const text = texts.get(get(el, "plan-bind") ?? "");
        if (text) setText(el, text());
      });
    });
    selectsIn(scope, sel("plan")).forEach((select) => {
      select.value = isSubscription ? purchase.planId ?? "" : "";
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
      let text = original;
      if (view.isSubscription && subscribeText) text = subscribeText;
      if (disabled && soldOutText) text = soldOutText;
      if (button.getAttribute("aria-busy") !== "true") setText(label, text);
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
      const text = texts.get(key);
      if (text) setText(el, text());
    });
    renderOptionStates(scope, view);
    renderPurchaseStates(scope, view);
    renderConditions2(scope, view);
    scope.root.classList.toggle("is-subscription", view.isSubscription);
    scope.root.setAttribute(attr("purchase-mode"), view.isSubscription ? "subscription" : "one-time");
    renderAddButtons(scope, view);
  }

  // src/product-events.js
  var productSelector = () => sel("product");
  var isField = (el) => el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
  var isElement = (target) => target instanceof window.Element;
  function closestOwn(scope, target, selector) {
    const el = (
      /** @type {HTMLElement | null} */
      target.closest(selector)
    );
    return el?.closest(productSelector()) === scope.root ? el : null;
  }
  function onAddClick(scope, button) {
    const { label, original } = addButtonLabel(button);
    const addingText = get(button, "adding-text");
    void busy(button, async () => {
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
      scope.setPurchase(get(purchase, "purchase"));
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
      scope.setPurchase(value);
    } else if (target.matches(sel("qty"))) {
      scope.setQuantity(value);
    }
  }
  function bindProductEvents(scope) {
    scope.root.addEventListener("click", (event) => {
      if (isElement(event.target)) onClick(scope, event, event.target);
    });
    scope.root.addEventListener("change", (event) => {
      const { target } = event;
      if (isElement(target) && target.closest(productSelector()) === scope.root) onChange(scope, target);
    });
  }

  // src/product.js
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
  var isInput3 = (el) => el.tagName === "INPUT";
  var isField2 = (el) => el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
  function lineAttributeValue(el) {
    if (isInput3(el) && el.type === "checkbox") {
      if (!el.checked) return null;
      return el.value && el.value !== "on" ? el.value : "Yes";
    }
    if (isInput3(el) && el.type === "radio") return el.checked ? el.value : null;
    return isField2(el) && el.value || null;
  }
  var ProductScope = class {
    /**
     * @param {HTMLElement} root
     * @param {Product} product
     */
    constructor(root, product) {
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
      this.purchaseChoice = choice.purchase;
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
    /**
     * New data for the same product (a country switch). Keeps the visitor's choice.
     *
     * @param {Product} product
     */
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
    /**
     * @param {string} selector
     * @returns {HTMLElement[]} Matches in this scope, including the root itself (a card link with tether-bind="link").
     */
    $(selector) {
      const inner = scoped(this.root, selector, productSelector2());
      return this.root.matches(selector) ? [this.root, ...inner] : inner;
    }
    /**
     * @param {string | null} authored An option name in the markup.
     * @returns {string} The product's option of that name, or at that position in the build's language.
     */
    optName(authored) {
      if (!authored) return "";
      const { options } = this.product;
      if (options.some((option) => option.name === authored)) return authored;
      const index = (knownOptionNames.get(this.product.handle) ?? []).indexOf(authored);
      return options[index]?.name ?? authored;
    }
    /** @returns {'one-time' | 'subscription'} */
    get purchase() {
      return this.purchaseChoice.kind;
    }
    /** @param {string} kind */
    set purchase(kind) {
      const wanted = kind === "subscription" ? "subscription" : "one-time";
      this.purchaseChoice = normalisePurchase(this.product, this.variant, { kind: wanted, planId: this.planId });
    }
    /** @returns {string | null} The plan bought on, or offered while buying once. */
    get planId() {
      return this.purchaseChoice.planId;
    }
    /** @param {string | null} planId */
    set planId(planId) {
      this.purchaseChoice = normalisePurchase(this.product, this.variant, { kind: this.purchase, planId });
    }
    /** @returns {PlanInGroup | null} */
    get plan() {
      return this.plans.find((plan) => plan.id === this.planId) ?? null;
    }
    /** True when the current variant can be bought on a plan. */
    get subscriptionAvailable() {
      return this.plans.some((plan) => allocationFor(this.variant, plan.id));
    }
    get isSubscription() {
      return this.purchase === "subscription" && allocationFor(this.variant, this.planId) !== null;
    }
    /** @returns {CartLineInput | null} What would be added to the cart right now. */
    getLine() {
      if (!this.variant) return null;
      const line = { merchandiseId: this.variant.id, quantity: this.quantity };
      if (this.isSubscription && this.planId) line.sellingPlanId = this.planId;
      const attributes = this.collectAttributes();
      if (attributes.length) line.attributes = attributes;
      return line;
    }
    /** @returns {{ key: string, value: string }[]} `tether-line-attributes` and the filled `tether-line-attribute` fields. */
    collectAttributes() {
      const json = (
        /** @type {Parameters<typeof toAttributes>[0]} */
        parseJSONAttr(this.root, "line-attributes")
      );
      const fixed = toAttributes(json);
      const fields = this.$(sel("line-attribute")).flatMap((el) => {
        const value = lineAttributeValue(el);
        return value === null ? [] : [{ key: get(el, "line-attribute") ?? "", value }];
      });
      return [...fixed, ...fields];
    }
    /**
     * Selects an option value. A combination no variant has moves to the closest variant with the value: the most other
     * choices kept, then one for sale.
     *
     * @param {string} name
     * @param {string} value
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
    /** @param {string} id A variant gid or numeric id. */
    selectVariant(id) {
      const variant = this.product.variants.nodes.find((candidate) => candidate.id === GID.variant(id));
      if (!variant) return;
      this.selected = selectionOf(variant);
      this.renderVariant();
    }
    /** @param {string | null} mode `subscription`, else buying once. */
    setPurchase(mode) {
      const kind = mode === "subscription" ? "subscription" : "one-time";
      const next = normalisePurchase(this.product, this.variant, { kind, planId: this.planId });
      if (next.kind === this.purchase) return;
      this.purchaseChoice = next;
      this.renderVariant();
    }
    /** @param {string | null} ref A plan id, numeric id, name or option value. */
    selectPlan(ref) {
      const plan = findPlan(this.product, ref);
      if (!plan) return;
      this.purchaseChoice = { kind: "subscription", planId: plan.id };
      this.renderVariant();
    }
    /** @param {number | string} quantity */
    setQuantity(quantity) {
      const minimum = has(this.root, "quantity") ? 0 : 1;
      this.quantity = Math.max(minimum, parseInt(String(quantity), 10) || 0);
      this.$(sel("qty")).forEach((el) => {
        setText(el, this.quantity);
      });
      this.renderVariant();
    }
    /** @returns {Promise<unknown>} The cart after adding; `null` when the variant can't be added. */
    async addToCart() {
      if (!this.variant?.availableForSale) return null;
      const line = this.getLine();
      if (!line || line.quantity < 1) return null;
      const cart = await Cart.add(line);
      emit("product-added", { product: this.product, variant: this.variant, line }, this.root);
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
        { selected: this.selected, purchase: this.purchaseChoice, quantity: this.quantity },
        cfg.lowStock
      );
      if (!view) {
        this.variant = null;
        return;
      }
      this.variant = view.variant;
      this.selected = view.selected;
      this.purchaseChoice = view.purchase;
      writeVariant(this, view);
      emit(
        "variant-changed",
        {
          product: this.product,
          variant: view.variant,
          selected: { ...view.selected },
          purchase: view.purchase.kind,
          sellingPlanId: view.isSubscription ? view.purchase.planId : null
        },
        this.root
      );
    }
  };

  // src/collection.js
  var collection_exports = {};
  __export(collection_exports, {
    ListScope: () => ListScope,
    listSelector: () => listSelector
  });
  var URL_QUERY_SOURCE = "url:";
  var listSelector = () => `${sel("collection")},${sel("products")},${sel("recommendations")}`;
  var isElement2 = (target) => target instanceof window.Element;
  var toLimit = (raw) => parseInt(raw ?? "", 10) || void 0;
  var toIntent = (raw) => raw === "COMPLEMENTARY" ? "COMPLEMENTARY" : "RELATED";
  var ListScope = class {
    /** @param {HTMLElement} root */
    constructor(root) {
      this.root = root;
      this.products = [];
      this.pageInfo = null;
      this.collection = null;
      this.loadToken = 0;
      setScopeStatus(root, "loading");
      root.addEventListener("click", (event) => {
        if (!isElement2(event.target)) return;
        const more = event.target.closest(sel("load-more"));
        if (more?.closest(listSelector()) !== root) return;
        event.preventDefault();
        void busy(more, () => this.load(true));
      });
    }
    /** @param {string} selector */
    $(selector) {
      return scoped(this.root, selector, listSelector());
    }
    /** @returns {ProductQuery} The collection or search query of the list's attributes. */
    options() {
      const { root } = this;
      const query = { reverse: get(root, "reverse") === "true" };
      const first = toLimit(get(root, "limit"));
      if (first) query.first = first;
      const sortKey = get(root, "sort");
      if (sortKey) query.sortKey = sortKey;
      if (has(root, "collection")) {
        query.collection = get(root, "collection") ?? "";
        return query;
      }
      const raw = get(root, "products") ?? "";
      query.query = raw.startsWith(URL_QUERY_SOURCE) ? new URL(window.location.href).searchParams.get(raw.slice(URL_QUERY_SOURCE.length)) || "" : raw;
      return query;
    }
    /**
     * The product of a recommendations list: a handle, `url:…` (one dynamic product page), or empty inside a product
     * scope for that product.
     *
     * @returns {Promise<Product[]>}
     * @throws {TetherError} `NOT_FOUND` when there is no product to recommend for.
     */
    async loadRecommendations() {
      let { key } = resolveProductKey(this.root, window.location, "recommendations");
      const scope = this.root.closest(sel("product"));
      if (!key && scope) ({ key } = resolveProductKey(scope));
      if (!key) throw new TetherError("No product for recommendations", { code: "NOT_FOUND" });
      return getRecommendations(key, toIntent(get(this.root, "intent")));
    }
    /** @param {boolean} [more] Appends the next page instead of replacing the products. */
    async load(more = false) {
      this.loadToken += 1;
      const token = this.loadToken;
      const stale2 = () => token !== this.loadToken;
      try {
        if (has(this.root, "recommendations")) {
          const recommendations = await this.loadRecommendations();
          if (stale2()) return;
          const limit = toLimit(get(this.root, "limit"));
          this.products = limit ? recommendations.slice(0, limit) : recommendations;
        } else {
          const page = await getProducts({ ...this.options(), after: more ? this.pageInfo?.endCursor ?? null : null });
          if (stale2()) return;
          this.collection = page.collection;
          this.pageInfo = page.pageInfo;
          this.products = more ? [...this.products, ...page.products] : page.products;
        }
        this.render();
        setScopeStatus(this.root, "ready");
        emit("list-ready", { products: this.products, collection: this.collection }, this.root);
      } catch (error) {
        if (stale2()) return;
        if (!more) setScopeStatus(this.root, isNotFound(error) ? "not-found" : "error", error);
        if (!(isNotFound(error) && has(this.root, "recommendations"))) reportError(error, "list load failed");
        emit("error", { error, context: "list" }, this.root);
      }
    }
    render() {
      const { collection } = this;
      this.$(sel("collection-bind")).forEach((el) => {
        switch (get(el, "collection-bind") ?? "") {
          case "title":
            setText(el, collection?.title ?? "");
            break;
          case "description":
            setStoreHtml(el, collection?.descriptionHtml);
            break;
          case "image":
            setImage(el, collection?.image?.url, collection?.image?.altText || collection?.title);
            break;
          case "count":
            setText(el, this.products.length);
            break;
        }
      });
      this.$(sel("list")).forEach((container) => {
        repeat(container, this.products, (node, product) => {
          node.setAttribute(attr("product"), product.handle);
          node.removeAttribute(attr("state"));
        });
        emit("list-rendered", { container }, this.root);
      });
      const empty = this.products.length === 0;
      this.$(sel("show")).forEach((el) => {
        const key = get(el, "show");
        if (key === "list-empty") show(el, empty);
        if (key === "list-filled") show(el, !empty);
      });
      this.$(sel("load-more")).forEach((el) => {
        show(el, Boolean(this.pageInfo?.hasNextPage));
      });
      notifyLayoutChanged("list");
    }
  };

  // src/mounting.js
  var mounting_exports = {};
  __export(mounting_exports, {
    hydrateFromPage: () => hydrateFromPage,
    liveLists: () => liveLists,
    liveProducts: () => liveProducts,
    mountProduct: () => mountProduct,
    mountedLists: () => mountedLists,
    mountedProducts: () => mountedProducts,
    pruneLive: () => pruneLive,
    retryFailed: () => retryFailed,
    settleMarket: () => settleMarket,
    trackMarket: () => trackMarket,
    within: () => within
  });
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
    const self = root.matches?.(selector) ? [
      /** @type {HTMLElement} */
      root
    ] : [];
    return [...self, ...qsa(root, selector)];
  }
  function applyPageTitle(el, product) {
    const template = get(el, "page-title");
    if (!template || typeof document === "undefined") return;
    document.title = template.replace(/\{title\}/g, product.title).replace(/\{vendor\}/g, product.vendor || "").replace(/\{type\}/g, product.productType || "");
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
    refreshProducts(keys).forEach((promise, index) => {
      const key = (
        /** @type {string} */
        keys[index]
      );
      promise.then((fresh) => {
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
  var isUsable = (product) => Boolean(product?.id && product.handle);
  var sameCode = (a, b) => (a ?? "").toUpperCase() === (b ?? "").toUpperCase();
  var readScripts = /* @__PURE__ */ new WeakSet();
  function hydrateFromPage(root = document) {
    qsa(root.ownerDocument ?? root, HYDRATE_SELECTOR).forEach((script) => {
      if (readScripts.has(script)) return;
      readScripts.add(script);
      let json;
      try {
        json = JSON.parse(script.textContent);
      } catch (error) {
        warn("bad data-tether-hydrate", error);
        return;
      }
      const { country, language, products } = (
        /** @type {HydratePayload | null} */
        json ?? {}
      );
      const usable = Array.isArray(products) ? products.filter(isUsable) : [];
      rememberOptionNames(usable);
      if (sameCode(country, cfg.country) && sameCode(language, cfg.language)) {
        hydrateProducts(usable);
        return;
      }
      log("hydration skipped: other market");
      if (!marketPending) {
        marketPending = /* @__PURE__ */ new Set();
        document.documentElement.classList.add(`${cfg.prefix}-market-pending`);
      }
    });
  }

  // src/lazy-iife.js
  var { cfg: cfg2 } = config_exports;
  var coreModules = {
    "config.js": config_exports,
    "client.js": client_exports,
    "dom.js": dom_exports,
    "fragments.js": fragments_exports,
    "loader.js": loader_exports,
    "selling-plans.js": selling_plans_exports,
    "status.js": status_exports,
    "cart.js": cart_exports,
    "product.js": product_exports,
    "collection.js": collection_exports,
    "mounting.js": mounting_exports,
    "market-codes.js": market_codes_exports,
    "shopify-values.js": shopify_values_exports,
    "store-html.js": store_html_exports
  };
  var MINIFIED_SCRIPT = /\.min\.js(\?|$)/;
  var coreScript = typeof document === "undefined" ? "" : document.currentScript?.getAttribute("src") ?? "";
  var coreScriptUrl = coreScript ? new URL(coreScript, document.baseURI).href : "";
  var parts = /* @__PURE__ */ new Map();
  function partsFolder() {
    if (!cfg2.partsUrl) return coreScriptUrl.replace(/[^/]*$/, "");
    const folder = new URL(cfg2.partsUrl, document.baseURI);
    if (folder.protocol !== "https:" && folder.origin !== window.location.origin) {
      throw new Error(`partsUrl must be https or on this site: ${folder.href}`);
    }
    return folder.href;
  }
  function loadScript(name, url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = () => {
        const { Tether } = (
          /** @type {Window & { Tether?: { __parts?: Record<string, unknown> } }} */
          window
        );
        const part = Tether?.__parts?.[name];
        if (part) resolve(part);
        else reject(new Error(`${url} did not register`));
      };
      script.onerror = () => {
        parts.delete(name);
        reject(new Error(`Could not load ${url}. Host it next to the Tether script, or set partsUrl.`));
      };
      document.head.appendChild(script);
    });
  }
  function loadPart(name) {
    let loading = parts.get(name);
    if (!loading) {
      let folder;
      try {
        folder = partsFolder();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      const suffix = MINIFIED_SCRIPT.test(coreScriptUrl) || !coreScriptUrl ? ".min" : "";
      loading = loadScript(name, `${folder.replace(/\/?$/, "/")}tether.${name}${suffix}.js`);
      parts.set(name, loading);
    }
    return (
      /** @type {Promise<Parts[Name]>} */
      loading
    );
  }
  coreModules["lazy.js"] = { loadPart, coreModules };

  // src/markets.js
  var storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;
  function localStorageIfAllowed() {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
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

  // src/page-market.js
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
  var sameCode2 = (a, b) => (a ?? "").toUpperCase() === (b ?? "").toUpperCase();
  function marketForArrival() {
    const page = pageMarket();
    const leftOwnMarket = page === null && lastPageHadOwnMarket;
    lastPageHadOwnMarket = page !== null;
    const target = page ?? (leftOwnMarket ? readSavedMarket() ?? configuredMarket : null);
    if (!target?.country) return null;
    if (sameCode2(target.country, cfg.country) && sameCode2(target.language, cfg.language)) return null;
    return { country: target.country, language: target.language, locale: target.locale };
  }
  function setCountry(code, options) {
    return loadPart("markets").then((part) => part.setCountry(code, options));
  }

  // src/account-api.js
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
  function hasSavedSession() {
    const sessionKey = `${cfg.prefix}:account:${cfg.domain}`;
    const hintKey = `${cfg.prefix}:account-hint:${cfg.domain}`;
    try {
      return Boolean(
        sessionStorage.getItem(sessionKey) || localStorage.getItem(sessionKey) || localStorage.getItem(hintKey)
      );
    } catch {
      return false;
    }
  }
  function mountAccountIfUsed(root) {
    if (!cfg.account?.clientId && !cfg.account?.server) return;
    const needed = within(root, accountSelector()).length > 0 || /[?&]code=/.test(window.location.search) || hasSavedSession();
    if (!needed) return;
    loadPart("account").then((part) => part.mountAccount(root)).catch((error) => {
      reportError(error, "account");
    });
  }
  function fromPart(name) {
    return (...args) => loadPart("account").then((part) => {
      const call = (
        /**
         * @type {(...callArgs: Parameters<AccountPart[Name]>) => AccountResult<Name> | PromiseLike<AccountResult<Name>>}
         */
        part[name]
      );
      return call(...args);
    });
  }
  var accountApi = {
    login: fromPart("login"),
    logout: fromPart("logout"),
    handleCallback: fromPart("handleCallback"),
    getToken: fromPart("getToken"),
    isLoggedIn: fromPart("isLoggedIn"),
    query: fromPart("query"),
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

  // src/controls/cart-controls.js
  var lineKeyAttribute = () => `data-${cfg.prefix}-key`;
  var isElement3 = (target) => target instanceof window.Element;
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
    if (!isElement3(target)) return;
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
  function onChange2(event) {
    const { target } = event;
    if (!isElement3(target)) return;
    const found = lineOf(target);
    if (found && target instanceof window.HTMLInputElement && target.matches(sel("line", "quantity"))) {
      showLineBusy(found.line, Cart.updateLine(found.id, parseInt(target.value, 10) || 0), "cart line");
    } else if (found && target instanceof window.HTMLSelectElement && target.matches(sel("line-plan"))) {
      showLineBusy(found.line, Cart.updateLine(found.id, { sellingPlanId: target.value || null }), "cart line plan");
    } else if (hasValue(target) && target.matches(sel("cart-note"))) {
      reportFailure(Cart.setNote(target.value), "cart note");
    }
  }
  var hasValue = (target) => target instanceof window.HTMLInputElement || target instanceof window.HTMLTextAreaElement || target instanceof window.HTMLSelectElement;
  function onKeydown(event) {
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
    document.addEventListener("keydown", onKeydown);
  }

  // src/controls/discount.js
  var isElement4 = (target) => target instanceof window.Element;
  function codeInputOf(form) {
    const input = form.querySelector(sel("discount-input")) ?? form.querySelector("input");
    return input instanceof window.HTMLInputElement ? input : null;
  }
  function markInvalid(form, input, invalid) {
    form.classList.toggle("is-invalid", invalid);
    if (invalid) input?.setAttribute("aria-invalid", "true");
    else input?.removeAttribute("aria-invalid");
  }
  async function applyCode(form, input, code) {
    try {
      await Cart.applyDiscount(code);
      markInvalid(form, input, false);
      emit("discount-applied", { code }, form);
      if (input) input.value = "";
    } catch (error) {
      markInvalid(form, input, true);
      if (error instanceof TetherError && error.code === "INVALID_DISCOUNT") emit("discount-invalid", { code }, form);
      else reportError(error, "discount");
    }
  }
  function onSubmit(event) {
    const { target } = event;
    const form = isElement4(target) ? target.closest(sel("discount-form")) : null;
    if (!form) return;
    event.preventDefault();
    const input = codeInputOf(form);
    const code = input?.value.trim();
    if (!code) return;
    void busy(form, () => applyCode(form, input, code));
  }
  function onInput(event) {
    const { target } = event;
    if (!isElement4(target)) return;
    const form = target.closest(sel("discount-form"));
    if (!form) return;
    form.classList.remove("is-invalid");
    target.removeAttribute("aria-invalid");
  }
  function onClick3(event) {
    const { target } = event;
    const remove = isElement4(target) ? target.closest(sel("discount-remove")) : null;
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

  // src/controls/extras.js
  var addGroup = (button) => loadPart("extras").then((part) => part.addGroup(button));
  var reportExtrasError = (error) => {
    reportError(error, "extras");
  };
  function onClick4(event) {
    const { target } = event;
    const button = target instanceof window.Element ? target.closest(sel("group-add")) : null;
    if (!button) return;
    event.preventDefault();
    busy(button, () => addGroup(button)).catch(reportExtrasError);
  }
  function onStorage(event) {
    if (!cfg.domain || !event.key?.startsWith(`${cfg.prefix}:`)) return;
    loadPart("extras").then((part) => {
      part.onStorage(event);
    }).catch(reportExtrasError);
  }
  function onVariantChanged(event) {
    const { target } = event;
    if (!(target instanceof window.Element)) return;
    if (!cfg.variantUrl && !target.hasAttribute(attr("variant-url"))) return;
    loadPart("extras").then((part) => {
      part.writeVariantUrl(target, event.detail);
    }).catch(reportExtrasError);
  }
  function bindExtrasControls() {
    document.addEventListener("click", onClick4);
    window.addEventListener("storage", onStorage);
    document.addEventListener(
      `${cfg.prefix}:variant-changed`,
      /** @type {EventListener} */
      onVariantChanged
    );
  }

  // src/controls/navigation.js
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
      void onPageLoad(hooks);
    });
    document.addEventListener("astro:before-swap", () => {
      mountedBody = null;
      hooks.unmount();
    });
  }
  function onChange3(event) {
    const { target } = event;
    if (!(target instanceof window.HTMLSelectElement) || !target.matches(sel("country-select"))) return;
    if (!target.value) return;
    setCountry(target.value).catch((error) => {
      reportError(error, "country");
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
    document.addEventListener("change", onChange3);
    window.addEventListener("online", onOnline);
  }

  // src/index.js
  var VERSION = "0.6.8";
  var ANALYTICS_EVENTS = ["product-ready", "list-ready", "cart-updated", "cart-toggled", "checkout", "search"];
  var OBSERVE_DEBOUNCE_MS = 50;
  var pageGlobals = () => window;
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
      const list = new ListScope(el);
      liveLists.add(list);
      el.addEventListener(`${cfg.prefix}:list-rendered`, (event) => {
        mount(
          /** @type {CustomEvent<{ container: ParentNode }>} */
          event.detail.container
        );
      });
      void trackMarket(list.load());
    });
    return count;
  }
  function mountParts(root) {
    if (within(root, `${sel("country-select")},${sel("country-bind")}`).length) {
      loadPart("markets").then((part) => part.renderCountrySelects(root)).catch((error) => {
        reportError(error, "markets");
      });
    }
    mountAccountIfUsed(root);
    if (within(root, sel("search")).length) {
      loadPart("search").then((part) => {
        part.mountSearch(root);
      }).catch((error) => {
        reportError(error, "search");
      });
    }
  }
  function mount(root = document) {
    if (!isConfigured()) return 0;
    if (root === document) rememberDocumentMount();
    pruneLive();
    hydrateFromPage(root.ownerDocument ?? document);
    let count = mountLists(root);
    within(root, sel("product")).forEach((el) => {
      if (mountProduct(el)) count++;
    });
    mountParts(root);
    settleMarket();
    Cart.render();
    log(`mounted ${count} scope(s)`, root);
    return count;
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
  function startAnalyticsQueue() {
    const queue = [];
    analyticsQueue = queue;
    ANALYTICS_EVENTS.forEach((name) => {
      document.addEventListener(`${cfg.prefix}:${name}`, (event) => queue.push(event));
    });
    document.addEventListener("astro:page-load", () => queue.push(new CustomEvent(`${cfg.prefix}:page`)));
    loadPart("analytics").then((part) => part.startAnalytics(queue)).catch((error) => {
      reportError(error, "analytics");
    });
  }
  async function cartInPageMarket(cart) {
    const country = cfg.country?.toUpperCase();
    const cartCountry = cart?.buyerIdentity.countryCode;
    if (!cart || !country || !cartCountry || cartCountry === country) return cart;
    try {
      return await Cart.setBuyerIdentity({ countryCode: country }, { create: false });
    } catch (error) {
      reportError(error, "cart country");
      return cart;
    }
  }
  function init2(overrides = {}) {
    if (initPromise && !Object.keys(overrides).length) return initPromise;
    configure({ ...pageGlobals().TETHER_CONFIG, ...overrides });
    if (!isConfigured()) {
      warn("TETHER_CONFIG is missing domain or token. Tether is idle.");
      initPromise = Promise.resolve(null);
      return initPromise;
    }
    bindControls();
    if (cfg.observe) startObserver();
    if (cfg.analytics && !analyticsQueue) startAnalyticsQueue();
    initPromise = applyStartMarket(overrides).then(() => Cart.init()).then(cartInPageMarket).then((cart) => {
      emit("ready", { cart });
      return api;
    });
    return initPromise;
  }
  function startObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    let timer;
    const queued = /* @__PURE__ */ new Set();
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof window.Element) queued.add(node);
        });
      });
      clearTimeout(timer);
      timer = setTimeout(() => {
        queued.forEach((node) => {
          if (node.isConnected) mount(node);
        });
        queued.clear();
      }, OBSERVE_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  var detectMarket = (markets) => loadPart("markets").then((part) => part.detectMarket(markets ?? cfg.markets));
  var getLocalization = () => loadPart("markets").then((part) => part.getLocalization());
  var diagnose = (options) => loadPart("diagnose").then((part) => part.diagnose({ ...options, version: VERSION }));
  function on(name, listener) {
    const handler = (event) => {
      const custom = (
        /** @type {CustomEvent} Tether's events are CustomEvents. */
        event
      );
      listener(custom.detail, custom);
    };
    document.addEventListener(`${cfg.prefix}:${name}`, handler);
    return () => {
      document.removeEventListener(`${cfg.prefix}:${name}`, handler);
    };
  }
  var api = {
    VERSION,
    init: init2,
    mount,
    unmount,
    /** @returns {TetherConfig} */
    get config() {
      return cfg;
    },
    /** @returns {Promise<TetherApi | null>} */
    get ready() {
      return initPromise ?? Promise.resolve(null);
    },
    query: gql,
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
    __core: coreModules,
    // The `<script>` build's parts register here when their file has loaded.
    __parts: (
      /** @type {Record<string, unknown>} */
      {}
    ),
    on
  };
  var index_default = api;
  function autoStart() {
    const globals = pageGlobals();
    globals.Tether = api;
    if (!globals.TETHER_CONFIG || globals.TETHER_CONFIG.autoMount === false || globals.TETHER_INTEGRATION) return;
    const start = () => {
      init2().then(() => mount(document)).catch((error) => {
        reportError(error, "init");
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") autoStart();
})();
