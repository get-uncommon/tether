(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/diagnose.ts
  var diagnose_exports = {};
  __export(diagnose_exports, {
    apiVersionStatus: () => apiVersionStatus,
    checkMarkup: () => checkMarkup,
    diagnose: () => diagnose,
    didYouMean: () => didYouMean
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:client.ts
  var m2 = window.Tether.__core["client.ts"];
  var [endpoint, gql, orNull, shaped, TetherError] = m2;

  // tether-core:dom.ts
  var m3 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, emit, formatDate, formatMoney, get, has, hasTemplate, isOwnEvent, parseJSONAttr, productUrl, qsa, repeat, sel, setImage, setText, show] = m3;

  // tether-core:loader.ts
  var m4 = window.Tether.__core["loader.ts"];
  var [clearProductCache, getProduct] = m4;

  // tether-core:selling-plans.ts
  var m5 = window.Tether.__core["selling-plans.ts"];
  var [allPlans] = m5;

  // tether-core:status.ts
  var m6 = window.Tether.__core["status.ts"];
  var [boundary, resolveProductKey] = m6;

  // src/api-version.ts
  var QUARTERLY_VERSION = /^(\d{4})-(01|04|07|10)$/;
  var MONTHS_PER_QUARTER = 3;
  var QUARTERS_PER_YEAR = 4;
  var MONTHS_SUPPORTED = 12;
  var UPGRADE_WARNING_MONTHS = 3;
  var AVERAGE_MONTH_MS = 30.44 * 24 * 3600 * 1e3;
  function parseVersion(version) {
    const match = QUARTERLY_VERSION.exec(typeof version === "string" ? version : "");
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  }
  var formatVersion = (year, month) => `${year}-${String(month).padStart(2, "0")}`;
  function nextApiVersion(version, steps = 1) {
    const parsed = parseVersion(version);
    if (!parsed) throw new Error(`not a quarterly Shopify API version: ${version}`);
    const quarter = parsed.year * QUARTERS_PER_YEAR + (parsed.month - 1) / MONTHS_PER_QUARTER + steps;
    return formatVersion(Math.floor(quarter / QUARTERS_PER_YEAR), quarter % QUARTERS_PER_YEAR * MONTHS_PER_QUARTER + 1);
  }
  function apiVersionStatus(version, now = /* @__PURE__ */ new Date()) {
    if (version === "unstable") {
      return { version, ok: false, note: '"unstable" changes without notice: pin a dated version such as 2026-07' };
    }
    const parsed = parseVersion(version);
    if (!parsed) return { version, ok: false, note: "not a quarterly version (YYYY-01, -04, -07 or -10)" };
    const released = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
    const supportedUntil = new Date(Date.UTC(parsed.year, parsed.month - 1 + MONTHS_SUPPORTED, 1));
    const monthsLeft = (supportedUntil.getTime() - now.getTime()) / AVERAGE_MONTH_MS;
    const isReleased = released <= now;
    let note = `supported until about ${supportedUntil.toISOString().slice(0, 7)}`;
    if (!isReleased) note = "not released yet (release candidate at best)";
    else if (monthsLeft <= 0) {
      note = "no longer supported: Shopify falls back to the oldest supported version. Upgrade (see README)";
    } else if (monthsLeft < UPGRADE_WARNING_MONTHS) {
      note = `${note}: plan the upgrade to ${nextApiVersion(version)} or later (see README)`;
    }
    return {
      version,
      ok: isReleased && monthsLeft > 0,
      monthsLeft: Math.round(monthsLeft),
      next: nextApiVersion(version),
      note
    };
  }

  // tether-core:lazy.ts
  var m7 = window.Tether.__core["lazy.ts"];
  var [loadPart] = m7;

  // src/diagnose-markup.ts
  var SHOW = /* @__PURE__ */ new Set([
    "in-stock",
    "out-of-stock",
    "backorder",
    "low-stock",
    "plenty-in-stock",
    "on-sale",
    "not-on-sale",
    "has-variants",
    "single-variant",
    "subscription-available",
    "subscription-unavailable",
    "subscription-only",
    "one-time-available",
    "subscription-selected",
    "one-time-selected",
    "has-savings",
    "loading",
    "ready",
    "error",
    "not-found",
    "cart-empty",
    "cart-filled",
    "cart-has-subscription",
    "cart-no-subscription",
    "cart-has-discount",
    "cart-error",
    "cart-warning",
    "list-empty",
    "list-filled",
    "search-empty",
    "search-results",
    "logged-in",
    "logged-out",
    "orders-empty",
    "orders-loading",
    "addresses-loading",
    "addresses-empty",
    "addresses-error",
    "subscriptions-loading",
    "subscriptions-empty",
    "subscriptions-error"
  ]);
  var BIND = /* @__PURE__ */ new Set([
    "title",
    "description",
    "description-text",
    "vendor",
    "type",
    "handle",
    "published-at",
    "price",
    "total-price",
    "compare-at-price",
    "unit-price",
    "min-price",
    "max-price",
    "discount-percentage",
    "discount-amount",
    "variant-title",
    "variant-id",
    "sku",
    "barcode",
    "stock",
    "quantity",
    "featured-image",
    "variant-image",
    "images",
    "tags",
    "link",
    "url",
    "one-time-price",
    "subscription-price",
    "subscription-savings",
    "subscription-savings-amount",
    "checkout-charge",
    "plan-name",
    "plan-description",
    "plan-group",
    "option-value",
    "swatch",
    "image"
  ]);
  var ATTRIBUTES = new Set(
    `account account-bind account-link account-login account-logout add-label add-to-cart adding-text
  always-enabled bind cart-checkout-charge cart-clear cart-close cart-count cart-discounts cart-drawer cart-label cart-lines
  cart-note cart-open cart-subtotal cart-total cart-warning checkout code collection collection-bind countries country
  country-bind country-label country-select default-plan default-purchase discount discount-code discount-form discount-input
  discount-remove display error group group-add hide-single language limit line line-attribute line-attributes line-id
  line-minus line-plan line-plus line-remove line-show list load-more market-pending one-time-label option option-list
  option-selected option-value order order-bind order-line order-lines order-line-show order-show order-state order-fulfillments
  fulfillment-bind order-return return-quantity return-reason return-note orders profile-form address-form addresses address-bind
  address-show address-edit address-new address-delete address-default subscriptions subscription-bind subscription-lines
  subscription-line subscription-show subscription-action subscription-status subscription-state confirm form-state form-error page-country page-language page-locale page-title plan plan-bind plan-list
  plan-value product products purchase purchase-mode qty qty-minus qty-plus quantity recommendations reverse search
  search-bind search-collections search-input search-limit search-min search-products search-queries search-results
  search-state show soldout-text sort state subscribe-text variant variant-select variant-url max-width max-height crop
  sig label hydrated busy`.split(/\s+/).filter(Boolean)
  );
  var PRODUCT_ONLY = [
    "bind",
    "option-list",
    "option",
    "variant-select",
    "add-to-cart",
    "purchase",
    "plan-list",
    "plan",
    "qty",
    "line-attribute"
  ];
  var REPEATERS = ["option-list", "plan-list", "cart-lines", "list"];
  var METAFIELD_BIND = "metafield:";
  var IMAGE_BIND = /^image:\d+$/;
  var DESCRIBED_CLASSES = 2;
  function editDistance(from, to) {
    let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
    for (let i = 1; i <= from.length; i++) {
      const row = [i];
      for (let j = 1; j <= to.length; j++) {
        const substitution = (previous[j - 1] ?? 0) + (from[i - 1] === to[j - 1] ? 0 : 1);
        row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, substitution));
      }
      previous = row;
    }
    return previous[to.length] ?? 0;
  }
  function didYouMean(value, options, prefix = "") {
    let best = null;
    let bestDistance = Infinity;
    for (const option of options) {
      const distance = editDistance(value, option);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = option;
      }
    }
    const closeEnough = Math.max(2, Math.floor(value.length / 4));
    return best !== null && bestDistance <= closeEnough ? ` Did you mean "${prefix}${best}"?` : "";
  }
  function describe(el) {
    const id = el.id ? `#${el.id}` : "";
    const classes = el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/) : [];
    const classText = classes.length ? `.${classes.slice(0, DESCRIBED_CLASSES).join(".")}` : "";
    return `<${el.tagName.toLowerCase()}${id}${classText}>`;
  }
  var listSelector = () => `${sel("collection")},${sel("products")},${sel("recommendations")}`;
  function checkProductKeys(root, add) {
    qsa(root, sel("product")).forEach((el) => {
      if (el.closest(listSelector()) && el.closest(sel("list"))) return;
      const { key, fromUrl, raw } = resolveProductKey(el);
      if (!raw) {
        add(
          "error",
          `${attr("product")} has no value. Bind it to the Shopify handle (CMS field), or use "url:handle".`,
          el
        );
      } else if (fromUrl && !key) {
        add("warn", `${attr("product")}="${raw}" but this URL has no value for it (e.g. ?handle=my-product).`, el);
      }
    });
  }
  function checkPlacement(root, add) {
    for (const name of PRODUCT_ONLY) {
      qsa(root, sel(name)).forEach((el) => {
        if (el.closest(sel("product"))) return;
        if (name === "line-attribute" && el.closest(sel("group"))) return;
        add("warn", `${attr(name)} outside any ${attr("product")}: it does nothing here.`, el);
      });
    }
    qsa(root, sel("group-add")).forEach((el) => {
      if (!el.closest(sel("group"))) add("warn", `${attr("group-add")} outside a ${attr("group")}.`, el);
    });
    for (const name of REPEATERS) {
      qsa(root, sel(name)).forEach((el) => {
        if (!el.firstElementChild && !hasTemplate(el)) {
          add("warn", `${attr(name)} without a template child: put one example element inside it.`, el);
        }
      });
    }
    qsa(root, listSelector()).forEach((el) => {
      if (!qsa(el, sel("list")).length) {
        add("error", `List without a ${attr("list")} child: products have nowhere to render.`, el);
      }
    });
  }
  function checkValues(root, add) {
    qsa(root, sel("show")).forEach((el) => {
      const value = get(el, "show") ?? "";
      if (!SHOW.has(value)) add("warn", `Unknown ${attr("show")}="${value}".${didYouMean(value, SHOW)}`, el);
    });
    qsa(root, sel("bind")).forEach((el) => {
      const value = get(el, "bind") || "";
      if (!value || BIND.has(value) || IMAGE_BIND.test(value) || value.startsWith(METAFIELD_BIND)) return;
      add("warn", `Unknown ${attr("bind")}="${value}": it stays empty.${didYouMean(value, BIND)}`, el);
    });
  }
  function checkMetafieldBinds(root, add) {
    qsa(root, sel("bind")).forEach((el) => {
      const value = get(el, "bind") || "";
      if (!value.startsWith(METAFIELD_BIND)) return;
      const ref = value.slice(METAFIELD_BIND.length);
      const listed = cfg.metafields.some(
        (metafield) => (typeof metafield === "string" ? metafield : `${metafield.namespace}.${metafield.key}`) === ref
      );
      if (!listed) {
        add("error", `${attr("bind")}="${value}" but "${ref}" is not in config.metafields, so it stays empty.`, el);
      }
    });
  }
  function checkAttributeNames(root, add) {
    const prefix = `${cfg.prefix}-`;
    const reported = /* @__PURE__ */ new Set();
    qsa(root, "*").forEach((el) => {
      for (const { name: fullName } of el.attributes) {
        if (!fullName.startsWith(prefix)) continue;
        const name = fullName.slice(prefix.length);
        if (ATTRIBUTES.has(name) || reported.has(name)) continue;
        reported.add(name);
        add("warn", `Unknown attribute ${fullName}: Tether ignores it.${didYouMean(name, ATTRIBUTES, prefix)}`, el);
      }
    });
  }
  function checkCartAndScopes(root, add) {
    const drawers = qsa(root, sel("cart-drawer")).length;
    if (qsa(root, sel("cart-open")).length && !drawers) {
      add("warn", `${attr("cart-open")} exists but there is no ${attr("cart-drawer")} on this page.`);
    }
    if (drawers > 1) add("warn", `More than one ${attr("cart-drawer")}.`);
    qsa(root, `[${attr("state")}="error"]`).forEach((el) => {
      if (el.matches(boundary())) add("error", `Scope failed to load (${get(el, "error") || "error"}).`, el);
    });
  }
  function checkMarkup(root = document) {
    const problems = [];
    const add = (level, message, el) => {
      problems.push(el ? { level, message, element: describe(el), el } : { level, message });
    };
    checkProductKeys(root, add);
    checkPlacement(root, add);
    checkValues(root, add);
    checkAttributeNames(root, add);
    checkMetafieldBinds(root, add);
    checkCartAndScopes(root, add);
    return problems;
  }

  // src/diagnose.ts
  var MAX_PRODUCTS_CHECKED = 20;
  var API_UPGRADE_WARNING_MONTHS = 3;
  var TOKEN_EDGE_CHARACTERS = 4;
  function maskToken(token) {
    if (!token) return "(missing)";
    return `${token.slice(0, TOKEN_EDGE_CHARACTERS)}\u2026${token.slice(-TOKEN_EDGE_CHARACTERS)} (${token.length} chars)`;
  }
  function errorText(error, fallback) {
    if (error instanceof Error && error.message) return error.message;
    const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : void 0;
    return typeof code === "string" && code ? code : fallback;
  }
  function configSummary() {
    return {
      domain: cfg.domain || "(missing)",
      token: maskToken(cfg.token),
      apiVersion: cfg.apiVersion,
      endpoint: cfg.domain ? endpoint() : null,
      country: cfg.country,
      language: cfg.language,
      locale: cfg.locale,
      markets: cfg.markets,
      prefix: cfg.prefix,
      productPath: cfg.productPath,
      metafields: cfg.metafields,
      autoMount: cfg.autoMount,
      observe: cfg.observe,
      onError: typeof cfg.onError === "function"
    };
  }
  async function marketSummary() {
    return {
      country: cfg.country || null,
      language: cfg.language || null,
      locale: cfg.locale || null,
      detected: cfg.markets?.detect ? (await loadPart("markets")).detectMarket(cfg.markets) : null
    };
  }
  function apiVersionProblem({ ok, monthsLeft, note }) {
    if (ok && (monthsLeft === void 0 || monthsLeft >= API_UPGRADE_WARNING_MONTHS)) return null;
    return { level: ok ? "warn" : "error", message: `apiVersion ${cfg.apiVersion}: ${note}` };
  }
  var isShopAnswer = shaped({ shop: { name: "string", primaryDomain: { url: "string" }, paymentSettings: { currencyCode: "string" } } });
  async function checkStorefront() {
    if (!isConfigured()) return { kind: "not-configured" };
    const startedAt = Date.now();
    try {
      const data = await gql(
        "query TetherDiagnose { shop { name primaryDomain { url } paymentSettings { currencyCode } } }",
        {},
        isShopAnswer,
        { context: false }
      );
      const shop = {
        name: data.shop.name,
        url: data.shop.primaryDomain.url,
        currency: data.shop.paymentSettings.currencyCode
      };
      return { kind: "reachable", shop, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { kind: "unreachable", error, latencyMs: Date.now() - startedAt };
    }
  }
  function checkOptions(root, key, product) {
    const problems = [];
    const names = product.options.map((option) => option.name);
    const roots = qsa(root, sel("product")).filter(
      (el) => resolveProductKey(el).key === key && el.querySelector(sel("add-to-cart"))
    );
    for (const el of roots) {
      const shown = new Set(
        qsa(el, `${sel("option-list")},select${sel("option")}`).map(
          (list) => get(list, "option-list") || get(list, "option")
        )
      );
      if (!shown.size && qsa(el, `select${sel("variant-select")}`).length) continue;
      if (!cfg.language) {
        for (const name of shown) {
          if (!name || names.includes(name)) continue;
          problems.push({
            level: "warn",
            message: `Product "${product.handle}" has no option "${name}" (its options: ${names.join(", ") || "none"}).${didYouMean(name, names)}`
          });
        }
      }
      for (const option of product.options) {
        if (option.optionValues.length <= 1 || shown.has(option.name)) continue;
        problems.push({
          level: "warn",
          message: `Product "${product.handle}": option "${option.name}" (${option.optionValues.length} values) has no tether-option-list, so visitors can't choose it.`
        });
      }
    }
    return problems;
  }
  async function checkProducts(root, report) {
    const allKeys = qsa(root, sel("product")).map((el) => resolveProductKey(el).key);
    const keys = [...new Set(allKeys.filter((key) => key !== null && key !== ""))].slice(0, MAX_PRODUCTS_CHECKED);
    const results = await Promise.allSettled(keys.map((key) => getProduct(key)));
    results.forEach((result, index) => {
      const key = keys[index] ?? "";
      if (result.status === "rejected") {
        const reason = errorText(result.reason, "not loaded");
        report.products.push({ key, error: result.reason instanceof Error ? result.reason.message : void 0 });
        report.problems.push({
          level: "error",
          message: `Product "${key}": ${reason}. Is it published to the Headless channel?`
        });
        return;
      }
      const product = result.value;
      const plans = allPlans(product);
      report.products.push({
        key,
        handle: product.handle,
        title: product.title,
        plans: plans.length,
        requiresSellingPlan: product.requiresSellingPlan
      });
      for (const plan of plans) {
        report.sellingPlans.push({ product: product.handle, group: plan.group.name, plan: plan.name, id: plan.id });
      }
      report.problems.push(...checkOptions(root, key, product));
    });
  }
  async function diagnose({
    root = document,
    silent = false,
    version = "",
    now = /* @__PURE__ */ new Date()
  } = {}) {
    const storefront = await checkStorefront();
    const report = {
      version,
      config: configSummary(),
      apiVersion: apiVersionStatus(cfg.apiVersion, now),
      market: await marketSummary(),
      reachable: storefront.kind === "reachable",
      shop: storefront.kind === "reachable" ? storefront.shop : null,
      latencyMs: storefront.kind === "not-configured" ? null : storefront.latencyMs,
      products: [],
      sellingPlans: [],
      problems: []
    };
    switch (storefront.kind) {
      case "not-configured":
        report.problems.push({ level: "error", message: "TETHER_CONFIG needs domain and token." });
        break;
      case "unreachable":
        report.problems.push({
          level: "error",
          message: `Storefront API not reachable: ${errorText(storefront.error, "unknown error")}`
        });
        break;
      case "reachable":
        await checkProducts(root, report);
        break;
    }
    const versionProblem = apiVersionProblem(report.apiVersion);
    if (versionProblem) report.problems.push(versionProblem);
    if (typeof document !== "undefined") report.problems.push(...checkMarkup(root));
    if (!silent) print(report);
    return report;
  }
  function print(report) {
    const errors = report.problems.filter((problem) => problem.level === "error").length;
    const warnings = report.problems.length - errors;
    console.group(`[${cfg.prefix}] diagnose: ${errors ? `${errors} error(s)` : "no errors"}, ${warnings} warning(s)`);
    console.log("version", report.version, "| API", report.apiVersion.version, `(${report.apiVersion.note})`);
    console.log("config", report.config);
    const { country, language, detected } = report.market;
    const inUse = [country, language].filter(Boolean).join(" / ") || "the store default";
    console.log("market", `in use: ${inUse}`, detected ? `(detection picks ${JSON.stringify(detected)})` : "");
    console.log(
      report.shop ? `Storefront API reachable: ${report.shop.name} (${report.latencyMs ?? 0} ms)` : "Storefront API NOT reachable"
    );
    if (report.products.length) console.table(report.products);
    if (report.sellingPlans.length) console.table(report.sellingPlans);
    else if (report.reachable) console.log("No selling plans on the products of this page.");
    for (const problem of report.problems) {
      if (problem.level === "error") console.error(problem.message, problem.el ?? "");
      else console.warn(problem.message, problem.el ?? "");
    }
    console.groupEnd();
  }

  // src/parts/diagnose.ts
  var { Tether } = window;
  if (!Tether) throw new Error("tether.diagnose.js runs after the Tether script, which loads it");
  Tether.__parts.diagnose = diagnose_exports;
})();
