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
  var [ANALYTICS_EVENTS, attr, attributesFromJson, emit, formatDate, formatMoney, get, has, hasTemplate, isOwnEvent, parseJSONAttr, productUrl, qsa, repeat, sel, setImage, setText, show] = m2;

  // tether-core:product.ts
  var m3 = window.Tether.__core["product.ts"];
  var [scopes] = m3;

  // tether-core:cart.ts
  var m4 = window.Tether.__core["cart.ts"];
  var [Cart] = m4;

  // server/src/shared/json.ts
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

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
  function parseStoredMarket(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    if (!isRecord(value)) return null;
    const { country, language, locale } = value;
    if (typeof country !== "string" || !country) return null;
    return {
      country,
      language: typeof language === "string" ? language : null,
      locale: typeof locale === "string" ? locale : void 0
    };
  }
  function onStorage(event) {
    if (event.key === cfg.storageKey || event.key === `${cfg.storageKey}:seen`) {
      Cart.init().catch((error) => {
        reportError(error, "cart from another tab");
      });
      return;
    }
    if (event.key !== `${cfg.prefix}:market:${cfg.domain}` || !event.newValue) return;
    const market = parseStoredMarket(event.newValue);
    const tether = Reflect.get(window, "Tether");
    if (!market || !tether) return;
    const options = { language: market.language, locale: market.locale, remember: false };
    tether.setCountry(market.country, options).catch((error) => {
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

  // src/parts/extras.ts
  var { Tether } = window;
  if (!Tether) throw new Error("tether.extras.js runs after the Tether script, which loads it");
  Tether.__parts.extras = extras_exports;
})();
