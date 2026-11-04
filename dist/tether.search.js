(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/search.js
  var search_exports = {};
  __export(search_exports, {
    mountSearch: () => mountSearch
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

  // src/search.js
  var QUERY = `query TetherPredictive($q:String!,$limit:Int!){predictiveSearch(query:$q,limit:$limit,limitScope:EACH,types:[PRODUCT,COLLECTION,QUERY]){products{id handle title availableForSale featuredImage{url altText}priceRange{minVariantPrice{amount currencyCode}}}collections{handle title image{url altText}}queries{text}}}`;
  var mounted = /* @__PURE__ */ new WeakSet();
  var uid = 0;
  function mountSearch(root = document) {
    const roots = [...root.matches?.(sel("search")) ? [root] : [], ...qsa(root, sel("search"))];
    roots.forEach((el) => {
      if (!mounted.has(el)) {
        mounted.add(el);
        setup(el);
      }
    });
  }
  function setup(rootEl) {
    const input = rootEl.querySelector(sel("search-input")) || rootEl.querySelector("input");
    const results = rootEl.querySelector(sel("search-results"));
    if (!input || !results) return;
    const limit = parseInt(get(rootEl, "search-limit") || "6", 10) || 6;
    const min = parseInt(get(rootEl, "search-min") || "2", 10) || 2;
    const id = results.id || (results.id = `${cfg.prefix}-search-${++uid}`);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", id);
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("autocomplete", "off");
    if (!results.hasAttribute("role")) results.setAttribute("role", "listbox");
    results.hidden = true;
    let token = 0;
    let timer = null;
    let last = "";
    const cache = /* @__PURE__ */ new Map();
    const setState = (state) => rootEl.setAttribute(attr("search-state"), state);
    const open = (yes) => {
      rootEl.classList.toggle("is-open", yes);
      results.hidden = !yes;
      input.setAttribute("aria-expanded", String(yes));
      if (!yes) input.removeAttribute("aria-activedescendant");
    };
    const items = () => qsa(results, '[role="option"]');
    async function run(term) {
      const t = ++token;
      if (term.length < min) {
        open(false);
        setState("idle");
        return;
      }
      setState("loading");
      try {
        const data = cache.get(term) || (await gql(QUERY, { q: term, limit })).predictiveSearch;
        cache.set(term, data);
        if (t !== token) return;
        render(data, term);
      } catch (err) {
        if (t !== token) return;
        setState("error");
        reportError(err, "search");
      }
    }
    function render(data, term) {
      const products = data?.products || [];
      const collections = data?.collections || [];
      const queries = (data?.queries || []).filter((q) => q.text.toLowerCase() !== term.toLowerCase());
      const fill = (name, list, each) => qsa(results, sel(name)).forEach((c) => {
        repeat(c, list, each);
        show(c, list.length > 0);
      });
      fill("search-products", products, (node, p) => {
        binds(node, { title: p.title, price: formatMoney(p.priceRange?.minVariantPrice), image: p.featuredImage });
        link(node, productUrl(p.handle, p.id));
        node.classList.toggle("is-sold-out", !p.availableForSale);
      });
      fill("search-collections", collections, (node, c) => {
        binds(node, { title: c.title, image: c.image });
        link(node, `${(cfg.collectionPath || "/collection").replace(/\/$/, "")}/${c.handle}`);
      });
      fill("search-queries", queries, (node, q) => {
        binds(node, { text: q.text });
        const a = node.tagName === "A" ? node : node.querySelector("a");
        const action = rootEl.getAttribute("action") || "/search";
        if (a) a.setAttribute("href", `${action}${action.includes("?") ? "&" : "?"}${input.name || "q"}=${encodeURIComponent(q.text)}`);
      });
      const count = products.length + collections.length + queries.length;
      qsa(rootEl, sel("show")).forEach((el) => {
        const k = get(el, "show");
        if (k === "search-empty") show(el, count === 0);
        if (k === "search-results") show(el, count > 0);
      });
      items().forEach((el, i) => {
        el.id || (el.id = `${id}-${i}`);
        el.setAttribute("aria-selected", "false");
      });
      setState(count ? "ready" : "empty");
      open(true);
      emit("search", { term, products, collections, queries }, rootEl);
    }
    function binds(node, values) {
      qsa(node, sel("search-bind")).forEach((el) => {
        const k = get(el, "search-bind");
        if (k === "image") setImage(el, values.image?.url, values.image?.altText || values.title);
        else if (values[k] != null) setText(el, values[k]);
      });
    }
    function link(node, href) {
      const a = node.tagName === "A" ? node : node.querySelector("a");
      if (a) {
        a.setAttribute("href", href);
        a.setAttribute("role", "option");
      }
    }
    input.addEventListener("input", () => {
      const term = input.value.trim();
      if (term === last) return;
      last = term;
      clearTimeout(timer);
      timer = setTimeout(() => run(term), cfg.searchDelay ?? 150);
    });
    input.addEventListener("focus", () => {
      if (input.value.trim().length >= min && items().length) open(true);
    });
    input.addEventListener("keydown", (e) => {
      const list = items();
      const cur = list.findIndex((el) => el.getAttribute("aria-selected") === "true");
      const move = (i) => {
        list.forEach((el, j) => el.setAttribute("aria-selected", String(j === i)));
        if (list[i]) {
          input.setAttribute("aria-activedescendant", list[i].id);
          list[i].scrollIntoView?.({ block: "nearest" });
        }
      };
      if (e.key === "ArrowDown" && list.length) {
        e.preventDefault();
        open(true);
        move((cur + 1) % list.length);
      } else if (e.key === "ArrowUp" && list.length) {
        e.preventDefault();
        move(cur <= 0 ? list.length - 1 : cur - 1);
      } else if (e.key === "Enter" && cur >= 0) {
        e.preventDefault();
        list[cur].click();
      } else if (e.key === "Escape") {
        open(false);
      }
    });
    document.addEventListener("click", (e) => {
      if (!rootEl.contains(e.target)) open(false);
    });
  }

  // src/parts/search.js
  window.Tether.__parts.search = search_exports;
})();
