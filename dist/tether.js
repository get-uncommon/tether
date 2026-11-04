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
    warn: () => warn
  });
  var DEFAULTS = {
    // Shopify Storefront API
    domain: "",
    // 'your-store.myshopify.com'
    token: "",
    // public Storefront API access token
    apiVersion: "2026-07",
    country: void 0,
    // ISO code, e.g. 'NL' -> @inContext(country: NL)
    language: void 0,
    // e.g. 'NL' -> @inContext(language: NL)
    locale: void 0,
    // Intl locale for money/dates, e.g. 'nl-NL'
    markets: null,
    // { detect: true, locales: { de: { country: 'DE', language: 'DE' } }, cookie, remember } (markets.js)
    // Markup
    prefix: "tether",
    // attribute prefix: tether-product, tether-bind, ...
    productPath: "/product",
    // Webflow CMS template path for products
    collectionPath: "/collection",
    // Fetching
    metafields: [],
    // ['custom.material', { namespace, key }]
    imagesFirst: 25,
    variantsFirst: 100,
    sellingPlanGroupsFirst: 10,
    sellingPlansFirst: 25,
    collectionFirst: 24,
    retries: 2,
    revalidate: true,
    // products from the server (tether/server hydrate()): refresh once in the background
    // Cart
    storageKey: null,
    // defaults to `tether:cart:<domain>`
    cartDrawerOpenClass: "is-open",
    openCartOnAdd: true,
    cartFocus: true,
    // move focus into the open cart, keep Tab inside it, restore it on close
    checkoutTarget: "_self",
    // '_self' or '_blank'
    // Subscriptions
    defaultPurchase: "one-time",
    // 'one-time' | 'subscription'
    variantUrl: false,
    // true: ?variant= follows the visitor's choice on the main product (shareable links)
    maxAge: 60,
    // seconds a Shopify answer may be cached (0 = Shopify's own caching, can be hours)
    lowStock: 5,
    // tether-show="low-stock" at this many or fewer (needs inventory access)
    // Mounting
    autoMount: true,
    // mount document on DOMContentLoaded
    observe: false,
    // auto-mount nodes added later (CMS load-more, filters)
    astro: true,
    // mount on Astro View Transitions (astro:page-load); false if you do it yourself
    partsUrl: null,
    // folder of tether.markets/diagnose(.min).js for the <script> build (default: next to it)
    // Formatting
    formatMoney: null,
    // (money, locale) => string
    // Hooks (all optional)
    onLayoutChange: null,
    // (reason) => void. Default refreshes ScrollTrigger if present
    onCartOpen: null,
    // (drawers) => void, e.g. lock scroll
    onCartClose: null,
    // (drawers) => void
    onLineEnter: null,
    // (node) => void, animate a new cart line in
    onLineLeave: null,
    // (node, done) => void, animate out, then call done()
    onValueChange: null,
    // (el, previousText) => void, e.g. text scramble
    onError: null,
    // (error, context) => void
    debug: false
  };
  var cfg = { ...DEFAULTS };
  function configure(overrides = {}) {
    Object.keys(cfg).forEach((k) => delete cfg[k]);
    Object.assign(cfg, DEFAULTS, overrides);
    if (cfg.domain) cfg.domain = String(cfg.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!cfg.storageKey) cfg.storageKey = `${cfg.prefix}:cart:${cfg.domain}`;
    if (cfg.apiVersion === "unstable") warn('apiVersion "unstable" changes without notice. Pin a dated version (e.g. 2026-07).');
    return cfg;
  }
  var isConfigured = () => Boolean(cfg.domain && cfg.token);
  function log(...a) {
    if (cfg.debug) console.log(`[${cfg.prefix}]`, ...a);
  }
  function warn(...a) {
    console.warn(`[${cfg.prefix}]`, ...a);
  }
  function reportError(err, context) {
    warn(context, err && err.message ? err.message : err);
    if (typeof cfg.onError === "function") {
      try {
        cfg.onError(err, context);
      } catch {
      }
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
  var TetherError = class extends Error {
    constructor(message, { status, errors, userErrors, code } = {}) {
      super(message);
      this.name = "TetherError";
      this.code = code || (status ? `HTTP_${status}` : "ERROR");
      this.status = status;
      this.errors = errors;
      this.userErrors = userErrors;
    }
  };
  function endpoint(conf = cfg) {
    return `https://${conf.domain}/api/${conf.apiVersion}/graphql.json`;
  }
  function withContext(query, ctx = cfg) {
    const args = [];
    if (ctx.country) args.push(`country: ${String(ctx.country).toUpperCase()}`);
    if (ctx.language) args.push(`language: ${String(ctx.language).toUpperCase().replace("-", "_")}`);
    if (!args.length || /@inContext/.test(query)) return query;
    const tag = `@inContext(${args.join(", ")})`;
    if (/^\s*\{/.test(query)) return `query ${tag} ${query.trimStart()}`;
    return query.replace(/^(\s*(?:query|mutation)(?:\s+\w+)?\s*(?:\([^)]*\))?)/, `$1 ${tag}`);
  }
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function request(conf, query, variables = {}, { context = true } = {}) {
    if (!conf.domain || !conf.token) {
      throw new TetherError("Tether is not configured: domain and token are required", { code: "NOT_CONFIGURED" });
    }
    let text = context ? withContext(query, conf) : query;
    const age = conf.maxAge ?? 60;
    if (age > 0 && !/^\s*mutation\b/.test(text)) text += ` #${Math.floor(Date.now() / (age * 1e3))}`;
    const body = JSON.stringify({ query: text, variables });
    let attempt = 0;
    for (; ; ) {
      let res;
      try {
        res = await (conf.fetch || fetch)(endpoint(conf), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Storefront-Access-Token": conf.token
          },
          body
        });
      } catch (err) {
        if (attempt++ < conf.retries) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw new TetherError(`Network error: ${err.message}`, { code: "NETWORK" });
      }
      if (res.status === 430) throw new TetherError("Shopify security rejection (430)", { status: 430 });
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt++ < conf.retries) {
        log("retry", res.status, attempt);
        await sleep(300 * 2 ** attempt);
        continue;
      }
      let json;
      try {
        json = await res.json();
      } catch {
        throw new TetherError(`Invalid response (${res.status})`, { status: res.status });
      }
      if (json.errors?.length) {
        const inventoryDenied = json.errors.some((e) => /quantityAvailable/.test(e.message || ""));
        if (inventoryDenied && /\bquantityAvailable\b/.test(body)) {
          log("no inventory permission, retrying without quantityAvailable");
          return request(conf, query.replace(/\bquantityAvailable\b/g, ""), variables, { context });
        }
        if (json.errors.some((e) => /'warnings'/.test(e.message || "")) && /warnings \{ code message target \}/.test(query)) {
          return request(conf, query.replace(/ warnings \{ code message target \}/g, ""), variables, { context });
        }
        const throttled = json.errors.some((e) => e.extensions?.code === "THROTTLED");
        if (throttled && attempt++ < conf.retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new TetherError(json.errors.map((e) => e.message).join(" | "), {
          status: res.status,
          errors: json.errors
        });
      }
      if (!res.ok) throw new TetherError(`HTTP ${res.status}`, { status: res.status });
      return json.data;
    }
  }
  var gql = (query, variables, opts) => request(cfg, query, variables, opts);
  function unwrap(payload, name) {
    if (!payload) throw new TetherError(`${name}: empty response`);
    const errs = payload.userErrors || [];
    if (errs.length) {
      throw new TetherError(errs.map((e) => e.message).join(" | "), { userErrors: errs });
    }
    return payload;
  }

  // src/cart.js
  var cart_exports = {};
  __export(cart_exports, {
    Cart: () => Cart,
    focusables: () => focusables,
    toLineInput: () => toLineInput
  });

  // src/fragments.js
  var fragments_exports = {};
  __export(fragments_exports, {
    ALLOCATION_FIELDS: () => ALLOCATION_FIELDS,
    SELLING_PLAN_FIELDS: () => SELLING_PLAN_FIELDS,
    cartFragment: () => cartFragment,
    collectionFields: () => collectionFields,
    metafieldIdentifiers: () => metafieldIdentifiers,
    productFragment: () => productFragment
  });
  var MONEY = "amount currencyCode";
  var IMAGE = "url altText width height";
  function metafieldIdentifiers(o = cfg) {
    return (o.metafields || []).map((m) => {
      if (typeof m === "string") {
        const i = m.indexOf(".");
        return { namespace: m.slice(0, i), key: m.slice(i + 1) };
      }
      return m;
    }).filter((m) => m.namespace && m.key);
  }
  function metafieldsField(o = cfg) {
    const ids = metafieldIdentifiers(o);
    if (!ids.length) return "";
    const list = ids.map((m) => `{namespace: ${JSON.stringify(m.namespace)}, key: ${JSON.stringify(m.key)}}`).join(", ");
    return `metafields(identifiers:[${list}]){namespace key type value reference{... on MediaImage{image{${IMAGE}}}}}`;
  }
  var SELLING_PLAN_FIELDS = ` id name description recurringDeliveries options{name value}priceAdjustments{orderCount adjustmentValue{__typename ... on SellingPlanPercentagePriceAdjustment{adjustmentPercentage}... on SellingPlanFixedAmountPriceAdjustment{adjustmentAmount{${MONEY}}}... on SellingPlanFixedPriceAdjustment{price{${MONEY}}}}}`;
  var ALLOCATION_FIELDS = ` sellingPlan{id}checkoutChargeAmount{${MONEY}}remainingBalanceChargeAmount{${MONEY}}priceAdjustments{price{${MONEY}}compareAtPrice{${MONEY}}perDeliveryPrice{${MONEY}}unitPrice{${MONEY}}}`;
  function productFragment(o = cfg) {
    return ` fragment TetherProduct on Product{id handle title description descriptionHtml productType vendor tags availableForSale publishedAt onlineStoreUrl requiresSellingPlan seo{title description}featuredImage{${IMAGE}}images(first:${o.imagesFirst}){nodes{${IMAGE}}}options{name optionValues{name swatch{color image{previewImage{${IMAGE}}}}}}priceRange{minVariantPrice{${MONEY}}maxVariantPrice{${MONEY}}}compareAtPriceRange{minVariantPrice{${MONEY}}maxVariantPrice{${MONEY}}}${metafieldsField(o)} sellingPlanGroups(first:${o.sellingPlanGroupsFirst}){nodes{name appName options{name values}sellingPlans(first:${o.sellingPlansFirst}){nodes{${SELLING_PLAN_FIELDS}}}}}variants(first:${o.variantsFirst}){nodes{id title availableForSale currentlyNotInStock quantityAvailable sku barcode selectedOptions{name value}image{${IMAGE}}price{${MONEY}}compareAtPrice{${MONEY}}unitPrice{${MONEY}}sellingPlanAllocations(first:${o.sellingPlansFirst}){nodes{${ALLOCATION_FIELDS}}}}}}`;
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
  var productCache = /* @__PURE__ */ new Map();
  var pending = [];
  var resolvers = /* @__PURE__ */ new Map();
  var scheduled = false;
  var generation = 0;
  var isGid = (v) => typeof v === "string" && v.startsWith("gid://");
  function normalizeProductKey(raw) {
    const v = String(raw ?? "").trim();
    if (!v) return null;
    if (isGid(v)) return v;
    if (/^\d+$/.test(v)) return `gid://shopify/Product/${v}`;
    const m = v.match(/\/products\/([^/?#]+)/);
    return m ? m[1] : v;
  }
  function primeProduct(product) {
    if (!product) return;
    const p = Promise.resolve(product);
    productCache.set(product.handle, p);
    productCache.set(product.id, p);
  }
  function getProduct(rawKey) {
    const key = normalizeProductKey(rawKey);
    if (!key) return Promise.reject(new TetherError("empty product key", { code: "NOT_FOUND" }));
    if (productCache.has(key)) return productCache.get(key);
    const p = new Promise((resolve, reject) => {
      resolvers.set(key, { resolve, reject });
      pending.push(key);
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    });
    productCache.set(key, p);
    return p;
  }
  async function flush() {
    scheduled = false;
    const gen = generation;
    const keys = pending.splice(0);
    if (!keys.length) return;
    const ids = keys.filter(isGid);
    const handles = keys.filter((k) => !isGid(k));
    const defs = [];
    const parts2 = [];
    const vars = {};
    if (ids.length) {
      defs.push("$ids: [ID!]!");
      vars.ids = ids;
      parts2.push("byId: nodes(ids: $ids) { ... on Product { ...TetherProduct } }");
    }
    handles.forEach((h, i) => {
      defs.push(`$h${i}: String!`);
      vars[`h${i}`] = h;
      parts2.push(`h${i}: product(handle: $h${i}) { ...TetherProduct }`);
    });
    const query = `query TetherProducts(${defs.join(",")}){${parts2.join(" ")}}${productFragment()}`;
    log("fetch products", keys);
    const settle = (k, fn) => {
      const r = resolvers.get(k);
      resolvers.delete(k);
      if (r) fn(r);
    };
    try {
      const data = await gql(query, vars);
      const got = /* @__PURE__ */ new Map();
      (data.byId || []).forEach((p) => {
        if (p) got.set(p.id, p);
      });
      handles.forEach((h, i) => {
        if (data[`h${i}`]) got.set(h, data[`h${i}`]);
      });
      keys.forEach((k) => settle(k, (r) => {
        if (got.has(k)) {
          const p = got.get(k);
          if (gen === generation) {
            primeProduct(p);
            freshAt.set(p.handle, Date.now());
            freshAt.set(p.id, Date.now());
          }
          r.resolve(p);
        } else {
          const miss = productCache.get(k);
          if (gen === generation) setTimeout(() => {
            if (productCache.get(k) === miss) productCache.delete(k);
          }, 1e4);
          r.reject(new TetherError(`Product not found: ${k}`, { code: "NOT_FOUND" }));
        }
      }));
    } catch (err) {
      keys.forEach((k) => settle(k, (r) => {
        if (gen === generation) productCache.delete(k);
        r.reject(err);
      }));
    }
  }
  function clearProductCache() {
    productCache.clear();
    generation++;
    stale.clear();
    freshAt.clear();
  }
  var stale = /* @__PURE__ */ new Set();
  var freshAt = /* @__PURE__ */ new Map();
  var FRESH_MS = 6e4;
  function hydrateProducts(products) {
    (products || []).forEach((p) => {
      if (!p?.id || !p.handle) return;
      if (Date.now() - (freshAt.get(p.handle) || 0) < FRESH_MS && productCache.has(p.handle)) return;
      primeProduct(p);
      stale.add(p.handle);
      stale.add(p.id);
    });
  }
  function takeStale(key) {
    const k = normalizeProductKey(key);
    if (!stale.has(k)) return false;
    const p = productCache.get(k);
    stale.delete(k);
    p?.then?.((x) => {
      stale.delete(x.handle);
      stale.delete(x.id);
    });
    return true;
  }
  function refreshProducts(keys) {
    keys.forEach((k) => productCache.delete(normalizeProductKey(k)));
    return keys.map((k) => getProduct(k));
  }
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
      const data2 = await gql(`query TetherCollection($handle:String!,$first:Int!,$after:String,$sortKey:ProductCollectionSortKeys,$reverse:Boolean,$filters:[ProductFilter!]){collection(handle:$handle){${collectionFields()} products(first:$first,after:$after,sortKey:$sortKey,reverse:$reverse,filters:$filters){nodes{...TetherProduct}pageInfo{hasNextPage endCursor}}}}${fragment}`, {
        handle: collection,
        first,
        after,
        sortKey: sortKey || void 0,
        reverse,
        filters: filters || void 0
      });
      if (!data2.collection) throw new TetherError(`Collection not found: ${collection}`, { code: "NOT_FOUND" });
      const { products, ...rest } = data2.collection;
      products.nodes.forEach(primeProduct);
      return { collection: rest, products: products.nodes, pageInfo: products.pageInfo };
    }
    const data = await gql(`query TetherSearch($first:Int!,$after:String,$query:String,$sortKey:ProductSortKeys,$reverse:Boolean){products(first:$first,after:$after,query:$query,sortKey:$sortKey,reverse:$reverse){nodes{...TetherProduct}pageInfo{hasNextPage endCursor}}}${fragment}`, { first, after, query: query || void 0, sortKey: sortKey || void 0, reverse });
    data.products.nodes.forEach(primeProduct);
    return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
  }
  async function getRecommendations(product, intent = "RELATED") {
    const key = normalizeProductKey(typeof product === "object" ? product?.id : product);
    const byId = key?.startsWith("gid://");
    const data = await gql(`query TetherRecs(${byId ? "$id: ID!" : "$handle: String!"},$intent:ProductRecommendationIntent){productRecommendations(${byId ? "productId: $id" : "productHandle: $handle"},intent:$intent){...TetherProduct}}${productFragment()}`, byId ? { id: key, intent } : { handle: key, intent });
    const list = data.productRecommendations || [];
    list.forEach(primeProduct);
    return list;
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
  var GID = {
    product: (v) => toGid(v, "Product"),
    variant: (v) => toGid(v, "ProductVariant"),
    sellingPlan: (v) => toGid(v, "SellingPlan")
  };
  function toGid(value, type) {
    const v = String(value ?? "").trim();
    if (!v) return null;
    if (v.startsWith("gid://")) return v;
    if (/^\d+$/.test(v)) return `gid://shopify/${type}/${v}`;
    return v;
  }
  function allPlans(product) {
    const groups = product?.sellingPlanGroups?.nodes || [];
    return groups.flatMap((g) => (g.sellingPlans?.nodes || []).map((p) => ({ ...p, group: g })));
  }
  function hasPlans(product) {
    return allPlans(product).length > 0;
  }
  function allocationFor(variant, planId) {
    if (!variant || !planId) return null;
    return (variant.sellingPlanAllocations?.nodes || []).find((a) => a.sellingPlan?.id === planId) || null;
  }
  function plansForVariant(product, variant) {
    return allPlans(product).filter((p) => allocationFor(variant, p.id));
  }
  function planPrice(variant, planId) {
    const a = allocationFor(variant, planId);
    const adj = a?.priceAdjustments?.[0];
    return adj?.perDeliveryPrice || adj?.price || variant?.price || null;
  }
  function planCheckoutCharge(variant, planId) {
    const a = allocationFor(variant, planId);
    return a?.checkoutChargeAmount || a?.priceAdjustments?.[0]?.price || variant?.price || null;
  }
  function planSavings(variant, planId) {
    const base = parseFloat(variant?.price?.amount);
    const sub = parseFloat(planPrice(variant, planId)?.amount);
    if (!Number.isFinite(base) || !Number.isFinite(sub) || base <= 0 || sub >= base) {
      return { amount: null, percentage: 0 };
    }
    return {
      amount: { amount: (base - sub).toFixed(2), currencyCode: variant.price.currencyCode },
      percentage: Math.round((1 - sub / base) * 100)
    };
  }
  function planAdjustment(plan) {
    const v = plan?.priceAdjustments?.[0]?.adjustmentValue;
    if (!v) return null;
    switch (v.__typename) {
      case "SellingPlanPercentagePriceAdjustment":
        return { type: "percentage", value: v.adjustmentPercentage };
      case "SellingPlanFixedAmountPriceAdjustment":
        return { type: "amount", value: v.adjustmentAmount };
      case "SellingPlanFixedPriceAdjustment":
        return { type: "price", value: v.price };
      default:
        return null;
    }
  }
  function findPlan(product, ref) {
    if (!ref) return null;
    const plans = allPlans(product);
    const gid = GID.sellingPlan(ref);
    const needle = String(ref).trim().toLowerCase();
    return plans.find((p) => p.id === gid) || plans.find((p) => p.name.toLowerCase() === needle) || plans.find((p) => (p.options || []).some((o) => String(o.value).toLowerCase() === needle)) || null;
  }

  // src/dom.js
  var dom_exports = {};
  __export(dom_exports, {
    attr: () => attr,
    busy: () => busy,
    cdnUrl: () => cdnUrl,
    dataKey: () => dataKey,
    emit: () => emit,
    formatDate: () => formatDate,
    formatMoney: () => formatMoney,
    formatPercent: () => formatPercent,
    get: () => get,
    has: () => has,
    hasTemplate: () => hasTemplate,
    imageUrl: () => imageUrl,
    notifyLayoutChanged: () => notifyLayoutChanged,
    parseJSONAttr: () => parseJSONAttr,
    productUrl: () => productUrl,
    qsa: () => qsa,
    readText: () => readText,
    repeat: () => repeat,
    repeatKeyed: () => repeatKeyed,
    sameImage: () => sameImage,
    scoped: () => scoped,
    sel: () => sel,
    setImage: () => setImage,
    setSelected: () => setSelected,
    setText: () => setText,
    setTextTracked: () => setTextTracked,
    show: () => show,
    toAttributes: () => toAttributes,
    watchImages: () => watchImages
  });
  var attr = (name) => `${cfg.prefix}-${name}`;
  var sel = (name, value) => value === void 0 ? `[${attr(name)}]` : `[${attr(name)}="${value}"]`;
  var get = (el, name) => el.getAttribute(attr(name));
  var has = (el, name) => el.hasAttribute(attr(name));
  var dataKey = () => `data-${cfg.prefix}-key`;
  function productUrl(handle, id) {
    const path = cfg.productPath || "/product";
    if (!/\{(handle|id)\}/.test(path)) return `${path.replace(/\/$/, "")}/${handle}`;
    const numeric = id ? String(id).split("/").pop() : "";
    return path.replace(/\{handle\}/g, encodeURIComponent(handle || "")).replace(/\{id\}/g, encodeURIComponent(numeric));
  }
  var qsa = (root, s) => root ? [...root.querySelectorAll(s)] : [];
  var scoped = (root, s, scopeSelector) => qsa(root, s).filter((el) => el.closest(scopeSelector) === root);
  function emit(name, detail, target = document) {
    target.dispatchEvent(new CustomEvent(`${cfg.prefix}:${name}`, { detail, bubbles: true }));
  }
  function formatPercent(n, locale = cfg.locale) {
    if (!n) return "";
    try {
      return new Intl.NumberFormat(locale || void 0, { style: "percent", maximumFractionDigits: 0 }).format(n / 100);
    } catch {
      return `${n}%`;
    }
  }
  function formatMoney(money) {
    if (!money) return "";
    if (typeof cfg.formatMoney === "function") return cfg.formatMoney(money, cfg.locale);
    const amount = parseFloat(money.amount);
    if (Number.isNaN(amount)) return "";
    try {
      return new Intl.NumberFormat(cfg.locale || void 0, {
        style: "currency",
        currency: money.currencyCode
      }).format(amount);
    } catch {
      return `${money.currencyCode} ${amount.toFixed(2)}`;
    }
  }
  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString(cfg.locale || void 0);
    } catch {
      return "";
    }
  }
  function imageUrl(url, { width, height, crop } = {}) {
    if (!url) return url;
    try {
      const u = new URL(url);
      if (width) u.searchParams.set("width", String(width));
      if (height) u.searchParams.set("height", String(height));
      if (crop) u.searchParams.set("crop", crop);
      return u.toString();
    } catch {
      return url;
    }
  }
  function cdnUrl(url, el) {
    if (!url || !el) return url;
    const g = (k) => el.getAttribute(k);
    return imageUrl(url, { width: g("max-width"), height: g("max-height"), crop: g("max-width") || g("max-height") ? g("crop") : null });
  }
  var sameImage = (a, b) => Boolean(a && b) && a.split("?")[0] === b.split("?")[0];
  function setImage(el, url, alt) {
    if (!url) return;
    const src = cdnUrl(url, el);
    if (el.tagName === "IMG" && sameImage(el.getAttribute("src"), src)) {
      if (alt != null && !el.getAttribute("alt")) el.setAttribute("alt", alt);
      return;
    }
    if (el.tagName === "IMG") {
      el.removeAttribute("srcset");
      el.removeAttribute("sizes");
      el.setAttribute("src", src);
      if (alt != null) el.setAttribute("alt", alt);
      if (!el.getAttribute("loading")) el.setAttribute("loading", "lazy");
    } else {
      el.style.backgroundImage = `url("${src}")`;
    }
  }
  function setText(el, v) {
    const text = v == null ? "" : String(v);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.value = text;
    else el.textContent = text;
  }
  var readText = (el) => el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.value : el.textContent;
  function setTextTracked(el, v) {
    const before = readText(el);
    setText(el, v);
    const after = readText(el);
    if (before !== after && el.dataset.tetherSeen && typeof cfg.onValueChange === "function") {
      try {
        cfg.onValueChange(el, before);
      } catch {
      }
    }
    el.dataset.tetherSeen = "1";
  }
  function show(el, visible) {
    const k = "tetherPrevDisplay";
    if (visible) {
      if (el.dataset.tetherShown !== void 0) return;
      el.dataset.tetherShown = "";
      el.removeAttribute("hidden");
      if (el.dataset[k] !== void 0) {
        el.style.display = el.dataset[k];
        delete el.dataset[k];
      } else if (el.style.display === "none") {
        el.style.display = "";
      }
      if (typeof getComputedStyle === "function" && getComputedStyle(el).display === "none") {
        el.style.display = el.getAttribute(`${cfg.prefix}-display`) || "block";
      }
    } else {
      delete el.dataset.tetherShown;
      if (el.dataset[k] === void 0 && el.style.display !== "none") el.dataset[k] = el.style.display || "";
      el.style.display = "none";
    }
  }
  function setSelected(el, selected) {
    el.classList.toggle("is-selected", selected);
    el.setAttribute("aria-pressed", selected ? "true" : "false");
    if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox")) el.checked = selected;
    const input = el.querySelector?.('input[type="radio"],input[type="checkbox"]');
    if (input) input.checked = selected;
  }
  var templates = /* @__PURE__ */ new WeakMap();
  var hasTemplate = (container) => Boolean(templates.get(container));
  function template(container) {
    if (!templates.has(container)) {
      const tpl = container.firstElementChild?.cloneNode(true) ?? null;
      templates.set(container, tpl);
      container.innerHTML = "";
    }
    return templates.get(container);
  }
  function repeat(container, items, render) {
    const tpl = template(container);
    if (!tpl) {
      warn("repeater without a template child", container);
      return;
    }
    container.innerHTML = "";
    items.forEach((item, i) => {
      const node = tpl.cloneNode(true);
      render(node, item, i);
      container.appendChild(node);
    });
  }
  function repeatKeyed(container, items, keyOf, render, { onEnter, onLeave } = {}) {
    const tpl = template(container);
    if (!tpl) {
      warn("repeater without a template child", container);
      return;
    }
    const KEY = dataKey();
    const LEAVING = `data-${cfg.prefix}-leaving`;
    const live = () => [...container.children].filter((n) => n.hasAttribute(KEY) && !n.hasAttribute(LEAVING));
    const existing = new Map(live().map((n) => [n.getAttribute(KEY), n]));
    const wanted = [];
    const fresh = /* @__PURE__ */ new Set();
    items.forEach((item, i) => {
      const k = String(keyOf(item, i));
      let node = existing.get(k);
      if (node) existing.delete(k);
      else {
        node = tpl.cloneNode(true);
        node.setAttribute(KEY, k);
        fresh.add(node);
      }
      render(node, item, i, fresh.has(node));
      wanted.push(node);
    });
    const staying = wanted.filter((n) => !fresh.has(n));
    const current = live().filter((n) => staying.includes(n));
    const orderOk = current.length === staying.length && current.every((n, i) => n === staying[i]);
    if (!orderOk) {
      existing.forEach((n) => n.remove());
      wanted.forEach((n) => container.appendChild(n));
      return;
    }
    wanted.forEach((node, i) => {
      if (!fresh.has(node)) return;
      const prev = wanted[i - 1];
      if (prev && prev.parentNode === container) prev.after(node);
      else container.prepend(node);
      if (onEnter) {
        try {
          onEnter(node);
        } catch {
        }
      }
    });
    existing.forEach((node) => {
      node.setAttribute(LEAVING, "");
      node.removeAttribute(KEY);
      node.style.pointerEvents = "none";
      node.inert = true;
      const done = () => node.remove();
      if (onLeave) {
        try {
          onLeave(node, done);
        } catch {
          done();
        }
      } else done();
    });
  }
  var layoutTimer = null;
  function notifyLayoutChanged(reason) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      if (typeof cfg.onLayoutChange === "function") cfg.onLayoutChange(reason);
      else if (window.ScrollTrigger?.refresh) window.ScrollTrigger.refresh();
      emit("layout-changed", { reason });
    }, 120);
  }
  function watchImages(root, reason) {
    const imgs = qsa(root, "img").filter((i) => !i.complete);
    if (!imgs.length) return;
    let left = imgs.length;
    const done = () => {
      if (--left === 0) notifyLayoutChanged(`${reason}:images`);
    };
    imgs.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
  }
  function busy(el, fn) {
    if (el.getAttribute("aria-busy") === "true") return Promise.resolve();
    el.setAttribute("aria-busy", "true");
    return Promise.resolve().then(fn).finally(() => el.removeAttribute("aria-busy"));
  }
  function parseJSONAttr(el, name) {
    const raw = el && get(el, name);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      warn(`invalid JSON in ${attr(name)}`, el);
      return null;
    }
  }
  function toAttributes(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj.map((a) => ({ key: String(a.key), value: String(a.value ?? "") }));
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? "") }));
  }

  // src/cart.js
  function toLineInput(input, quantity = 1, opts = {}) {
    const src = typeof input === "object" && input !== null ? input : { variantId: input, quantity, ...opts };
    const merchandiseId = GID.variant(src.merchandiseId || src.variantId || src.id);
    if (!merchandiseId) throw new TetherError("add(): variantId is required");
    const line = { merchandiseId, quantity: Math.max(1, parseInt(src.quantity ?? 1, 10) || 1) };
    const plan = src.sellingPlanId || src.sellingPlan;
    if (plan) line.sellingPlanId = GID.sellingPlan(plan);
    const attrs = toAttributes(src.attributes);
    if (attrs.length) line.attributes = attrs;
    return line;
  }
  function mutation(name, args, inner) {
    return `mutation Tether_${name}(${args}){${name}(${inner}){cart{...TetherCart}userErrors{field message}warnings{code message target}}}${cartFragment()}`;
  }
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var returnFocus = null;
  var focusables = (d) => qsa(d, FOCUSABLE).filter((el) => el.offsetParent !== null || el === document.activeElement);
  function ariaState(open) {
    qsa(document, sel("cart-open")).forEach((b) => b.setAttribute("aria-expanded", String(open)));
    qsa(document, sel("cart-drawer")).forEach((d) => {
      if (!d.hasAttribute("role")) d.setAttribute("role", "dialog");
      if (!d.hasAttribute("aria-label") && !d.hasAttribute("aria-labelledby")) d.setAttribute("aria-label", get(d, "cart-label") || "Cart");
      d.setAttribute("aria-modal", String(open));
      if (!d.classList.contains(cfg.cartDrawerOpenClass)) {
        d.setAttribute("aria-hidden", "true");
        if (cfg.cartFocus !== false) d.inert = true;
      }
    });
  }
  var isMissingCart = (err) => /does not exist|not found|invalid id/i.test(err?.message || "");
  var Cart = {
    state: null,
    _chain: Promise.resolve(),
    id() {
      try {
        return localStorage.getItem(cfg.storageKey);
      } catch {
        return null;
      }
    },
    _setId(id) {
      try {
        if (id) localStorage.setItem(cfg.storageKey, id);
        else localStorage.removeItem(cfg.storageKey);
      } catch {
      }
    },
    get lines() {
      return this.state?.lines?.nodes || [];
    },
    get count() {
      return this.state?.totalQuantity || 0;
    },
    lastError: null,
    /** Set by the account part while a customer is logged in (Customer Account API token). */
    customerAccessToken: null,
    /** line id -> { qty, done }: what quick +/- clicks asked for, shown until Shopify has answered. */
    pendingQty: /* @__PURE__ */ new Map(),
    /** Shopify's notes on the last change, e.g. less stock than asked: [{ code, message }]. */
    warnings: [],
    /** true once the saved cart (or the absence of one) is known. */
    loaded: false,
    _take(payload, name) {
      const p = unwrap(payload, name);
      this.warnings = (p.warnings || []).filter((w, i, all) => all.findIndex((x) => x.message === w.message) === i).map((w) => ({ ...w, message: typeof cfg.warningText === "function" && cfg.warningText(w) || w.message }));
      if (this.warnings.length) emit("cart-warning", { warnings: this.warnings });
      return p.cart;
    },
    _queue(fn) {
      const run = this._chain.then(fn, fn).then((value) => {
        if (this.lastError) {
          this.lastError = null;
          this.render();
        }
        return value;
      }, (err) => {
        this.lastError = err;
        this.render();
        emit("cart-error", { error: err });
        throw err;
      });
      this._chain = run.catch(() => {
      });
      return run;
    },
    _commit(cart, reason) {
      this.state = cart;
      if (cart?.id) this._setId(cart.id);
      try {
        localStorage.setItem(`${cfg.storageKey}:seen`, `${Date.now()}|${cart?.totalQuantity || 0}`);
      } catch {
      }
      this.render();
      emit("cart-updated", { cart, reason });
      return cart;
    },
    async init() {
      const id = this.id();
      if (!id) {
        this.state = null;
        this.loaded = true;
        this.render();
        emit("cart-updated", { cart: null, reason: "load" });
        return null;
      }
      if (!this.loaded) {
        try {
          const n = (localStorage.getItem(`${cfg.storageKey}:seen`) || "").split("|")[1];
          if (n) qsa(document, sel("cart-count")).forEach((el) => {
            if (/^\s*0?\s*$/.test(el.textContent)) el.textContent = n;
          });
        } catch {
        }
      }
      try {
        const data = await gql(`query TetherCart($id:ID!){cart(id:$id){...TetherCart}}${cartFragment()}`, { id });
        if (!data.cart) {
          this._setId(null);
          this.state = null;
        } else this.state = data.cart;
      } catch (err) {
        reportError(err, "cart load failed");
        this.lastError = err;
        if (isMissingCart(err)) this._setId(null);
        this.state = null;
      }
      this.loaded = true;
      this.render();
      emit("cart-updated", { cart: this.state, reason: "load" });
      return this.state;
    },
    async _create(input = {}) {
      const buyerIdentity = cfg.country || this.customerAccessToken ? {
        ...cfg.country ? { countryCode: String(cfg.country).toUpperCase() } : {},
        ...this.customerAccessToken ? { customerAccessToken: this.customerAccessToken } : {}
      } : void 0;
      const data = await gql(
        mutation("cartCreate", "$input: CartInput!", "input: $input"),
        { input: { buyerIdentity, ...input } }
      );
      return this._take(data.cartCreate, "cartCreate");
    },
    /** Runs a cart mutation; creates a fresh cart if ours expired. */
    async _mutate(name, args, inner, variables, createInput) {
      const cartId = this.id();
      if (!cartId) return createInput ? this._create(createInput) : null;
      try {
        const data = await gql(mutation(name, `$cartId: ID!, ${args}`, `cartId: $cartId, ${inner}`), { ...variables, cartId });
        return this._take(data[name], name);
      } catch (err) {
        if (createInput && isMissingCart(err)) {
          log("cart expired, creating a new one");
          this._setId(null);
          return this._create(createInput);
        }
        throw err;
      }
    },
    /**
     * add('gid://shopify/ProductVariant/1', 2)
     * add({ variantId, quantity, sellingPlanId, attributes })
     * add([line, line])   // bundles / build-a-box in one request
     */
    add(input, quantity = 1, opts = {}) {
      const lines = (Array.isArray(input) ? input : [input]).map((l) => toLineInput(l, quantity, opts));
      return this._queue(async () => {
        const cart = await this._mutate("cartLinesAdd", "$lines: [CartLineInput!]!", "lines: $lines", { lines }, { lines });
        this._commit(cart, "add");
        emit("added", { cart, lines });
        if (cfg.openCartOnAdd) this.open();
        return cart;
      });
    },
    /**
     * updateLine(lineId, 3)
     * updateLine(lineId, { quantity, sellingPlanId, attributes })
     * sellingPlanId: null switches a line back to one-time purchase.
     */
    updateLine(lineId, patch) {
      const p = typeof patch === "number" ? { quantity: patch } : { ...patch };
      if (p.quantity !== void 0 && p.quantity <= 0) return this.removeLine(lineId);
      const line = { id: lineId };
      if (p.quantity !== void 0) line.quantity = p.quantity;
      if ("sellingPlanId" in p) line.sellingPlanId = p.sellingPlanId ? GID.sellingPlan(p.sellingPlanId) : null;
      if (p.attributes) line.attributes = toAttributes(p.attributes);
      if (p.merchandiseId || p.variantId) line.merchandiseId = GID.variant(p.merchandiseId || p.variantId);
      return this._queue(async () => this._commit(
        await this._mutate("cartLinesUpdate", "$lines: [CartLineUpdateInput!]!", "lines: $lines", { lines: [line] }),
        "update"
      ));
    },
    /**
     * +1 / -1 for a line. Quick clicks add up: each builds on the quantity the last click asked for,
     * which shows at once (tether-line="quantity", Cart.lines) until Shopify has answered.
     */
    changeQuantity(lineId, delta) {
      const current = this.lines.find((l) => l.id === lineId);
      if (!current) return Promise.resolve(this.state);
      const target = Math.max(0, (this.pendingQty.get(lineId)?.qty ?? current.quantity) + delta);
      const job = { qty: target, done: false };
      this.pendingQty.set(lineId, job);
      this.render();
      emit("cart-updated", { cart: this.state, reason: "pending" });
      return this.updateLine(lineId, target).finally(() => {
        if (this.pendingQty.get(lineId) === job) {
          this.pendingQty.delete(lineId);
          this.render();
          emit("cart-updated", { cart: this.state, reason: "settled" });
        }
      });
    },
    /** Quantity to show for a line: the one asked for while an update is on its way. */
    quantityOf(line) {
      return this.pendingQty.get(line.id)?.qty ?? line.quantity;
    },
    removeLine(lineIds) {
      const ids = Array.isArray(lineIds) ? lineIds : [lineIds];
      return this._queue(async () => this._commit(
        await this._mutate("cartLinesRemove", "$lineIds: [ID!]!", "lineIds: $lineIds", { lineIds: ids }),
        "remove"
      ));
    },
    clear() {
      const ids = this.lines.map((l) => l.id);
      if (!ids.length) return Promise.resolve(this.state);
      return this.removeLine(ids);
    },
    setNote(note) {
      return this._queue(async () => this._commit(
        await this._mutate("cartNoteUpdate", "$note: String!", "note: $note", { note: note ?? "" }, { note: note ?? "" }),
        "note"
      ));
    },
    /** Cart-level attributes, merged with existing ones. Value '' removes a key. */
    setAttributes(obj) {
      const merged = new Map((this.state?.attributes || []).map((a) => [a.key, a.value]));
      toAttributes(obj).forEach((a) => merged.set(a.key, a.value));
      const attributes = [...merged].filter(([, v]) => v !== "").map(([key, value]) => ({ key, value }));
      return this._queue(async () => this._commit(
        await this._mutate("cartAttributesUpdate", "$attributes: [AttributeInput!]!", "attributes: $attributes", { attributes }, { attributes }),
        "attributes"
      ));
    },
    /** Replaces the discount codes. Pass [] to remove all. */
    setDiscountCodes(codes) {
      const discountCodes = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c).trim()).filter(Boolean);
      return this._queue(async () => this._commit(
        await this._mutate("cartDiscountCodesUpdate", "$discountCodes: [String!]!", "discountCodes: $discountCodes", { discountCodes }, { discountCodes }),
        "discount"
      ));
    },
    /**
     * Adds a code. A code Shopify doesn't accept isn't kept in the cart (it would warn on every change):
     * it's removed again and the promise rejects with code INVALID_DISCOUNT.
     */
    async applyDiscount(code) {
      const current = (this.state?.discountCodes || []).map((d) => d.code);
      const cart = await this.setDiscountCodes([.../* @__PURE__ */ new Set([...current, code])]);
      const hit = (cart?.discountCodes || []).find((d) => d.code.toLowerCase() === String(code).toLowerCase());
      if (hit?.applicable) return cart;
      await this.removeDiscount(code).catch(() => {
      });
      throw new TetherError(`Discount code not valid: ${code}`, { code: "INVALID_DISCOUNT" });
    },
    removeDiscount(code) {
      const k = String(code).toLowerCase();
      return this.setDiscountCodes((this.state?.discountCodes || []).map((d) => d.code).filter((c) => c.toLowerCase() !== k));
    },
    /** { countryCode, email, phone } — changes currency/prices for that market. */
    setBuyerIdentity(buyerIdentity, { create = true } = {}) {
      return this._queue(async () => {
        const cart = await this._mutate("cartBuyerIdentityUpdate", "$buyerIdentity: CartBuyerIdentityInput!", "buyerIdentity: $buyerIdentity", { buyerIdentity }, create ? { buyerIdentity } : null).catch((err) => {
          if (create || !isMissingCart(err)) throw err;
          this._setId(null);
          return null;
        });
        return this._commit(cart, "buyer-identity");
      });
    },
    /**
     * Goes to Shopify checkout. With checkoutTarget '_blank' the tab is opened
     * inside the click (Safari blocks window.open after an await) and gets its
     * URL once we have it.
     */
    async checkout(target = cfg.checkoutTarget) {
      const id = this.id();
      if (!id || this.state && !this.count) return null;
      const tab = target === "_blank" ? window.open("", "_blank") : null;
      if (tab) {
        try {
          tab.opener = null;
        } catch {
        }
      }
      try {
        const data = await gql("query TetherCheckout($id: ID!) { cart(id: $id) { checkoutUrl } }", { id });
        let url = data.cart?.checkoutUrl;
        if (url && this.customerAccessToken) url += `${url.includes("?") ? "&" : "?"}logged_in=true`;
        if (!url) throw new TetherError("No checkoutUrl (cart empty or expired)");
        emit("checkout", { url, cart: this.state });
        if (tab && !tab.closed) tab.location.href = url;
        else window.location.href = url;
        return url;
      } catch (err) {
        if (tab) tab.close();
        reportError(err, "checkout failed");
        return null;
      }
    },
    // -------------------------------------------------------------- drawer
    drawers() {
      return qsa(document, sel("cart-drawer"));
    },
    /** Without a tether-cart-drawer (a React/Svelte/Vue cart), open/close still work: as state for subscribe. */
    _open: false,
    isOpen() {
      const ds = this.drawers();
      return ds.length ? ds.some((d) => d.classList.contains(cfg.cartDrawerOpenClass)) : this._open;
    },
    open() {
      if (this.isOpen()) return;
      this._open = true;
      const ds = this.drawers().filter((d) => get(d, "cart-drawer") !== "manual");
      ds.forEach((d) => {
        d.inert = false;
        d.classList.add(cfg.cartDrawerOpenClass);
        d.setAttribute("aria-hidden", "false");
      });
      ariaState(true);
      if (cfg.cartFocus !== false && ds[0]) {
        returnFocus = document.activeElement;
        setTimeout(() => {
          const target = focusables(ds[0])[0] || ds[0];
          if (target === ds[0] && !ds[0].hasAttribute("tabindex")) ds[0].tabIndex = -1;
          target.focus?.({ preventScroll: true });
        }, 60);
      }
      if (typeof cfg.onCartOpen === "function") cfg.onCartOpen(ds);
      emit("cart-toggled", { open: true });
    },
    close() {
      if (!this.isOpen()) return;
      this._open = false;
      const ds = this.drawers();
      const hadFocus = ds.some((d) => d.contains(document.activeElement));
      ds.forEach((d) => {
        d.classList.remove(cfg.cartDrawerOpenClass);
        d.setAttribute("aria-hidden", "true");
        if (cfg.cartFocus !== false) d.inert = true;
      });
      ariaState(false);
      if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
      if (typeof cfg.onCartClose === "function") cfg.onCartClose(ds);
      emit("cart-toggled", { open: false });
    },
    toggle() {
      if (this.isOpen()) this.close();
      else this.open();
    },
    /**
     * For framework islands (React, Svelte, Vue): fn(cart, { open }) now and on every change.
     * Returns a function that stops listening.
     */
    subscribe(fn) {
      const call = () => fn(this.state, { open: this.isOpen(), count: this.count, loaded: this.loaded, warnings: this.warnings });
      const h = () => call();
      ["cart-updated", "cart-toggled"].forEach((e) => document.addEventListener(`${cfg.prefix}:${e}`, h));
      call();
      return () => ["cart-updated", "cart-toggled"].forEach((e) => document.removeEventListener(`${cfg.prefix}:${e}`, h));
    },
    // -------------------------------------------------------------- render
    render() {
      const cart = this.state;
      const count = cart ? cart.totalQuantity : 0;
      const money = (k) => cart ? formatMoney(cart.cost?.[k]) : "";
      ariaState(this.isOpen());
      qsa(document, sel("cart-count")).forEach((el) => setTextTracked(el, count));
      qsa(document, sel("cart-subtotal")).forEach((el) => setTextTracked(el, money("subtotalAmount")));
      qsa(document, sel("cart-total")).forEach((el) => setTextTracked(el, money("totalAmount")));
      qsa(document, sel("cart-checkout-charge")).forEach((el) => setTextTracked(el, money("checkoutChargeAmount")));
      const hasSub = this.lines.some((l) => l.sellingPlanAllocation);
      const conds = {
        "cart-empty": count === 0,
        "cart-filled": count > 0,
        "cart-has-subscription": hasSub,
        "cart-no-subscription": !hasSub,
        "cart-has-discount": (cart?.discountCodes || []).some((d) => d.applicable),
        "cart-error": Boolean(this.lastError),
        "cart-warning": this.warnings.length > 0
      };
      qsa(document, sel("cart-warning")).forEach((el) => setTextTracked(el, [...new Set(this.warnings.map((w) => w.message))].join(" ")));
      qsa(document, sel("show")).forEach((el) => {
        const k = get(el, "show");
        if (k in conds && !el.closest(sel("product"))) show(el, conds[k]);
      });
      qsa(document, sel("checkout")).forEach((el) => {
        el.classList.toggle("is-disabled", !count);
        el.setAttribute("aria-disabled", String(!count));
      });
      qsa(document, `textarea${sel("cart-note")},input${sel("cart-note")}`).forEach((el) => {
        if (document.activeElement !== el) el.value = cart?.note || "";
      });
      qsa(document, sel("cart-discounts")).forEach((container) => {
        repeat(container, cart?.discountCodes || [], (node, d) => {
          node.setAttribute(attr("discount-code"), d.code);
          const t = node.querySelector(sel("discount", "code")) || (node.firstElementChild ? null : node);
          if (t) setText(t, d.code);
          node.classList.toggle("is-inapplicable", !d.applicable);
        });
      });
      qsa(document, sel("cart-lines")).forEach((container) => {
        repeatKeyed(container, this.lines, (l) => l.id, (node, line) => renderLine(node, line), {
          onEnter: cfg.onLineEnter,
          onLeave: cfg.onLineLeave
        });
      });
      if (cart) notifyLayoutChanged("cart");
    }
  };
  function lineValue(line, key) {
    const m = line.merchandise || {};
    const plan = line.sellingPlanAllocation?.sellingPlan;
    switch (key) {
      case "title":
        return m.product?.title;
      case "product-title":
        return m.product?.title;
      case "variant-title":
        return m.title === "Default Title" ? "" : m.title;
      case "options":
        return (m.selectedOptions || []).filter((o) => o.value !== "Default Title").map((o) => `${o.name}: ${o.value}`).join(", ");
      case "vendor":
        return m.product?.vendor;
      case "sku":
        return m.sku;
      case "price":
        return formatMoney(line.cost?.amountPerQuantity || m.price);
      case "compare-at-price":
        return formatMoney(line.cost?.compareAtAmountPerQuantity || m.compareAtPrice);
      case "line-total":
        return formatMoney(line.cost?.totalAmount);
      case "line-subtotal":
        return formatMoney(line.cost?.subtotalAmount);
      case "quantity":
        return Cart.quantityOf(line);
      case "plan":
        return plan?.name || "";
      case "plan-description":
        return plan?.description || "";
      case "components":
        return (line.lineComponents || []).map((c) => `${c.quantity} \xD7 ${c.merchandise?.product?.title || ""}`).join(", ");
      default:
        if (key.startsWith("attribute:")) {
          const k = key.slice("attribute:".length);
          return (line.attributes || []).find((a) => a.key === k)?.value || "";
        }
        return void 0;
    }
  }
  function renderLine(node, line) {
    const m = line.merchandise || {};
    const isSub = Boolean(line.sellingPlanAllocation);
    node.setAttribute(attr("line-id"), line.id);
    node.classList.toggle("is-subscription", isSub);
    qsa(node, sel("line")).forEach((el) => {
      const key = get(el, "line");
      if (key === "image") return setImage(el, m.image?.url || m.product?.featuredImage?.url, m.product?.title);
      if (key === "url") {
        const u = productUrl(m.product?.handle, m.product?.id);
        const q = new URLSearchParams();
        if (m.id) q.set("variant", String(m.id).split("/").pop());
        const plan = line.sellingPlanAllocation?.sellingPlan?.id;
        if (plan) q.set("selling_plan", plan.split("/").pop());
        const qs = q.toString();
        return el.setAttribute("href", qs ? `${u}${u.includes("?") ? "&" : "?"}${qs}` : u);
      }
      const v = lineValue(line, key);
      if (v !== void 0) setTextTracked(el, v);
      return void 0;
    });
    const warning = Cart.warnings.find((w) => w.target === line.id);
    node.classList.toggle("is-warning", Boolean(warning));
    const pending2 = Cart.pendingQty.has(line.id);
    node.classList.toggle("is-busy", pending2);
    if (pending2) node.setAttribute("aria-busy", "true");
    else node.removeAttribute("aria-busy");
    qsa(node, sel("line", "warning")).forEach((el) => setTextTracked(el, warning?.message || ""));
    const lineConds = {
      subscription: isSub,
      "one-time": !isSub,
      "on-sale": parseFloat(line.cost?.compareAtAmountPerQuantity?.amount) > parseFloat(line.cost?.amountPerQuantity?.amount),
      "has-components": (line.lineComponents || []).length > 0,
      warning: Boolean(warning)
    };
    qsa(node, sel("line-show")).forEach((el) => {
      const k = get(el, "line-show");
      if (k in lineConds) show(el, lineConds[k]);
    });
    qsa(node, `select${sel("line-plan")}`).forEach((select) => {
      const handle = m.product?.handle;
      if (!handle) return;
      getProduct(handle).then((product) => {
        const plans = allPlans(product);
        const allowOneTime = !product.requiresSellingPlan && get(select, "line-plan") !== "subscription-only";
        const want = [
          ...allowOneTime ? [{ value: "", label: select.getAttribute(attr("one-time-label")) || "One-time purchase" }] : [],
          ...plans.map((p) => ({ value: p.id, label: p.name }))
        ];
        const sig = want.map((w) => w.value).join("|");
        if (select.dataset.tetherSig !== sig) {
          select.innerHTML = "";
          want.forEach((w) => {
            const o = document.createElement("option");
            o.value = w.value;
            o.textContent = w.label;
            select.appendChild(o);
          });
          select.dataset.tetherSig = sig;
        }
        select.value = line.sellingPlanAllocation?.sellingPlan?.id || "";
        show(select, plans.length > 0);
      }).catch((err) => reportError(err, "line plan options"));
    });
  }

  // src/product.js
  var product_exports = {};
  __export(product_exports, {
    ProductScope: () => ProductScope,
    rememberOptionNames: () => rememberOptionNames,
    scopes: () => scopes
  });

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
  function resolveProductKey(el, location = window.location, name = "product") {
    const raw = (get(el, name) || "").trim();
    if (!raw.toLowerCase().startsWith("url:")) return { key: raw || null, fromUrl: false, raw };
    const what = raw.slice(4).trim();
    let key = null;
    if (what.toLowerCase() === "path") {
      const parts2 = location.pathname.split("/").filter(Boolean);
      key = parts2.length ? safeDecode(parts2[parts2.length - 1]) : null;
    } else {
      key = new URLSearchParams(location.search).get(what || "handle");
    }
    key = key && key.trim() ? key.trim() : null;
    return { key, fromUrl: true, raw };
  }
  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }
  var STATUS_KEYS = ["loading", "ready", "error", "not-found"];
  var isNotFound = (err) => err?.code === "NOT_FOUND";
  var boundary = () => ["product", "collection", "products", "recommendations"].map((n) => sel(n)).join(",");
  var ownedBy = (el, root) => el === root || el.parentElement?.closest(boundary()) === root;
  function setScopeStatus(root, status, err) {
    const notFound = status === "not-found";
    root.setAttribute(attr("state"), notFound ? "error" : status);
    if (status === "error" || notFound) root.setAttribute(attr("error"), notFound ? "not-found" : err?.code || "error");
    else root.removeAttribute(attr("error"));
    scoped(root, sel("show"), boundary()).forEach((el) => {
      const k = get(el, "show");
      if (!STATUS_KEYS.includes(k)) return;
      show(el, k === status);
    });
    if (status === "error" || notFound) {
      scoped(root, sel("add-to-cart"), boundary()).forEach((btn) => {
        btn.classList.add("is-disabled");
        btn.setAttribute("aria-disabled", "true");
        if ("disabled" in btn) btn.disabled = true;
      });
    }
  }

  // src/product.js
  var scopes = /* @__PURE__ */ new WeakMap();
  var productSel = () => sel("product");
  function metafieldValue(product, ref) {
    const i = ref.indexOf(".");
    const ns = ref.slice(0, i);
    const key = ref.slice(i + 1);
    const mf = (product.metafields || []).find((m) => m && m.namespace === ns && m.key === key);
    return mf || null;
  }
  var knownOptionNames = /* @__PURE__ */ new Map();
  function rememberOptionNames(products) {
    (products || []).forEach((p) => {
      if (p?.handle && !knownOptionNames.has(p.handle)) knownOptionNames.set(p.handle, (p.options || []).map((o) => o.name));
    });
  }
  var ProductScope = class {
    constructor(root, product) {
      this.root = root;
      this.product = product;
      this.selected = {};
      this.variant = null;
      this.quantity = Math.max(0, parseInt(get(root, "quantity") ?? "1", 10) || (has(root, "quantity") ? 0 : 1));
      this.plans = allPlans(product);
      this.purchase = "one-time";
      this.planId = null;
      scopes.set(root, this);
      root.setAttribute(attr("state"), "ready");
      root.removeAttribute(attr("error"));
      this.initSelection();
      this.initPurchase();
      this.renderProduct();
      this.bind();
      this.renderVariant();
      watchImages(root, "product");
      notifyLayoutChanged("product");
      emit("product-ready", { product, scope: this }, root);
    }
    /** New data for the same product (e.g. after a country switch). Keeps the selection. */
    update(product) {
      const variantId = this.variant?.id;
      this.product = product;
      this.plans = allPlans(product);
      if (this.planId && !this.plans.some((p) => p.id === this.planId)) this.planId = this.plans[0]?.id || null;
      if (!this.plans.length && this.purchase === "subscription") this.purchase = "one-time";
      const v = product.variants.nodes.find((x) => x.id === variantId);
      if (v) {
        this.selected = {};
        v.selectedOptions.forEach((o) => {
          this.selected[o.name] = o.value;
        });
      }
      this.root.setAttribute(attr("state"), "ready");
      this.root.removeAttribute(attr("error"));
      this.renderProduct();
      this.renderVariant();
      notifyLayoutChanged("product");
      emit("product-updated", { product, scope: this }, this.root);
    }
    /** Matching elements in this scope, including the root itself (e.g. a card link with tether-bind="link"). */
    $(s) {
      const inner = scoped(this.root, s, productSel());
      return this.root.matches(s) ? [this.root, ...inner] : inner;
    }
    // ------------------------------------------------------------ state
    /** The product's option name for a name used in the markup (same name, or same position). */
    optName(authored) {
      const opts = this.product?.options || [];
      if (!authored || opts.some((o) => o.name === authored)) return authored;
      const i = (knownOptionNames.get(this.product.handle) || []).indexOf(authored);
      return i >= 0 && opts[i] ? opts[i].name : authored;
    }
    initSelection() {
      const vs = this.product.variants.nodes;
      const first = vs.find((v) => v.availableForSale) || vs[0];
      if (first) first.selectedOptions.forEach((o) => {
        this.selected[o.name] = o.value;
      });
      const param = new URLSearchParams(window.location.search).get("variant") || get(this.root, "variant");
      if (param) {
        const gid = GID.variant(param);
        const match = vs.find((v) => v.id === gid);
        if (match) {
          this.selected = {};
          match.selectedOptions.forEach((o) => {
            this.selected[o.name] = o.value;
          });
        }
      }
    }
    initPurchase() {
      if (!this.plans.length) return;
      const params = new URLSearchParams(window.location.search);
      const fromUrl = findPlan(this.product, params.get("selling_plan"));
      const fromAttr = findPlan(this.product, get(this.root, "default-plan"));
      this.planId = (fromUrl || fromAttr || this.plans[0]).id;
      const wanted = fromUrl ? "subscription" : get(this.root, "default-purchase") || cfg.defaultPurchase;
      this.purchase = this.product.requiresSellingPlan || wanted === "subscription" ? "subscription" : "one-time";
    }
    findVariant() {
      return this.product.variants.nodes.find((v) => v.selectedOptions.every((o) => this.selected[o.name] === o.value)) || null;
    }
    isValueAvailable(name, value) {
      return this.product.variants.nodes.some((v) => v.availableForSale && v.selectedOptions.every((o) => o.name === name ? o.value === value : this.selected[o.name] === o.value));
    }
    get plan() {
      return this.plans.find((p) => p.id === this.planId) || null;
    }
    /** True when the current variant can be bought on the selected plan. */
    get subscriptionAvailable() {
      return Boolean(this.variant && this.plans.some((p) => allocationFor(this.variant, p.id)));
    }
    get isSubscription() {
      return this.purchase === "subscription" && Boolean(allocationFor(this.variant, this.planId));
    }
    /** What would be added to the cart right now. */
    getLine() {
      if (!this.variant) return null;
      const line = { merchandiseId: this.variant.id, quantity: this.quantity };
      if (this.isSubscription) line.sellingPlanId = this.planId;
      const attrs = this.collectAttributes();
      if (attrs.length) line.attributes = attrs;
      return line;
    }
    collectAttributes() {
      const fixed = toAttributes(parseJSONAttr(this.root, "line-attributes"));
      const inputs = this.$(sel("line-attribute")).map((el) => {
        const key = get(el, "line-attribute");
        let value;
        if (el.type === "checkbox") value = el.checked ? el.value && el.value !== "on" ? el.value : "Yes" : "";
        else if (el.type === "radio") value = el.checked ? el.value : null;
        else value = el.value;
        return value == null || value === "" ? null : { key, value: String(value) };
      }).filter(Boolean);
      return [...fixed, ...inputs];
    }
    // ------------------------------------------------------------ actions
    select(name, value) {
      if (this.selected[name] === value) return;
      const vs = this.product.variants.nodes.filter((v) => v.selectedOptions.some((o) => o.name === name && o.value === value));
      if (!vs.length) return;
      const next = { ...this.selected, [name]: value };
      if (!vs.some((v) => v.selectedOptions.every((o) => next[o.name] === o.value))) {
        const score = (v) => v.selectedOptions.filter((o) => o.name !== name && this.selected[o.name] === o.value).length * 2 + (v.availableForSale ? 1 : 0);
        const best = vs.reduce((a, b) => score(b) > score(a) ? b : a);
        best.selectedOptions.forEach((o) => {
          next[o.name] = o.value;
        });
      }
      this.selected = next;
      this.renderVariant();
    }
    selectVariant(id) {
      const v = this.product.variants.nodes.find((x) => x.id === GID.variant(id));
      if (!v) return;
      this.selected = {};
      v.selectedOptions.forEach((o) => {
        this.selected[o.name] = o.value;
      });
      this.renderVariant();
    }
    setPurchase(mode) {
      const next = mode === "subscription" ? "subscription" : "one-time";
      if (next === "one-time" && this.product.requiresSellingPlan) return;
      if (this.purchase === next) return;
      this.purchase = next;
      this.renderVariant();
    }
    selectPlan(ref) {
      const p = findPlan(this.product, ref);
      if (!p) return;
      this.planId = p.id;
      this.purchase = "subscription";
      this.renderVariant();
    }
    setQuantity(n) {
      const min = has(this.root, "quantity") ? 0 : 1;
      this.quantity = Math.max(min, parseInt(n, 10) || 0);
      this.$(sel("qty")).forEach((i) => setText(i, this.quantity));
      this.renderVariant();
    }
    async addToCart() {
      if (!this.variant?.availableForSale) return null;
      const line = this.getLine();
      if (!line || line.quantity < 1) return null;
      const cart = await Cart.add(line);
      emit("product-added", { product: this.product, variant: this.variant, line }, this.root);
      return cart;
    }
    // ------------------------------------------------------------ events
    bind() {
      const own = (el) => el && el.closest(productSel()) === this.root;
      this.root.addEventListener("click", (e) => {
        const t = e.target;
        if (!t?.closest) return;
        const opt = t.closest(sel("option-value"));
        if (own(opt) && opt.closest(sel("option-list"))) {
          e.preventDefault();
          this.select(this.optName(get(opt.closest(sel("option-list")), "option-list")), get(opt, "option-value"));
          return;
        }
        const plan = t.closest(sel("plan-value"));
        if (own(plan)) {
          e.preventDefault();
          this.selectPlan(get(plan, "plan-value"));
          return;
        }
        const purchase = t.closest(`${sel("purchase")}:not(select)`);
        if (own(purchase)) {
          if (purchase.tagName !== "INPUT") e.preventDefault();
          this.setPurchase(get(purchase, "purchase"));
          return;
        }
        const plus = t.closest(sel("qty-plus"));
        if (own(plus)) {
          e.preventDefault();
          this.setQuantity(this.quantity + 1);
          return;
        }
        const minus = t.closest(sel("qty-minus"));
        if (own(minus)) {
          e.preventDefault();
          this.setQuantity(this.quantity - 1);
          return;
        }
        const add = t.closest(sel("add-to-cart"));
        if (own(add)) {
          e.preventDefault();
          this.onAddClick(add);
        }
      });
      this.root.addEventListener("change", (e) => {
        const t = e.target;
        if (!own(t)) return;
        if (t.matches(`select${sel("option")}`)) this.select(this.optName(get(t, "option")), t.value);
        else if (t.matches(`select${sel("variant-select")}`)) this.selectVariant(t.value);
        else if (t.matches(`select${sel("plan")}`)) {
          if (t.value) this.selectPlan(t.value);
          else this.setPurchase("one-time");
        } else if (t.matches(`select${sel("purchase")}`)) this.setPurchase(t.value);
        else if (t.matches(sel("qty"))) this.setQuantity(t.value);
      });
    }
    onAddClick(btn) {
      const label = btn.querySelector(sel("add-label")) || btn;
      const busyText = get(btn, "adding-text");
      const write = (txt) => setText(label, txt);
      if (label.dataset.tetherLabel === void 0) label.dataset.tetherLabel = label.tagName === "INPUT" ? label.value : label.textContent;
      busy(btn, async () => {
        if (busyText) write(busyText);
        try {
          await this.addToCart();
        } catch (err) {
          reportError(err, "add to cart failed");
          emit("error", { error: err, context: "add-to-cart" }, this.root);
        } finally {
          if (busyText) write(label.dataset.tetherLabel);
        }
      }).then(() => {
        this.renderVariant();
      });
    }
    // ------------------------------------------------------------ render
    renderProduct() {
      const p0 = this.product;
      if (!knownOptionNames.has(p0.handle)) {
        const authored = this.$(`${sel("option-list")},select${sel("option")}`).map((e) => get(e, "option-list") || get(e, "option"));
        if (authored.some((n) => p0.options.some((o) => o.name === n))) rememberOptionNames([p0]);
      }
      const p = this.product;
      this.$(sel("bind")).forEach((el) => {
        const key = get(el, "bind") || "";
        const txt = {
          title: p.title,
          "description-text": p.description,
          vendor: p.vendor,
          type: p.productType,
          handle: p.handle
        }[key];
        if (txt !== void 0) return setText(el, txt);
        switch (key) {
          case "description":
            el.innerHTML = p.descriptionHtml || "";
            return void 0;
          case "published-at":
            return setText(el, formatDate(p.publishedAt));
          case "min-price":
            return setText(el, formatMoney(p.priceRange.minVariantPrice));
          case "max-price":
            return setText(el, formatMoney(p.priceRange.maxVariantPrice));
          case "featured-image":
            return setImage(el, p.featuredImage?.url, p.featuredImage?.altText || p.title);
          case "url":
          case "link":
            el.setAttribute("href", productUrl(p.handle, p.id));
            if (key === "url" && !el.firstElementChild && !el.textContent.trim()) setText(el, p.title);
            return void 0;
          case "images":
            {
              const imgs = [...el.children].map((n) => n.tagName === "IMG" ? n : n.querySelector("img"));
              if (!hasTemplate(el) && imgs.length === p.images.nodes.length && imgs.every((im, i) => sameImage(im?.getAttribute("src"), p.images.nodes[i].url))) return void 0;
            }
            return repeat(el, p.images.nodes, (node, img) => {
              const target = node.matches(`img,${sel("bind", "image")}`) ? node : node.querySelector("img") || node;
              setImage(target, img.url, img.altText || p.title);
            });
          case "tags": {
            const exclude = (el.getAttribute("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);
            return repeat(el, p.tags.filter((t) => !exclude.includes(t)), (node, tag) => setText(node, tag));
          }
          default:
            if (/^image:\d+$/.test(key)) {
              const img = p.images.nodes[key.slice(6) - 1] || p.featuredImage;
              return setImage(el, img?.url, img?.altText || p.title);
            }
            if (key.startsWith("metafield:")) {
              const mf = metafieldValue(p, key.slice(10));
              if (!mf) return setText(el, "");
              if (mf.reference?.image) return setImage(el, mf.reference.image.url, mf.reference.image.altText);
              if (/^(rich_text|multi_line_text)_field$/.test(mf.type)) el.style.whiteSpace = "pre-line";
              return setText(el, mf.value);
            }
            return void 0;
        }
      });
      this.$(sel("option-list")).forEach((container) => {
        const name = this.optName(get(container, "option-list"));
        const opt = p.options.find((o) => o.name === name);
        if (!opt || opt.optionValues.length <= 1 && has(container, "hide-single")) return show(container, false);
        return repeat(container, opt.optionValues, (node, v) => {
          node.setAttribute(attr("option-value"), v.name);
          const t = node.querySelector(sel("bind", "option-value"));
          if (t) setText(t, v.name);
          else if (!node.firstElementChild) setText(node, v.name);
          const sw = node.querySelector(sel("bind", "swatch"));
          if (sw && v.swatch?.color) sw.style.backgroundColor = v.swatch.color;
          if (sw && v.swatch?.image?.previewImage) setImage(sw, v.swatch.image.previewImage.url, v.name);
        });
      });
      this.$(`select${sel("option")}`).forEach((s) => {
        const opt = p.options.find((o) => o.name === this.optName(get(s, "option")));
        if (!opt) return show(s, false);
        s.innerHTML = "";
        opt.optionValues.forEach((v) => s.appendChild(new Option(v.name, v.name)));
        return void 0;
      });
      this.$(`select${sel("variant-select")}`).forEach((s) => {
        s.innerHTML = "";
        p.variants.nodes.forEach((v) => s.appendChild(new Option(v.title, v.id)));
      });
      this.$(sel("plan-list")).forEach((container) => {
        const raw = (get(container, "plan-list") || "").trim();
        const group = ["", "true", "all", "*"].includes(raw.toLowerCase()) ? null : raw;
        const plans = this.plans.filter((pl) => !group || pl.group.name === group);
        repeat(container, plans, (node, plan) => {
          node.setAttribute(attr("plan-value"), plan.id);
          if (!node.firstElementChild && !node.querySelector(sel("plan-bind"))) setText(node, plan.name);
        });
      });
      this.$(`select${sel("plan")}`).forEach((s) => {
        s.innerHTML = "";
        if (!p.requiresSellingPlan && get(s, "plan") !== "subscription-only") {
          s.appendChild(new Option(s.getAttribute(attr("one-time-label")) || "One-time purchase", ""));
        }
        this.plans.forEach((pl) => s.appendChild(new Option(pl.name, pl.id)));
      });
    }
    renderVariant() {
      const p = this.product;
      let v = this.findVariant();
      if (!v) {
        [v] = p.variants.nodes;
        if (v) {
          this.selected = {};
          v.selectedOptions.forEach((o) => {
            this.selected[o.name] = o.value;
          });
        }
      }
      this.variant = v;
      if (!v) return;
      if (this.plans.length && !allocationFor(v, this.planId)) {
        const alt = this.plans.find((pl) => allocationFor(v, pl.id));
        if (alt) this.planId = alt.id;
      }
      const sub = this.isSubscription;
      const oneTimePrice = v.price;
      const subPrice = this.planId ? planPrice(v, this.planId) : null;
      const price = sub ? subPrice : oneTimePrice;
      const compareAt = sub ? allocationFor(v, this.planId)?.priceAdjustments?.[0]?.compareAtPrice || v.compareAtPrice : v.compareAtPrice;
      const onSale = compareAt && parseFloat(compareAt.amount) > parseFloat(price.amount);
      const discountPct = onSale ? Math.round((1 - parseFloat(price.amount) / parseFloat(compareAt.amount)) * 100) : 0;
      const savings = this.planId ? planSavings(v, this.planId) : { amount: null, percentage: 0 };
      const plan = this.plan;
      const total = { amount: (parseFloat(price.amount) * Math.max(1, this.quantity)).toFixed(2), currencyCode: price.currencyCode };
      const fm = formatMoney;
      const pct = (n) => formatPercent(n);
      const text = {
        price: () => fm(price),
        "total-price": () => fm(total),
        "one-time-price": () => fm(oneTimePrice),
        "subscription-price": () => fm(subPrice),
        "subscription-savings": () => pct(savings.percentage),
        "subscription-savings-amount": () => fm(savings.amount),
        // What the visitor pays today for the chosen quantity (prepaid plans charge more up front).
        "checkout-charge": () => {
          const c = sub ? planCheckoutCharge(v, this.planId) : price;
          return c && fm({ amount: (parseFloat(c.amount) * Math.max(1, this.quantity)).toFixed(2), currencyCode: c.currencyCode });
        },
        "plan-name": () => plan?.name,
        "plan-description": () => plan?.description,
        "plan-group": () => plan?.group?.name,
        "compare-at-price": () => onSale ? fm(compareAt) : "",
        "unit-price": () => fm(v.unitPrice),
        "discount-percentage": () => `${discountPct}%`,
        "discount-amount": () => onSale ? fm({ amount: String(parseFloat(compareAt.amount) - parseFloat(price.amount)), currencyCode: price.currencyCode }) : "",
        "variant-title": () => v.title,
        "variant-id": () => v.id,
        sku: () => v.sku,
        barcode: () => v.barcode,
        stock: () => v.quantityAvailable,
        quantity: () => this.quantity
      };
      this.$(sel("bind")).forEach((el) => {
        const k = get(el, "bind");
        if (k === "variant-image") setImage(el, v.image?.url || p.featuredImage?.url, v.image?.altText || p.title);
        else if (text[k]) setText(el, text[k]());
      });
      this.$(sel("option-selected")).forEach((el) => setText(el, this.selected[this.optName(get(el, "option-selected"))] || ""));
      this.$(sel("option-list")).forEach((container) => {
        const name = this.optName(get(container, "option-list"));
        qsa(container, sel("option-value")).forEach((node) => {
          const value = get(node, "option-value");
          setSelected(node, this.selected[name] === value);
          const unavailable = !this.isValueAvailable(name, value);
          node.classList.toggle("is-unavailable", unavailable);
          node.setAttribute("data-unavailable", unavailable ? "true" : "false");
        });
      });
      this.$(`select${sel("option")}`).forEach((s) => {
        s.value = this.selected[this.optName(get(s, "option"))] || "";
      });
      this.$(`select${sel("variant-select")}`).forEach((s) => {
        s.value = v.id;
      });
      this.$(sel("purchase")).forEach((el) => {
        if (el.tagName === "SELECT") {
          el.value = this.purchase;
          return;
        }
        const mode = get(el, "purchase");
        setSelected(el, mode === this.purchase);
        const unavailable = mode === "subscription" ? !this.subscriptionAvailable : p.requiresSellingPlan;
        el.classList.toggle("is-unavailable", unavailable);
      });
      this.$(sel("plan-value")).forEach((node) => {
        const id = get(node, "plan-value");
        const planObj = this.plans.find((pl) => pl.id === id);
        const inVariant = Boolean(allocationFor(v, id));
        setSelected(node, sub && id === this.planId);
        node.classList.toggle("is-unavailable", !inVariant);
        qsa(node, sel("plan-bind")).forEach((el) => {
          const adj = planAdjustment(planObj);
          const s = planSavings(v, id);
          const k = get(el, "plan-bind");
          const val = {
            name: () => planObj?.name,
            option: () => (planObj?.options || []).map((o) => o.value).join(", "),
            // e.g. "1 month", without the store's price text
            description: () => planObj?.description,
            price: () => fm(planPrice(v, id)),
            savings: () => pct(s.percentage),
            "savings-amount": () => fm(s.amount),
            adjustment: () => !adj ? "" : adj.type === "percentage" ? `${adj.value}%` : fm(adj.value)
          }[k];
          if (val) setText(el, val());
        });
      });
      this.$(`select${sel("plan")}`).forEach((s) => {
        s.value = sub ? this.planId : "";
      });
      const low = v.quantityAvailable != null && v.quantityAvailable > 0 && v.quantityAvailable <= (cfg.lowStock ?? 5);
      const conds = {
        "in-stock": v.availableForSale,
        "out-of-stock": !v.availableForSale,
        "backorder": v.availableForSale && v.currentlyNotInStock,
        "on-sale": Boolean(onSale),
        "not-on-sale": !onSale,
        "has-variants": p.variants.nodes.length > 1,
        "single-variant": p.variants.nodes.length === 1,
        "low-stock": low,
        "plenty-in-stock": v.availableForSale && !low,
        "subscription-available": this.subscriptionAvailable,
        "subscription-unavailable": !this.subscriptionAvailable,
        "subscription-only": Boolean(p.requiresSellingPlan),
        "one-time-available": !p.requiresSellingPlan,
        "subscription-selected": sub,
        "one-time-selected": !sub,
        "has-savings": sub ? savings.percentage > 0 : Boolean(onSale),
        // scope state (see status.js)
        "loading": false,
        "ready": true,
        "error": false,
        "not-found": false
      };
      this.$(sel("show")).forEach((el) => {
        const k = get(el, "show");
        if (!(k in conds)) return;
        if (STATUS_KEYS.includes(k) && !ownedBy(el, this.root)) return;
        show(el, conds[k]);
      });
      this.root.classList.toggle("is-subscription", sub);
      this.root.setAttribute(attr("purchase-mode"), sub ? "subscription" : "one-time");
      this.$(sel("add-to-cart")).forEach((btn) => {
        const disabled = !v.availableForSale;
        btn.classList.toggle("is-disabled", disabled);
        btn.setAttribute("aria-disabled", String(disabled));
        if ("disabled" in btn) btn.disabled = disabled;
        const soldOut = get(btn, "soldout-text");
        const subText = get(btn, "subscribe-text");
        if (soldOut || subText) {
          const label = btn.querySelector(sel("add-label")) || btn;
          if (label.dataset.tetherLabel === void 0) label.dataset.tetherLabel = label.tagName === "INPUT" ? label.value : label.textContent;
          let text2 = label.dataset.tetherLabel;
          if (sub && subText) text2 = subText;
          if (disabled && soldOut) text2 = soldOut;
          if (btn.getAttribute("aria-busy") !== "true") setText(label, text2);
        }
      });
      emit("variant-changed", {
        product: p,
        variant: v,
        selected: { ...this.selected },
        purchase: this.purchase,
        sellingPlanId: sub ? this.planId : null
      }, this.root);
    }
  };

  // src/collection.js
  var collection_exports = {};
  __export(collection_exports, {
    ListScope: () => ListScope,
    listSelector: () => listSelector
  });
  var listSelector = () => `${sel("collection")},${sel("products")},${sel("recommendations")}`;
  var ListScope = class {
    constructor(root) {
      this.root = root;
      this.products = [];
      this.pageInfo = null;
      this.collection = null;
      setScopeStatus(root, "loading");
      root.addEventListener("click", (e) => {
        const more = e.target.closest?.(sel("load-more"));
        if (more && more.closest(listSelector()) === root) {
          e.preventDefault();
          busy(more, () => this.load(true));
        }
      });
    }
    $(s) {
      return scoped(this.root, s, listSelector());
    }
    options() {
      const r = this.root;
      const opts = {
        first: parseInt(get(r, "limit") || "", 10) || void 0,
        sortKey: get(r, "sort") || void 0,
        reverse: get(r, "reverse") === "true"
      };
      if (has(r, "collection")) opts.collection = get(r, "collection");
      else opts.query = get(r, "products") || "";
      return opts;
    }
    async load(more = false) {
      const token = this.loadToken = (this.loadToken || 0) + 1;
      const stale2 = () => token !== this.loadToken;
      try {
        if (has(this.root, "recommendations")) {
          let { key } = resolveProductKey(this.root, window.location, "recommendations");
          const scope = this.root.closest(sel("product"));
          if (!key && scope) ({ key } = resolveProductKey(scope));
          if (!key) throw new TetherError("No product for recommendations", { code: "NOT_FOUND" });
          const recs = await getRecommendations(key, get(this.root, "intent") || "RELATED");
          if (stale2()) return;
          const limit = parseInt(get(this.root, "limit") || "", 10);
          this.products = limit ? recs.slice(0, limit) : recs;
        } else {
          const res = await getProducts({ ...this.options(), after: more ? this.pageInfo?.endCursor : null });
          if (stale2()) return;
          this.collection = res.collection;
          this.pageInfo = res.pageInfo;
          this.products = more ? [...this.products, ...res.products] : res.products;
        }
        this.render();
        setScopeStatus(this.root, "ready");
        emit("list-ready", { products: this.products, collection: this.collection }, this.root);
      } catch (err) {
        if (stale2()) return;
        if (!more) setScopeStatus(this.root, isNotFound(err) ? "not-found" : "error", err);
        if (!(isNotFound(err) && has(this.root, "recommendations"))) reportError(err, "list load failed");
        emit("error", { error: err, context: "list" }, this.root);
      }
    }
    render() {
      const c = this.collection;
      this.$(sel("collection-bind")).forEach((el) => {
        switch (get(el, "collection-bind")) {
          case "title":
            return setText(el, c?.title || "");
          case "description":
            el.innerHTML = c?.descriptionHtml || "";
            return void 0;
          case "image":
            return setImage(el, c?.image?.url, c?.image?.altText || c?.title);
          case "count":
            return setText(el, this.products.length);
          default:
            return void 0;
        }
      });
      this.$(sel("list")).forEach((container) => {
        repeat(container, this.products, (node, p) => {
          node.setAttribute(attr("product"), p.handle);
          node.removeAttribute(attr("state"));
        });
        emit("list-rendered", { container }, this.root);
      });
      const empty = this.products.length === 0;
      this.$(sel("show")).forEach((el) => {
        const k = get(el, "show");
        if (k === "list-empty") show(el, empty);
        if (k === "list-filled") show(el, !empty);
      });
      this.$(sel("load-more")).forEach((el) => show(el, Boolean(this.pageInfo?.hasNextPage)));
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
  var mountedProducts = /* @__PURE__ */ new WeakSet();
  var mountedLists = /* @__PURE__ */ new WeakSet();
  var liveProducts = /* @__PURE__ */ new Set();
  var liveLists = /* @__PURE__ */ new Set();
  var requestToken = /* @__PURE__ */ new WeakMap();
  function pruneLive() {
    liveProducts.forEach((el) => {
      if (!el.isConnected) liveProducts.delete(el);
    });
    liveLists.forEach((l) => {
      if (!l.root.isConnected) liveLists.delete(l);
    });
  }
  function within(root, selector) {
    return [...root.matches?.(selector) ? [root] : [], ...qsa(root, selector)];
  }
  function mountProduct(el) {
    if (mountedProducts.has(el)) return false;
    const { key, fromUrl, raw } = resolveProductKey(el);
    if (!key) {
      if (fromUrl) {
        mountedProducts.add(el);
        setScopeStatus(el, "not-found");
        emit("product-not-found", { key: null, source: raw }, el);
      } else if (!el.closest(listSelector())) {
        warn(`[${attr("product")}] without a value. Bind it to the Shopify handle field, or use "url:handle".`, el);
      }
      return false;
    }
    mountedProducts.add(el);
    liveProducts.add(el);
    const token = {};
    requestToken.set(el, token);
    const current = () => requestToken.get(el) === token;
    if (!scopes.get(el)) setScopeStatus(el, "loading");
    else el.setAttribute(attr("state"), "updating");
    const loading = getProduct(key);
    marketPending?.add(loading);
    loading.then((p) => {
      if (!current()) return;
      const existing = scopes.get(el);
      if (existing) existing.update(p);
      else new ProductScope(el, p);
      applyPageTitle(el, p);
      if (cfg.revalidate !== false && takeStale(key)) queueRefresh(key);
    }).catch((err) => {
      if (!current()) return;
      const notFound = isNotFound(err);
      setScopeStatus(el, notFound ? "not-found" : "error", err);
      if (notFound) {
        emit("product-not-found", { key, source: raw }, el);
        if (fromUrl) log(`product not found: ${key}`);
        else reportError(err, `product ${key}`);
      } else {
        reportError(err, `product ${key}`);
        emit("error", { error: err, context: "product", key }, el);
      }
    });
    return true;
  }
  function applyPageTitle(el, p) {
    const tpl = get(el, "page-title");
    if (!tpl || typeof document === "undefined") return;
    document.title = tpl.replace(/\{title\}/g, p.title).replace(/\{vendor\}/g, p.vendor || "").replace(/\{type\}/g, p.productType || "");
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
  function flushRefresh() {
    const keys = [...refreshQueue];
    refreshQueue = /* @__PURE__ */ new Set();
    refreshProducts(keys).forEach((promise, i) => promise.then((fresh) => {
      liveProducts.forEach((el) => {
        const scope = scopes.get(el);
        if (!scope || !el.isConnected) return;
        const k = resolveProductKey(el).key;
        if (k !== keys[i] && k !== fresh.handle && k !== fresh.id) return;
        if (JSON.stringify(scope.product) !== JSON.stringify(fresh)) scope.update(fresh);
      });
    }).catch((err) => reportError(err, `refresh ${keys[i]}`)));
  }
  var readScripts = /* @__PURE__ */ new WeakSet();
  var marketPending = null;
  var trackMarket = (p) => {
    marketPending?.add(p);
    return p;
  };
  function settleMarket() {
    if (!marketPending) return;
    const waits = [...marketPending];
    Promise.allSettled(waits).then(() => {
      if (!marketPending || waits.some((w) => !marketPending.has(w))) return;
      if (waits.length === marketPending.size) {
        marketPending = null;
        document.documentElement.classList.remove(`${cfg.prefix}-market-pending`);
      } else settleMarket();
    });
  }
  function hydrateFromPage(root = document) {
    qsa(root.ownerDocument || root, 'script[type="application/json"][data-tether-hydrate]').forEach((s) => {
      if (readScripts.has(s)) return;
      readScripts.add(s);
      try {
        const data = JSON.parse(s.textContent);
        rememberOptionNames(data.products);
        const same = (a, b) => String(a || "").toUpperCase() === String(b || "").toUpperCase();
        if (same(data.country, cfg.country) && same(data.language, cfg.language)) hydrateProducts(data.products);
        else {
          log("hydration skipped: other market");
          if (!marketPending) {
            marketPending = /* @__PURE__ */ new Set();
            document.documentElement.classList.add(`${cfg.prefix}-market-pending`);
          }
        }
      } catch (err) {
        warn("bad data-tether-hydrate", err);
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
    "mounting.js": mounting_exports
  };
  var self = typeof document !== "undefined" ? document.currentScript?.src || "" : "";
  var parts = {};
  function loadPart(name) {
    if (parts[name]) return parts[name];
    const base = cfg2.partsUrl || self.replace(/[^/]*$/, "");
    const min = /\.min\.js(\?|$)/.test(self) || !self ? ".min" : "";
    const url = `${base.replace(/\/?$/, "/")}tether.${name}${min}.js`;
    parts[name] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => window.Tether?.__parts?.[name] ? resolve(window.Tether.__parts[name]) : reject(new Error(`${url} did not register`));
      s.onerror = () => {
        delete parts[name];
        reject(new Error(`Could not load ${url}. Host it next to the Tether script, or set partsUrl.`));
      };
      document.head.appendChild(s);
    });
    return parts[name];
  }

  // src/index.js
  var VERSION = "0.5.0";
  var initPromise = null;
  var observer = null;
  function mount(root = document) {
    if (!isConfigured()) return 0;
    let count = 0;
    pruneLive();
    hydrateFromPage(root);
    within(root, listSelector()).forEach((el) => {
      if (mountedLists.has(el)) return;
      mountedLists.add(el);
      count++;
      const list = new ListScope(el);
      liveLists.add(list);
      el.addEventListener(`${cfg.prefix}:list-rendered`, (e) => mount(e.detail.container));
      trackMarket(list.load());
    });
    within(root, sel("product")).forEach((el) => {
      if (mountProduct(el)) count++;
    });
    if (within(root, `${sel("country-select")},${sel("country-bind")}`).length) {
      loadPart("markets").then((m) => m.renderCountrySelects(root)).catch((err) => reportError(err, "markets"));
    }
    if (cfg.account?.clientId && (within(root, `[${attr("account-login")}],[${attr("account-bind")}],[${attr("orders")}],[${attr("show")}^="logged-"]`).length || /[?&]code=/.test(window.location.search) || hasAccountSession())) {
      loadPart("account").then((m) => m.mountAccount(root)).catch((err) => reportError(err, "account"));
    }
    if (within(root, sel("search")).length) {
      loadPart("search").then((m) => m.mountSearch(root)).catch((err) => reportError(err, "search"));
    }
    qsa(root, sel("account-link")).forEach((a) => {
      a.setAttribute("href", `https://${cfg.domain}/account`);
    });
    settleMarket();
    Cart.render();
    log(`mounted ${count} scope(s)`, root);
    return count;
  }
  function unmount() {
    Cart.close();
  }
  function getScope(el) {
    const root = el?.closest?.(sel("product"));
    return root ? scopes.get(root) || null : null;
  }
  var controlsBound = false;
  function bindControls() {
    if (controlsBound) return;
    controlsBound = true;
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!t?.closest) return;
      if (t.closest(sel("cart-open"))) {
        e.preventDefault();
        Cart.toggle();
        return;
      }
      if (t.closest(sel("cart-close"))) {
        e.preventDefault();
        Cart.close();
        return;
      }
      const clear = t.closest(sel("cart-clear"));
      if (clear) {
        e.preventDefault();
        busy(clear, () => Cart.clear().catch((err) => reportError(err, "cart clear")));
        return;
      }
      const checkout = t.closest(sel("checkout"));
      if (checkout) {
        e.preventDefault();
        busy(checkout, () => Cart.checkout());
        return;
      }
      const line = t.closest(dataKeySel());
      if (line && line.closest(sel("cart-lines"))) {
        const id = line.getAttribute(`data-${cfg.prefix}-key`);
        const current = Cart.lines.find((l) => l.id === id);
        const run = (fn) => {
          e.preventDefault();
          fn().catch((err) => reportError(err, "cart line"));
        };
        if (t.closest(sel("line-remove"))) {
          line.classList.add("is-busy");
          return run(() => Cart.removeLine(id));
        }
        if (current && t.closest(sel("line-plus"))) return run(() => Cart.changeQuantity(id, 1));
        if (current && t.closest(sel("line-minus"))) return run(() => Cart.changeQuantity(id, -1));
      }
      const removeCode = t.closest(sel("discount-remove"));
      if (removeCode) {
        e.preventDefault();
        const code = removeCode.closest(sel("discount-code"))?.getAttribute(attr("discount-code"));
        if (code) Cart.removeDiscount(code).catch((err) => reportError(err, "discount"));
        return;
      }
      const groupBtn = t.closest(sel("group-add"));
      if (groupBtn) {
        e.preventDefault();
        busy(groupBtn, () => addGroup(groupBtn));
      }
    });
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (!t?.closest) return;
      const lineEl = t.closest(dataKeySel());
      const id = lineEl?.getAttribute(`data-${cfg.prefix}-key`);
      const busyLine = (p, what) => {
        lineEl.classList.add("is-busy");
        lineEl.setAttribute("aria-busy", "true");
        p.catch((err) => reportError(err, what));
      };
      if (id && t.matches(`input${sel("line", "quantity")}`)) {
        busyLine(Cart.updateLine(id, parseInt(t.value, 10) || 0), "cart line");
      } else if (id && t.matches(`select${sel("line-plan")}`)) {
        busyLine(Cart.updateLine(id, { sellingPlanId: t.value || null }), "cart line plan");
      } else if (t.matches(`select${sel("country-select")}`)) {
        if (t.value) setCountry(t.value).catch((err) => reportError(err, "country"));
      } else if (t.matches(sel("cart-note"))) {
        Cart.setNote(t.value).catch((err) => reportError(err, "cart note"));
      }
    });
    document.addEventListener("submit", (e) => {
      const form = e.target.closest?.(sel("discount-form"));
      if (!form) return;
      e.preventDefault();
      const input = form.querySelector(sel("discount-input")) || form.querySelector("input");
      const code = input?.value.trim();
      if (!code) return;
      busy(form, async () => {
        const mark = (bad) => {
          form.classList.toggle("is-invalid", bad);
          if (input) {
            if (bad) input.setAttribute("aria-invalid", "true");
            else input.removeAttribute("aria-invalid");
          }
        };
        try {
          await Cart.applyDiscount(code);
          mark(false);
          emit("discount-applied", { code }, form);
          if (input) input.value = "";
        } catch (err) {
          mark(true);
          if (err?.code === "INVALID_DISCOUNT") emit("discount-invalid", { code }, form);
          else reportError(err, "discount");
        }
      });
    }, true);
    document.addEventListener("input", (e) => {
      const f = e.target.closest?.(sel("discount-form"));
      if (f) {
        f.classList.remove("is-invalid");
        e.target.removeAttribute?.("aria-invalid");
      }
    });
    window.addEventListener("storage", (e) => {
      if (cfg.domain && e.key?.startsWith(`${cfg.prefix}:`)) loadPart("extras").then((m) => m.onStorage(e)).catch(() => {
      });
    });
    document.addEventListener(`${cfg.prefix}:variant-changed`, (e) => {
      const root = e.target;
      if (cfg.variantUrl || root.hasAttribute?.(attr("variant-url"))) loadPart("extras").then((m) => m.writeVariantUrl(root, e.detail)).catch(() => {
      });
    });
    if (cfg.astro !== false) {
      document.addEventListener("astro:page-load", () => {
        let target = pageMarket();
        if (!target && onPageMarket) {
          try {
            target = JSON.parse(localStorage.getItem(`${cfg.prefix}:market:${cfg.domain}`) || "null");
          } catch {
            target = null;
          }
          target = target?.country ? target : baseMarket;
        }
        onPageMarket = Boolean(pageMarket());
        const differs = target?.country && (String(target.country).toUpperCase() !== String(cfg.country || "").toUpperCase() || String(target.language || "").toUpperCase() !== String(cfg.language || "").toUpperCase());
        if (differs) setCountry(target.country, { language: target.language ?? null, locale: target.locale, remember: false }).then(() => mount(document), () => mount(document));
        else mount(document);
      });
      document.addEventListener("astro:before-swap", () => unmount());
    }
    window.addEventListener("online", () => {
      retryFailed();
      liveLists.forEach((l) => {
        if (l.root.getAttribute(attr("state")) === "error") l.load();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (!Cart.isOpen()) return;
      if (e.key === "Escape") {
        Cart.close();
        return;
      }
      if (e.key !== "Tab" || cfg.cartFocus === false) return;
      const d = Cart.drawers().find((x) => x.classList.contains(cfg.cartDrawerOpenClass));
      const f = d ? focusables(d) : [];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (!d.contains(document.activeElement) || e.shiftKey && document.activeElement === first || !e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    });
  }
  function dataKeySel() {
    return `[data-${cfg.prefix}-key]`;
  }
  var addGroup = (btn) => loadPart("extras").then((m) => m.addGroup(btn));
  var analyticsQueue = null;
  function init(overrides = {}) {
    if (initPromise && !Object.keys(overrides).length) return initPromise;
    configure({ ...window.TETHER_CONFIG || {}, ...overrides });
    if (!isConfigured()) {
      warn("TETHER_CONFIG is missing domain or token. Tether is idle.");
      initPromise = Promise.resolve(null);
      return initPromise;
    }
    bindControls();
    if (cfg.observe) startObserver();
    if (cfg.analytics && !analyticsQueue) {
      analyticsQueue = [];
      ["product-ready", "list-ready", "cart-updated", "cart-toggled", "checkout", "search"].forEach((n) => document.addEventListener(`${cfg.prefix}:${n}`, (e) => analyticsQueue.push(e)));
      document.addEventListener("astro:page-load", () => analyticsQueue.push(new CustomEvent(`${cfg.prefix}:page`)));
      loadPart("analytics").then((m) => m.startAnalytics(analyticsQueue)).catch((err) => reportError(err, "analytics"));
    }
    initPromise = applyMarket(overrides).then(() => Cart.init()).then(async (cart) => {
      const want = cfg.country ? String(cfg.country).toUpperCase() : null;
      if (cart && want && cart.buyerIdentity?.countryCode && cart.buyerIdentity.countryCode !== want) {
        try {
          cart = await Cart.setBuyerIdentity({ countryCode: want }, { create: false });
        } catch (err) {
          reportError(err, "cart country");
        }
      }
      emit("ready", { cart });
      return api;
    });
    return initPromise;
  }
  function pageMarket(doc = document) {
    const get2 = (n) => doc.querySelector(`meta[name="${cfg.prefix}-page-${n}"]`)?.getAttribute("content") || void 0;
    const country = get2("country");
    return country ? { country: country.toUpperCase(), language: get2("language"), locale: get2("locale") } : null;
  }
  var baseMarket = null;
  var onPageMarket = false;
  async function applyMarket(overrides) {
    const m = cfg.markets || {};
    baseMarket = { country: cfg.country, language: cfg.language, locale: cfg.locale };
    const page = pageMarket();
    onPageMarket = Boolean(page);
    if (page) {
      cfg.country = page.country;
      cfg.language = page.language ? page.language.toUpperCase() : void 0;
      if (page.locale) cfg.locale = page.locale;
      return;
    }
    if (m.detect === false) return;
    let market = null;
    if (m.detect) {
      try {
        market = (await loadPart("markets")).detectMarket(m);
      } catch (err) {
        reportError(err, "markets");
        return;
      }
    } else if (m.remember !== false) {
      try {
        market = JSON.parse(localStorage.getItem(`${cfg.prefix}:market:${cfg.domain}`) || "null");
      } catch {
      }
      if (market && !/^[A-Z]{2}$/.test(market.country || "")) market = null;
    }
    if (!market) return;
    if (market.country) cfg.country = market.country;
    if (market.language) cfg.language = market.language;
    if (market.locale && !overrides.locale) cfg.locale = market.locale;
    log("market", market);
  }
  function hasAccountSession() {
    try {
      return Boolean(sessionStorage[`${cfg.prefix}:account:${cfg.domain}`] || localStorage[`${cfg.prefix}:account:${cfg.domain}`]);
    } catch {
      return false;
    }
  }
  var accountApi = new Proxy({}, { get: (_, n) => (...a) => loadPart("account").then((m) => m[n](...a)) });
  function setCountry(code, opts) {
    return loadPart("markets").then((m) => m.setCountry(code, opts));
  }
  function startObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    let t = null;
    const queued = /* @__PURE__ */ new Set();
    observer = new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) queued.add(n);
      }));
      clearTimeout(t);
      t = setTimeout(() => {
        queued.forEach((n) => {
          if (n.isConnected) mount(n);
        });
        queued.clear();
      }, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  var api = {
    VERSION,
    init,
    mount,
    unmount,
    get config() {
      return cfg;
    },
    get ready() {
      return initPromise || Promise.resolve(null);
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
    formatMoney,
    imageUrl,
    plans: selling_plans_exports,
    TetherError,
    resolveProductKey,
    setCountry,
    detectMarket: (markets) => loadPart("markets").then((m) => m.detectMarket(markets || cfg.markets)),
    getLocalization: () => loadPart("markets").then((m) => m.getLocalization()),
    diagnose: (opts) => loadPart("diagnose").then((m) => m.diagnose({ ...opts, version: VERSION })),
    __core: coreModules,
    __parts: {},
    on(name, fn) {
      const h = (e) => fn(e.detail, e);
      document.addEventListener(`${cfg.prefix}:${name}`, h);
      return () => document.removeEventListener(`${cfg.prefix}:${name}`, h);
    }
  };
  var index_default = api;
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.Tether = api;
    const auto = window.TETHER_CONFIG && window.TETHER_CONFIG.autoMount !== false && !window.TETHER_INTEGRATION;
    if (auto) {
      const start = () => init().then(() => mount(document));
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
      else start();
    }
  }
})();
