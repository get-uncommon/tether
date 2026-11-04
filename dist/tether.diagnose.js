(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/diagnose.js
  var diagnose_exports = {};
  __export(diagnose_exports, {
    apiVersionStatus: () => apiVersionStatus,
    checkMarkup: () => checkMarkup,
    diagnose: () => diagnose
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

  // tether-core:loader.js
  var m4 = window.Tether.__core["loader.js"];
  var { clearProductCache, getProduct, getProducts, getRecommendations, hydrateProducts, normalizeProductKey, primeProduct, refreshProducts, takeStale } = m4;

  // tether-core:selling-plans.js
  var m5 = window.Tether.__core["selling-plans.js"];
  var { GID, allPlans, allocationFor, findPlan, hasPlans, planAdjustment, planCheckoutCharge, planPrice, planSavings, plansForVariant, toGid } = m5;

  // tether-core:status.js
  var m6 = window.Tether.__core["status.js"];
  var { STATUS_KEYS, boundary, isNotFound, ownedBy, resolveProductKey, setScopeStatus } = m6;

  // src/api-version.js
  var parse = (v) => {
    const m7 = /^(\d{4})-(01|04|07|10)$/.exec(String(v || ""));
    return m7 ? { y: +m7[1], m: +m7[2] } : null;
  };
  var fmt = (y, m7) => `${y}-${String(m7).padStart(2, "0")}`;
  function nextApiVersion(v, steps = 1) {
    const p = parse(v);
    if (!p) throw new Error(`not a quarterly Shopify API version: ${v}`);
    const q = p.y * 4 + (p.m - 1) / 3 + steps;
    return fmt(Math.floor(q / 4), q % 4 * 3 + 1);
  }
  function apiVersionStatus(version, now = /* @__PURE__ */ new Date()) {
    if (version === "unstable") return { version, ok: false, note: '"unstable" changes without notice: pin a dated version such as 2026-07' };
    const p = parse(version);
    if (!p) return { version, ok: false, note: "not a quarterly version (YYYY-01, -04, -07 or -10)" };
    const released = new Date(Date.UTC(p.y, p.m - 1, 1));
    const supportedUntil = new Date(Date.UTC(p.y + 1, p.m - 1, 1));
    const monthsLeft = (supportedUntil - now) / (30.44 * 24 * 3600 * 1e3);
    let note = `supported until about ${supportedUntil.toISOString().slice(0, 7)}`;
    if (released > now) note = "not released yet (release candidate at best)";
    else if (monthsLeft <= 0) note = "no longer supported: Shopify falls back to the oldest supported version. Upgrade (see README)";
    else if (monthsLeft < 3) note = `${note}: plan the upgrade to ${nextApiVersion(version)} or later (see README)`;
    return { version, ok: released <= now && monthsLeft > 0, monthsLeft: Math.round(monthsLeft), next: nextApiVersion(version), note };
  }

  // src/markets.js
  var COUNTRY = /^[A-Z]{2}$/;
  var REGIONAL_LANGUAGES = /* @__PURE__ */ new Set(["PT_BR", "PT_PT", "ZH_CN", "ZH_TW"]);
  var storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;
  var defaultEnv = () => ({
    document: typeof document !== "undefined" ? document : null,
    location: typeof window !== "undefined" ? window.location : null,
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
    global: typeof window !== "undefined" ? window : {}
  });
  function toCountry(v) {
    const c = String(v || "").trim().toUpperCase();
    return COUNTRY.test(c) && c !== "XX" && c !== "T1" ? c : null;
  }
  function toLanguage(v) {
    const raw = String(v || "").trim().replace("-", "_").toUpperCase();
    if (!raw) return null;
    if (REGIONAL_LANGUAGES.has(raw)) return raw;
    const primary = raw.split("_")[0];
    return /^[A-Z]{2,3}$/.test(primary) ? primary : null;
  }
  function readCookie(doc, name) {
    if (!doc || !name) return null;
    const hit = String(doc.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  }
  var lookup = (locales, key) => {
    if (!locales || !key) return null;
    const k = String(key).toLowerCase();
    const found = Object.keys(locales).find((x) => x.toLowerCase() === k);
    return found ? locales[found] : null;
  };
  var readers = {
    saved(m7, env) {
      if (m7.remember === false || !env.storage) return null;
      try {
        return JSON.parse(env.storage.getItem(storageKey()) || "null");
      } catch {
        return null;
      }
    },
    server(m7, env) {
      const meta = (name) => env.document?.querySelector?.(`meta[name="${name}"]`)?.getAttribute("content");
      const country = env.global.TETHER_COUNTRY || meta("tether-country") || readCookie(env.document, m7.cookie || "tether_country");
      const language = env.global.TETHER_LANGUAGE || meta("tether-language");
      return { country, language };
    },
    webflow(m7, env) {
      const segment = (env.location?.pathname || "/").split("/").filter(Boolean)[0];
      const fromPath = lookup(m7.locales, segment);
      if (fromPath) return fromPath;
      const lang = env.document?.documentElement?.getAttribute("lang");
      if (!lang) return null;
      const mapped = lookup(m7.locales, lang) || lookup(m7.locales, lang.split("-")[0]);
      if (mapped) return { locale: lang, ...mapped };
      if (m7.locales && m7.strict) return null;
      const region = lang.split("-")[1];
      return { language: lang, country: region && region.length === 2 ? region : null, locale: lang };
    }
  };
  function detectMarket(markets = cfg.markets, env = defaultEnv()) {
    const m7 = markets || {};
    if (m7.detect === false) return {};
    const list = !m7.detect ? ["saved"] : m7.detect === true ? ["saved", "server", "webflow"] : [].concat(m7.detect);
    markets = m7;
    const out = { sources: {} };
    list.forEach((name) => {
      const r = readers[name]?.(markets, env);
      if (!r) return;
      const vals = { country: toCountry(r.country), language: toLanguage(r.language), locale: r.locale || null };
      Object.entries(vals).forEach(([k, v]) => {
        if (v && !out[k]) {
          out[k] = v;
          out.sources[k] = name;
        }
      });
    });
    return out;
  }

  // src/diagnose.js
  var mask = (t) => t ? `${String(t).slice(0, 4)}\u2026${String(t).slice(-4)} (${String(t).length} chars)` : "(missing)";
  function describe(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `<${el.tagName.toLowerCase()}${id}${cls}>`;
  }
  function checkMarkup(root = document) {
    const problems = [];
    const add = (level, message, el) => problems.push({ level, message, element: el ? describe(el) : void 0, el });
    const inProduct = (el) => Boolean(el.closest(sel("product")));
    const listSel = `${sel("collection")},${sel("products")},${sel("recommendations")}`;
    qsa(root, sel("product")).forEach((el) => {
      if (el.closest(listSel) && el.closest(sel("list"))) return;
      const { key, fromUrl, raw } = resolveProductKey(el);
      if (!raw) add("error", `${attr("product")} has no value. Bind it to the Shopify handle (CMS field), or use "url:handle".`, el);
      else if (fromUrl && !key) add("warn", `${attr("product")}="${raw}" but this URL has no value for it (e.g. ?handle=my-product).`, el);
    });
    const productOnly = ["bind", "option-list", "option", "variant-select", "add-to-cart", "purchase", "plan-list", "plan", "qty", "line-attribute"];
    productOnly.forEach((name) => {
      qsa(root, sel(name)).forEach((el) => {
        if (inProduct(el)) return;
        if (name === "line-attribute" && el.closest(sel("group"))) return;
        add("warn", `${attr(name)} outside any ${attr("product")}: it does nothing here.`, el);
      });
    });
    qsa(root, sel("group-add")).forEach((el) => {
      if (!el.closest(sel("group"))) add("warn", `${attr("group-add")} outside a ${attr("group")}.`, el);
    });
    [...qsa(root, sel("option-list")), ...qsa(root, sel("plan-list")), ...qsa(root, sel("cart-lines")), ...qsa(root, sel("list"))].forEach((el) => {
      if (!el.firstElementChild && !hasTemplate(el)) {
        add("warn", "Repeater without a template child: put one example element inside it.", el);
      }
    });
    qsa(root, listSel).forEach((el) => {
      if (!qsa(el, sel("list")).length) add("error", `List without a ${attr("list")} child: products have nowhere to render.`, el);
    });
    const known = /* @__PURE__ */ new Set([
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
      "list-filled"
    ]);
    qsa(root, sel("show")).forEach((el) => {
      const k = get(el, "show");
      if (!known.has(k)) add("warn", `Unknown ${attr("show")}="${k}".`, el);
    });
    qsa(root, sel("bind")).forEach((el) => {
      const k = get(el, "bind") || "";
      if (!k.startsWith("metafield:")) return;
      const ref = k.slice(10);
      const listed = (cfg.metafields || []).some((m7) => (typeof m7 === "string" ? m7 : `${m7.namespace}.${m7.key}`) === ref);
      if (!listed) add("error", `${attr("bind")}="${k}" but "${ref}" is not in config.metafields, so it stays empty.`, el);
    });
    if (qsa(root, sel("cart-open")).length && !qsa(root, sel("cart-drawer")).length) {
      add("warn", `${attr("cart-open")} exists but there is no ${attr("cart-drawer")} on this page.`);
    }
    if (qsa(root, sel("cart-drawer")).length > 1) add("warn", `More than one ${attr("cart-drawer")}.`);
    qsa(root, `[${attr("state")}="error"]`).forEach((el) => {
      if (el.matches(boundary())) add("error", `Scope failed to load (${get(el, "error") || "error"}).`, el);
    });
    return problems;
  }
  async function diagnose({ root = document, silent = false, version, now = /* @__PURE__ */ new Date() } = {}) {
    const report = {
      version,
      config: {
        domain: cfg.domain || "(missing)",
        token: mask(cfg.token),
        apiVersion: cfg.apiVersion,
        endpoint: cfg.domain ? endpoint() : null,
        country: cfg.country,
        language: cfg.language,
        locale: cfg.locale,
        markets: cfg.markets || null,
        prefix: cfg.prefix,
        productPath: cfg.productPath,
        metafields: cfg.metafields,
        autoMount: cfg.autoMount,
        observe: cfg.observe,
        onError: typeof cfg.onError === "function"
      },
      apiVersion: apiVersionStatus(cfg.apiVersion, now),
      // The market in use (a visitor's choice included), plus what detection would pick.
      market: { country: cfg.country || null, language: cfg.language || null, locale: cfg.locale || null, detected: cfg.markets?.detect ? detectMarket(cfg.markets) : null },
      reachable: false,
      shop: null,
      latencyMs: null,
      products: [],
      sellingPlans: [],
      problems: []
    };
    if (!isConfigured()) {
      report.problems.push({ level: "error", message: "TETHER_CONFIG needs domain and token." });
    } else {
      const t0 = Date.now();
      try {
        const data = await gql("query TetherDiagnose { shop { name primaryDomain { url } paymentSettings { currencyCode } } }", {}, { context: false });
        report.reachable = true;
        report.shop = { name: data.shop?.name, url: data.shop?.primaryDomain?.url, currency: data.shop?.paymentSettings?.currencyCode };
      } catch (err) {
        const hint = err.status === 401 || err.status === 403 ? "Token rejected: use the public Storefront token from the Headless channel, not an Admin token." : err.status === 404 ? "Store or API version not found: check domain (x.myshopify.com) and apiVersion." : "";
        report.problems.push({ level: "error", message: `Storefront API not reachable: ${err.message}${hint ? `. ${hint}` : ""}` });
      }
      report.latencyMs = Date.now() - t0;
      if (report.reachable) {
        const keys = [...new Set(qsa(root, sel("product")).map((el) => resolveProductKey(el).key).filter(Boolean))].slice(0, 20);
        const results = await Promise.allSettled(keys.map((k) => getProduct(k)));
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            const p = r.value;
            const plans = allPlans(p);
            report.products.push({ key: keys[i], handle: p.handle, title: p.title, plans: plans.length, requiresSellingPlan: p.requiresSellingPlan });
            plans.forEach((pl) => report.sellingPlans.push({ product: p.handle, group: pl.group?.name, plan: pl.name, id: pl.id }));
            qsa(root, sel("product")).filter((el) => resolveProductKey(el).key === keys[i] && el.querySelector(sel("add-to-cart"))).forEach((el) => {
              const shown = new Set(qsa(el, `${sel("option-list")},select${sel("option")}`).map((x) => get(x, "option-list") || get(x, "option")));
              if (!shown.size && qsa(el, `select${sel("variant-select")}`).length) return;
              (p.options || []).filter((o) => o.optionValues.length > 1 && !shown.has(o.name)).forEach((o) => {
                report.problems.push({ level: "warn", message: `Product "${p.handle}": option "${o.name}" (${o.optionValues.length} values) has no tether-option-list, so visitors can't choose it.` });
              });
            });
          } else {
            report.products.push({ key: keys[i], error: r.reason?.message });
            report.problems.push({ level: "error", message: `Product "${keys[i]}": ${r.reason?.message}. Is it published to the Headless channel?` });
          }
        });
      }
    }
    if (!report.apiVersion.ok || (report.apiVersion.monthsLeft ?? 99) < 3) {
      report.problems.push({ level: report.apiVersion.ok ? "warn" : "error", message: `apiVersion ${cfg.apiVersion}: ${report.apiVersion.note}` });
    }
    if (typeof document !== "undefined") report.problems.push(...checkMarkup(root));
    if (!silent) print(report);
    return report;
  }
  function print(r) {
    const c = console;
    const errors = r.problems.filter((p) => p.level === "error").length;
    c.group?.(`[${cfg.prefix}] diagnose: ${errors ? `${errors} error(s)` : "no errors"}, ${r.problems.length - errors} warning(s)`);
    c.log("version", r.version, "| API", r.apiVersion.version, `(${r.apiVersion.note})`);
    c.log("config", r.config);
    if (r.market) c.log("market detected", r.market, "(in use:", r.config.country, r.config.language, ")");
    c.log(r.reachable ? `Storefront API reachable: ${r.shop?.name} (${r.latencyMs} ms)` : "Storefront API NOT reachable");
    if (r.products.length) (c.table || c.log)(r.products);
    if (r.sellingPlans.length) (c.table || c.log)(r.sellingPlans);
    else if (r.reachable) c.log("No selling plans on the products of this page.");
    r.problems.forEach((p) => (p.level === "error" ? c.error : c.warn)(p.message, p.el || ""));
    c.groupEnd?.();
  }

  // src/parts/diagnose.js
  window.Tether.__parts.diagnose = diagnose_exports;
})();
