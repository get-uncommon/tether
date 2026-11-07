(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/extras.ts
  var extras_exports = {};
  __export(extras_exports, {
    addGroup: () => addGroup,
    onStorage: () => onStorage,
    writeVariantUrl: () => writeVariantUrl
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:dom.ts
  var m2 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, busy, emit, formatDate, formatMoney, get, has, hasTemplate, isOwnEvent, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, scoped, sel, setImage, setStoreHtml, setText, show] = m2;

  // tether-core:product.ts
  var m3 = window.Tether.__core["product.ts"];
  var [scopes] = m3;

  // tether-core:cart.ts
  var m4 = window.Tether.__core["cart.ts"];
  var [Cart] = m4;

  // tether-core:page-market.ts
  var m5 = window.Tether.__core["page-market.ts"];
  var [setCountry] = m5;

  // tether-core:market-codes.ts
  var m6 = window.Tether.__core["market-codes.ts"];
  var [toCountry, toLanguage] = m6;

  // src/markets.ts
  var storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;
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

  // src/extras.ts
  function groupAttributes(group, name) {
    const extra = attributesFromJson(parseJSONAttr(group, "line-attributes"));
    return name ? [{ key: "_group", value: name }, ...extra] : extra;
  }
  async function addGroup(button) {
    const group = button.closest(sel("group"));
    if (!group) return null;
    const name = get(group, "group");
    const attributes = groupAttributes(group, name);
    const lines = qsa(group, sel("product")).flatMap((el) => {
      const scope = scopes.get(el);
      if (!scope?.variant?.availableForSale || scope.quantity <= 0) return [];
      const line = scope.getLine();
      return line ? [{ ...line, attributes: [...line.attributes ?? [], ...attributes] }] : [];
    });
    if (!lines.length) {
      warn("group-add: nothing selected");
      return null;
    }
    try {
      const cart = await Cart.add(lines);
      emit("group-added", { group: name, lines }, group);
      return cart;
    } catch (error) {
      reportError(error, "group add");
      return null;
    }
  }
  function onStorage(event) {
    if (event.key === cfg.storageKey || event.key === `${cfg.storageKey}:seen`) {
      Cart.init().catch((error) => {
        reportError(error, "cart from another tab");
      });
      return;
    }
    if (event.key !== storageKey() || !event.newValue) return;
    const market = parseSavedMarket(event.newValue);
    if (!market) return;
    const options = { language: market.language ?? null, locale: market.locale, remember: false };
    setCountry(market.country, options).catch((error) => {
      reportError(error, "market from another tab");
    });
  }
  var urlKeys = /* @__PURE__ */ new WeakMap();
  var numericId = (gid) => gid.split("/").pop() ?? gid;
  function replaceUrlIfAllowed(url) {
    try {
      window.history.replaceState(window.history.state, "", url);
    } catch {
    }
  }
  function writeVariantUrl(root, { variant, sellingPlanId }) {
    const key = `${variant.id}|${sellingPlanId ?? ""}`;
    const before = urlKeys.get(root);
    urlKeys.set(root, key);
    if (!before || before === key) return;
    const isMainProduct = cfg.variantUrl && document.querySelector(sel("product")) === root;
    if (!has(root, "variant-url") && !isMainProduct) return;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", numericId(variant.id));
    if (sellingPlanId) url.searchParams.set("selling_plan", numericId(sellingPlanId));
    else url.searchParams.delete("selling_plan");
    replaceUrlIfAllowed(url);
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

  // src/parts/extras.ts
  registerPart("extras", extras_exports);
})();
