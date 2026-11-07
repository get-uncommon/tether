(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/analytics.ts
  var analytics_exports = {};
  __export(analytics_exports, {
    startAnalytics: () => startAnalytics
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:dom.ts
  var m2 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, busy, emit, formatDate, formatMoney, get, has, hasTemplate, integerAttribute, isElement, isField, isOwnEvent, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, scoped, sel, setImage, setStoreHtml, setText, show] = m2;

  // tether-core:cart.ts
  var m3 = window.Tether.__core["cart.ts"];
  var [Cart] = m3;

  // tether-core:product.ts
  var m4 = window.Tether.__core["product.ts"];
  var [scopes] = m4;

  // tether-core:client.ts
  var m5 = window.Tether.__core["client.ts"];
  var [endpoint, gql, matches, orNull, shaped, TetherError, withTimeout] = m5;

  // src/analytics-shopify.ts
  var BUFFER_SIZE = 500;
  var CONSENT_SCRIPTS = {
    "default-banner": "https://cdn.shopify.com/shopifycloud/privacy-banner/storefront-banner.js",
    other: "https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js"
  };
  var ANALYTICS_SCRIPT = "https://cdn.shopify.com/storefront/analytics/shopify.js";
  var page = () => window;
  var shopifyGlobal = () => page().Shopify;
  function shopifyOptions() {
    const shopify = cfg.analytics?.shopify;
    return typeof shopify === "object" ? shopify : {};
  }
  function trackingAllowed() {
    try {
      const privacy = shopifyGlobal()?.customerPrivacy;
      return privacy?.consentStatus === "loaded" && privacy.currentVisitorConsent?.()?.analytics !== "no" && Boolean(privacy.analyticsProcessingAllowed?.());
    } catch {
      return false;
    }
  }
  function destinationContext(name) {
    const tag = `hydrogen:${name}`;
    return {
      getTrackingValues: () => {
        const internal = trackingAllowed() ? shopifyGlobal()?.customerPrivacy?.__internal : void 0;
        return {
          uniqueToken: internal?.uniqueToken?.({ generateFallback: true, tag }) ?? "",
          visitToken: internal?.visitToken?.({ generateFallback: true, tag }) ?? ""
        };
      }
    };
  }
  var subscriberOf = (destination) => (event, subscriber) => {
    const subscribers = destination.subscribers.get(event) ?? /* @__PURE__ */ new Set();
    destination.subscribers.set(event, subscribers);
    subscribers.add(subscriber);
    return () => destination.subscribers.get(event)?.delete(subscriber);
  };
  function createBus(shopId) {
    const destinations = [];
    const buffer = [];
    const config = {
      shop: { shopId, channel: "headless" },
      consent: { mode: shopifyOptions().consent || "no-banner" }
    };
    const deliver = () => {
      if (!trackingAllowed()) return;
      for (const destination of destinations) {
        for (; destination.next < buffer.length; destination.next += 1) {
          const buffered = buffer[destination.next];
          if (buffered) deliverTo(destination, buffered);
        }
      }
    };
    const bus2 = {
      getConfig: () => config,
      publish(event, payload = {}) {
        buffer.push({ event, payload: { shop: config.shop, url: window.location.href, ...payload } });
        if (buffer.length > BUFFER_SIZE) {
          buffer.shift();
          for (const destination of destinations) destination.next = Math.max(0, destination.next - 1);
        }
        deliver();
      },
      addDestination(spec) {
        const destination = {
          name: spec.name,
          next: 0,
          subscribers: /* @__PURE__ */ new Map(),
          context: destinationContext(spec.name)
        };
        Promise.resolve(spec.setup?.({ subscribe: subscriberOf(destination), getConfig: bus2.getConfig })).then(() => {
          destinations.push(destination);
          deliver();
        }).catch((error) => {
          reportError(error, `analytics ${spec.name}`);
        });
        return () => {
          const index = destinations.indexOf(destination);
          if (index >= 0) destinations.splice(index, 1);
        };
      }
    };
    document.addEventListener("consentTrackingApiLoaded", deliver);
    document.addEventListener("visitorConsentCollected", deliver);
    return bus2;
  }
  function deliverTo(destination, { event, payload }) {
    destination.subscribers.get(event)?.forEach((subscriber) => {
      try {
        subscriber(payload, destination.context);
      } catch (error) {
        reportError(error, `analytics ${destination.name}`);
      }
    });
  }
  function loadScript(src) {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
  }
  async function startShopifyAnalytics(isProductPage2) {
    const existing = shopifyGlobal();
    if (existing?.analytics) return existing.analytics;
    const data = await gql(
      "query TetherShopId { shop { id } }",
      {},
      shaped({ shop: { id: "string" } }),
      { context: false }
    );
    const shopify = shopifyGlobal() ?? {};
    page().Shopify = shopify;
    shopify.country = cfg.country ?? "US";
    const [language = "en"] = (cfg.locale || "en").split("-");
    shopify.locale = language.toLowerCase();
    shopify.shop = cfg.domain;
    shopify.routes = {
      root: "/",
      match: () => ({ pageTemplateName: isProductPage2() ? "product" : "page" }),
      ...shopify.routes
    };
    const { proxy, consent } = shopifyOptions();
    shopify.customerPrivacy = {
      ...shopify.customerPrivacy,
      config: proxy ? { isHeadless: true, asyncConsent: true, asyncVisitorState: true, consentDomain: window.location.host } : { isHeadless: true, storefrontAccessToken: cfg.token, checkoutRootDomain: cfg.domain }
    };
    const bus2 = createBus(data.shop.id);
    shopify.analytics = bus2;
    loadScript(consent === "default-banner" ? CONSENT_SCRIPTS["default-banner"] : CONSENT_SCRIPTS.other);
    loadScript(ANALYTICS_SCRIPT);
    log("shopify analytics ready", data.shop.id);
    return bus2;
  }

  // src/analytics-queue.ts
  var PAGE_TRANSITION = "page-transition";

  // src/analytics.ts
  var DEFAULT_VARIANT_TITLE = "Default Title";
  var CENTS_PER_UNIT = 100;
  var MAX_LIST_ITEMS = 200;
  var amountOf = (money) => money ? parseFloat(money.amount) : 0;
  var numericId = (gid) => (gid ?? "").split("/").pop() ?? "";
  function itemFromVariant(product, variant, quantity = 1, index) {
    const item = {
      item_id: variant?.sku || numericId(variant?.id) || numericId(product.id),
      item_name: product.title,
      item_variant: variant?.title === DEFAULT_VARIANT_TITLE ? void 0 : variant?.title,
      item_brand: product.vendor || void 0,
      item_category: product.productType || void 0,
      price: amountOf(variant?.price ?? product.priceRange?.minVariantPrice),
      quantity
    };
    if (index != null) item.index = index;
    return item;
  }
  var itemFromLine = (line, quantity = line.quantity) => itemFromVariant(line.merchandise.product, line.merchandise, quantity);
  function totalValue(items) {
    const total = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
    return Math.round(total * CENTS_PER_UNIT) / CENTS_PER_UNIT;
  }
  var productPayload = (product, variant, quantity = 1) => ({
    id: product.id,
    title: product.title,
    price: variant.price,
    vendor: product.vendor || "",
    variantId: variant.id,
    variantTitle: variant.title,
    quantity,
    sku: variant.sku || void 0,
    productType: product.productType || void 0
  });
  var linePayload = (line) => ({
    id: line.id,
    quantity: line.quantity,
    merchandise: {
      id: line.merchandise.id,
      title: line.merchandise.title,
      price: line.merchandise.price,
      sku: line.merchandise.sku,
      product: {
        id: line.merchandise.product.id,
        title: line.merchandise.product.title,
        vendor: line.merchandise.product.vendor || "",
        handle: line.merchandise.product.handle
      }
    }
  });
  function dataLayer() {
    const { dataLayer: option } = cfg.analytics ?? {};
    const name = typeof option === "string" ? option : "dataLayer";
    const existing = Reflect.get(window, name);
    if (Array.isArray(existing)) return existing;
    const created = [];
    Reflect.set(window, name, created);
    return created;
  }
  function pushToDataLayer(event, ecommerce) {
    const layer = dataLayer();
    if (!ecommerce) {
      layer.push({ event });
      return;
    }
    layer.push({ ecommerce: null });
    layer.push({ event, ecommerce });
  }
  var bus = null;
  var lastLines = null;
  var lastCart = null;
  var viewed = /* @__PURE__ */ new WeakSet();
  var viewedBody;
  var bodies = /* @__PURE__ */ new WeakMap();
  function send(name, data, shopifyEvent, shopifyPayload) {
    if (cfg.analytics?.dataLayer) pushToDataLayer(name, data);
    if (bus && shopifyEvent) bus.publish(shopifyEvent, shopifyPayload);
    try {
      cfg.analytics?.onEvent?.(name, data);
    } catch (error) {
      reportError(error, "analytics onEvent");
    }
  }
  function mainProductRoot(page2) {
    const el = page2.querySelector(sel("product"));
    return el?.closest(`${sel("collection")},${sel("products")},${sel("recommendations")}`) ? null : el;
  }
  function isProductPage() {
    const root = mainProductRoot(document);
    return root !== null && scopes.has(root);
  }
  function onProductReady({ product, scope }) {
    const page2 = scope.root.closest("body") ?? document;
    if (viewed.has(scope.root) || mainProductRoot(page2) !== scope.root) return;
    viewed.add(scope.root);
    const variant = scope.variant ?? product.variants.nodes[0];
    const items = [itemFromVariant(product, variant)];
    const products = variant ? [productPayload(product, variant)] : [];
    send("view_item", { currency: variant?.price.currencyCode, value: totalValue(items), items }, "product_viewed", {
      products
    });
  }
  function onListReady({ products, collection }) {
    const items = products.slice(0, MAX_LIST_ITEMS).map((product, index) => itemFromVariant(product, product.variants.nodes[0], 1, index));
    const list = { item_list_id: collection?.handle || "products", item_list_name: collection?.title || "Products" };
    if (!collection) {
      send("view_item_list", { ...list, items });
      return;
    }
    send("view_item_list", { ...list, items }, "collection_viewed", {
      collection: { id: collection.id, handle: collection.handle }
    });
  }
  function sendCartChanges(cart, now, before) {
    const currency = cart?.cost.totalAmount.currencyCode;
    now.forEach((line, variantId) => {
      const previous = before.get(variantId);
      const added = line.quantity - (previous?.quantity ?? 0);
      if (added <= 0) return;
      const items = [itemFromLine(line, added)];
      send("add_to_cart", { currency, value: totalValue(items), items }, "product_added_to_cart", {
        cart,
        prevCart: lastCart,
        currentLine: linePayload(line),
        prevLine: previous ? linePayload(previous) : void 0
      });
    });
    before.forEach((line, variantId) => {
      const removed = line.quantity - (now.get(variantId)?.quantity ?? 0);
      if (removed <= 0) return;
      const items = [itemFromLine(line, removed)];
      send("remove_from_cart", { currency, value: totalValue(items), items });
    });
  }
  function onCartUpdated({ cart, reason }) {
    const now = new Map((cart?.lines.nodes ?? []).map((line) => [line.merchandise.id, line]));
    if (lastLines && reason !== "load" && reason !== "pending") sendCartChanges(cart, now, lastLines);
    lastLines = now;
    lastCart = cart;
  }
  function onCartOpened() {
    const items = Cart.lines.map((line) => itemFromLine(line));
    send("view_cart", { currency: Cart.state?.cost.totalAmount.currencyCode, value: totalValue(items), items });
  }
  function onCheckout({ cart }) {
    if (!cart) return;
    const items = cart.lines.nodes.map((line) => itemFromLine(line));
    const coupons = cart.discountCodes.filter((discount) => discount.applicable).map((discount) => discount.code);
    send("begin_checkout", {
      currency: cart.cost.totalAmount.currencyCode,
      value: totalValue(items),
      coupon: coupons.join(",") || void 0,
      items
    });
  }
  var REPORTERS = {
    "product-ready": onProductReady,
    "list-ready": onListReady,
    "cart-updated": onCartUpdated,
    "cart-toggled": ({ open }) => {
      if (open) onCartOpened();
    },
    checkout: onCheckout,
    search: ({ term }) => {
      if (term) send("search", { search_term: term }, "search_viewed", { searchTerm: term });
    }
  };
  function report(event, name) {
    REPORTERS[name](event.detail);
  }
  function startPageView() {
    viewed = /* @__PURE__ */ new WeakSet();
    bus?.publish("page_viewed", {});
  }
  function handle(event) {
    if (event.type === PAGE_TRANSITION) {
      startPageView();
      return;
    }
    if (event.type === "astro:page-load") {
      const body = bodies.get(event);
      if (body === viewedBody) return;
      viewedBody = body;
      startPageView();
      return;
    }
    ANALYTICS_EVENTS.forEach((name) => {
      if (isOwnEvent(event, name)) report(event, name);
    });
  }
  async function startAnalytics(queue, pageLoads, landing) {
    bodies = pageLoads;
    if (cfg.analytics?.shopify) {
      bus = await startShopifyAnalytics(isProductPage).catch((error) => {
        reportError(error, "shopify analytics");
        return null;
      });
    }
    viewedBody = landing;
    startPageView();
    queue.splice(0).forEach(handle);
    queue.push = (...events) => {
      events.forEach(handle);
      return queue.length;
    };
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

  // src/parts/analytics.ts
  registerPart("analytics", analytics_exports);
})();
