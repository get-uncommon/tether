"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/extras.js
  var extras_exports = {};
  __export(extras_exports, {
    addGroup: () => addGroup,
    onStorage: () => onStorage,
    writeVariantUrl: () => writeVariantUrl
  });

  // tether-core:config.js
  var m = window.Tether.__core["config.js"];
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, resolveConfig, toMetafieldIdentifier, warn } = m;

  // tether-core:dom.js
  var m2 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setStoreHtml, setText, setTextTracked, show, toAttributes, watchImages } = m2;

  // tether-core:product.js
  var m3 = window.Tether.__core["product.js"];
  var { ProductScope, rememberOptionNames, scopes } = m3;

  // tether-core:cart.js
  var m4 = window.Tether.__core["cart.js"];
  var { Cart, trapFocus } = m4;

  // src/extras.js
  function groupAttributes(group, name) {
    const extra = toAttributes(
      /** @type {Parameters<typeof toAttributes>[0]} */
      parseJSONAttr(group, "line-attributes")
    );
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
    if (typeof value !== "object" || value === null) return null;
    const { country, language, locale } = (
      /** @type {Record<string, unknown>} */
      value
    );
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
    const { Tether: Tether2 } = (
      /** @type {Window & { Tether?: { setCountry: SetCountry } }} */
      window
    );
    if (!market || !Tether2) return;
    const options = { language: market.language, locale: market.locale, remember: false };
    Tether2.setCountry(market.country, options).catch((error) => {
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

  // src/parts/extras.js
  var { Tether } = (
    /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */
    window
  );
  if (!Tether) throw new Error("tether.extras.js runs after the Tether script, which loads it");
  Tether.__parts["extras"] = extras_exports;
})();
