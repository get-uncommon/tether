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
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, warn } = m;

  // tether-core:dom.js
  var m2 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, dataKey, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, readText, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setText, setTextTracked, show, toAttributes, watchImages } = m2;

  // tether-core:product.js
  var m3 = window.Tether.__core["product.js"];
  var { ProductScope, rememberOptionNames, scopes } = m3;

  // tether-core:cart.js
  var m4 = window.Tether.__core["cart.js"];
  var { Cart, focusables, toLineInput } = m4;

  // src/extras.js
  async function addGroup(btn) {
    const group = btn.closest(sel("group"));
    if (!group) return null;
    const name = get(group, "group");
    const extra = toAttributes(parseJSONAttr(group, "line-attributes"));
    const groupAttrs = name ? [{ key: "_group", value: name }, ...extra] : extra;
    const lines = qsa(group, sel("product")).map((el) => scopes.get(el)).filter((s) => s && s.variant?.availableForSale && s.quantity > 0).map((s) => {
      const l = s.getLine();
      l.attributes = [...l.attributes || [], ...groupAttrs];
      return l;
    });
    if (!lines.length) {
      warn("group-add: nothing selected");
      return null;
    }
    try {
      const cart = await Cart.add(lines);
      emit("group-added", { group: name, lines }, group);
      return cart;
    } catch (err) {
      reportError(err, "group add");
      return null;
    }
  }
  function onStorage(e) {
    if (e.key === cfg.storageKey || e.key === `${cfg.storageKey}:seen`) Cart.init();
    else if (e.key === `${cfg.prefix}:market:${cfg.domain}` && e.newValue) {
      try {
        const m5 = JSON.parse(e.newValue);
        if (m5?.country) window.Tether?.setCountry(m5.country, { language: m5.language ?? null, locale: m5.locale, remember: false }).catch(() => {
        });
      } catch {
      }
    }
  }
  var urlKeys = /* @__PURE__ */ new WeakMap();
  function writeVariantUrl(root, { variant, sellingPlanId }) {
    const key = `${variant.id}|${sellingPlanId || ""}`;
    const before = urlKeys.get(root);
    urlKeys.set(root, key);
    if (!before || before === key) return;
    if (!has(root, "variant-url") && !(cfg.variantUrl && document.querySelector(sel("product")) === root)) return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("variant", variant.id.split("/").pop());
      if (sellingPlanId) u.searchParams.set("selling_plan", sellingPlanId.split("/").pop());
      else u.searchParams.delete("selling_plan");
      window.history.replaceState(window.history.state, "", u);
    } catch {
    }
  }

  // src/parts/extras.js
  window.Tether.__parts.extras = extras_exports;
})();
