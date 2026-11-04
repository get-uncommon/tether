(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/analytics.js
  var analytics_exports = {};
  __export(analytics_exports, {
    startAnalytics: () => startAnalytics
  });

  // tether-core:config.js
  var m = window.Tether.__core["config.js"];
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, warn } = m;

  // tether-core:client.js
  var m2 = window.Tether.__core["client.js"];
  var { TetherError, endpoint, gql, request, unwrap, withContext } = m2;

  // tether-core:dom.js
  var m3 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, dataKey, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, readText, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setText, setTextTracked, show, toAttributes, watchImages } = m3;

  // tether-core:cart.js
  var m4 = window.Tether.__core["cart.js"];
  var { Cart, focusables, toLineInput } = m4;

  // src/analytics.js
  var num = (m5) => m5 ? parseFloat(m5.amount) : 0;
  var id = (gid) => String(gid || "").split("/").pop();
  function itemFromVariant(p, v, quantity = 1, index) {
    return {
      item_id: v?.sku || id(v?.id) || id(p.id),
      item_name: p.title,
      item_variant: v?.title === "Default Title" ? void 0 : v?.title,
      item_brand: p.vendor || void 0,
      item_category: p.productType || void 0,
      price: num(v?.price || p.priceRange?.minVariantPrice),
      quantity,
      ...index != null ? { index } : {}
    };
  }
  function itemFromLine(l, quantity = l.quantity) {
    const m5 = l.merchandise || {};
    return itemFromVariant({ ...m5.product || {}, title: m5.product?.title }, m5, quantity);
  }
  var value = (items) => Math.round(items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0) * 100) / 100;
  function ga(event, ecommerce) {
    const name = typeof cfg.analytics.dataLayer === "string" ? cfg.analytics.dataLayer : "dataLayer";
    const dl = window[name] = window[name] || [];
    if (ecommerce) dl.push({ ecommerce: null });
    dl.push(ecommerce ? { event, ecommerce } : { event });
  }
  var bus = null;
  function shopifyBus(shopId) {
    const destinations = [];
    const buffer = [];
    const privacy = () => window.Shopify?.customerPrivacy;
    const canTrack = () => {
      try {
        const p = privacy();
        return p?.consentStatus === "loaded" && p.currentVisitorConsent?.()?.analytics !== "no" && Boolean(p.analyticsProcessingAllowed?.());
      } catch {
        return false;
      }
    };
    const config = { shop: { shopId, channel: "headless" }, consent: { mode: cfg.analytics.shopify?.consent || "no-banner" } };
    const deliver = () => {
      if (!canTrack()) return;
      destinations.forEach((d) => {
        while (d.next < buffer.length) {
          const { event, payload } = buffer[d.next++];
          (d.subs.get(event) || []).forEach((cb) => {
            try {
              cb(payload, d.context);
            } catch (err) {
              reportError(err, `analytics ${d.name}`);
            }
          });
        }
      });
    };
    const api = {
      getConfig: () => config,
      publish(event, payload = {}) {
        buffer.push({ event, payload: { shop: config.shop, url: window.location.href, ...payload } });
        if (buffer.length > 500) {
          buffer.shift();
          destinations.forEach((d) => {
            d.next = Math.max(0, d.next - 1);
          });
        }
        deliver();
      },
      addDestination(dest) {
        const tag = `hydrogen:${dest.name}`;
        const d = {
          name: dest.name,
          next: 0,
          subs: /* @__PURE__ */ new Map(),
          context: {
            getTrackingValues: () => {
              const i = canTrack() ? privacy()?.__internal : null;
              return { uniqueToken: i?.uniqueToken?.({ generateFallback: true, tag }) ?? "", visitToken: i?.visitToken?.({ generateFallback: true, tag }) ?? "" };
            }
          }
        };
        const subscribe = (event, cb) => {
          if (!d.subs.has(event)) d.subs.set(event, /* @__PURE__ */ new Set());
          d.subs.get(event).add(cb);
          return () => d.subs.get(event)?.delete(cb);
        };
        Promise.resolve(dest.setup?.({ subscribe, getConfig: api.getConfig })).then(() => {
          destinations.push(d);
          deliver();
        }).catch((err) => reportError(err, `analytics ${dest.name}`));
        return () => {
          const i = destinations.indexOf(d);
          if (i >= 0) destinations.splice(i, 1);
        };
      }
    };
    document.addEventListener("consentTrackingApiLoaded", deliver);
    document.addEventListener("visitorConsentCollected", deliver);
    return api;
  }
  function loadScript(src) {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    document.head.appendChild(s);
  }
  async function startShopify() {
    if (window.Shopify?.analytics) {
      bus = window.Shopify.analytics;
      return;
    }
    const data = await gql("query TetherShopId { shop { id } }", {}, { context: false });
    const country = String(cfg.country || "US").toUpperCase();
    const S = window.Shopify = window.Shopify || {};
    Object.assign(S, {
      country,
      locale: (cfg.locale || "en").split("-")[0].toLowerCase(),
      // required by Shopify's script
      shop: cfg.domain,
      routes: { root: "/", match: () => ({ pageTemplateName: mainProduct() ? "product" : "page" }), ...S.routes || {} }
    });
    const proxy = cfg.analytics.shopify?.proxy;
    S.customerPrivacy = {
      ...S.customerPrivacy || {},
      config: proxy ? { isHeadless: true, asyncConsent: true, asyncVisitorState: true, consentDomain: window.location.host } : { isHeadless: true, storefrontAccessToken: cfg.token, checkoutRootDomain: cfg.domain }
    };
    bus = shopifyBus(data.shop.id);
    S.analytics = bus;
    loadScript(cfg.analytics.shopify?.consent === "default-banner" ? "https://cdn.shopify.com/shopifycloud/privacy-banner/storefront-banner.js" : "https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js");
    loadScript("https://cdn.shopify.com/storefront/analytics/shopify.js");
    log("shopify analytics ready", data.shop.id);
  }
  var productPayload = (p, v, quantity = 1) => ({
    id: p.id,
    title: p.title,
    price: v.price,
    vendor: p.vendor || "",
    variantId: v.id,
    variantTitle: v.title,
    quantity,
    sku: v.sku || void 0,
    productType: p.productType || void 0
  });
  function analyticsLine(l) {
    const m5 = l.merchandise || {};
    return { id: l.id, quantity: l.quantity, merchandise: { id: m5.id, title: m5.title, price: m5.price, sku: m5.sku, product: { id: m5.product?.id, title: m5.product?.title, vendor: m5.product?.vendor || "", handle: m5.product?.handle } } };
  }
  function mainProduct() {
    const el = document.querySelector(sel("product"));
    return el && !el.closest(`${sel("collection")},${sel("products")},${sel("recommendations")}`) ? window.Tether?.getScope(el) : null;
  }
  var send = (name, data, shopifyEvent, shopifyPayload) => {
    if (cfg.analytics.dataLayer) ga(name, data);
    if (bus && shopifyEvent) bus.publish(shopifyEvent, shopifyPayload);
    try {
      cfg.analytics.onEvent?.(name, data);
    } catch (err) {
      reportError(err, "analytics onEvent");
    }
  };
  var lastLines = null;
  var viewed = /* @__PURE__ */ new WeakSet();
  function handle(e) {
    const name = e.type.slice(cfg.prefix.length + 1);
    const d = e.detail || {};
    if (name === "product-ready") {
      const scope = d.scope;
      if (!scope || viewed.has(scope.root) || mainProduct() !== scope) return;
      viewed.add(scope.root);
      const v = scope.variant || d.product.variants.nodes[0];
      const items = [itemFromVariant(d.product, v)];
      send("view_item", { currency: v?.price?.currencyCode, value: value(items), items }, "product_viewed", { products: [productPayload(d.product, v)] });
    } else if (name === "list-ready") {
      const items = (d.products || []).slice(0, 200).map((p, i) => itemFromVariant(p, p.variants?.nodes?.[0], 1, i));
      const list = { item_list_id: d.collection?.handle || "products", item_list_name: d.collection?.title || "Products" };
      send("view_item_list", { ...list, items }, d.collection ? "collection_viewed" : null, d.collection ? { collection: { id: d.collection.id, handle: d.collection.handle } } : null);
    } else if (name === "cart-updated") {
      const cart = d.cart;
      const now = new Map((cart?.lines?.nodes || []).map((l) => [l.merchandise?.id, l]));
      if (lastLines && d.reason !== "load" && d.reason !== "pending") {
        const currency = cart?.cost?.totalAmount?.currencyCode;
        now.forEach((l, k) => {
          const diff = l.quantity - (lastLines.get(k)?.quantity || 0);
          if (diff > 0) {
            const items = [itemFromLine(l, diff)];
            send("add_to_cart", { currency, value: value(items), items }, "product_added_to_cart", {
              cart,
              prevCart: lastCart,
              currentLine: analyticsLine(l),
              prevLine: lastLines.get(k) ? analyticsLine(lastLines.get(k)) : void 0
            });
          }
        });
        lastLines.forEach((l, k) => {
          const diff = l.quantity - (now.get(k)?.quantity || 0);
          if (diff > 0) {
            const items = [itemFromLine(l, diff)];
            send("remove_from_cart", { currency, value: value(items), items });
          }
        });
      }
      lastLines = now;
      lastCart = cart;
    } else if (name === "cart-toggled" && d.open) {
      const items = Cart.lines.map((l) => itemFromLine(l));
      send("view_cart", { currency: Cart.state?.cost?.totalAmount?.currencyCode, value: value(items), items });
    } else if (name === "checkout") {
      const items = (d.cart?.lines?.nodes || []).map((l) => itemFromLine(l));
      const coupon = (d.cart?.discountCodes || []).filter((c) => c.applicable).map((c) => c.code).join(",") || void 0;
      send("begin_checkout", { currency: d.cart?.cost?.totalAmount?.currencyCode, value: value(items), coupon, items });
    } else if (name === "search" && d.term) {
      send("search", { search_term: d.term }, "search_viewed", { searchTerm: d.term });
    } else if (name === "page") {
      viewed = /* @__PURE__ */ new WeakSet();
      if (bus) bus.publish("page_viewed", {});
    }
  }
  var lastCart = null;
  async function startAnalytics(queue) {
    if (cfg.analytics.shopify) await startShopify().catch((err) => reportError(err, "shopify analytics"));
    if (bus) bus.publish("page_viewed", {});
    queue.splice(0).forEach(handle);
    queue.push = (e) => {
      handle(e);
      return 0;
    };
  }

  // src/parts/analytics.js
  window.Tether.__parts.analytics = analytics_exports;
})();
