(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/search.ts
  var search_exports = {};
  __export(search_exports, {
    mountSearch: () => mountSearch
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:client.ts
  var m2 = window.Tether.__core["client.ts"];
  var [endpoint, gql, matches, orNull, shaped, TetherError, withTimeout] = m2;

  // tether-core:dom.ts
  var m3 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, busy, emit, formatDate, formatMoney, get, has, hasTemplate, integerAttribute, isOwnEvent, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, scoped, sel, setImage, setStoreHtml, setText, show] = m3;

  // tether-core:mounting.ts
  var m4 = window.Tether.__core["mounting.ts"];
  var [liveLists, liveProducts, mountedProducts, mountProduct, pruneLive, within] = m4;

  // src/search.ts
  var isSearchAnswer = shaped({
    predictiveSearch: orNull({
      products: [{ priceRange: "object" }],
      collections: ["object"],
      queries: [{ text: "string" }]
    })
  });
  var QUERY = `query TetherPredictive($q:String!,$limit:Int!){predictiveSearch(query:$q,limit:$limit,limitScope:EACH,types:[PRODUCT,COLLECTION,QUERY]){products{id handle title availableForSale featuredImage{url altText}priceRange{minVariantPrice{amount currencyCode}}}collections{handle title image{url altText}}queries{text}}}`;
  var DEFAULT_LIMIT = 6;
  var MAX_LIMIT = 10;
  var DEFAULT_MIN_CHARACTERS = 2;
  var DEFAULT_ACTION = "/search";
  var mounted = /* @__PURE__ */ new WeakSet();
  var searchBoxCount = 0;
  var liveBoxes = /* @__PURE__ */ new Set();
  var linkIn = (node) => node.tagName === "A" ? node : node.querySelector("a");
  function bindValues(node, values) {
    qsa(node, sel("search-bind")).forEach((el) => {
      const field = get(el, "search-bind");
      if (field === "image") setImage(el, values.image?.url, values.image?.altText || values.title);
      else if (field === "title" || field === "price" || field === "text") {
        if (values[field] != null) setText(el, values[field]);
      }
    });
  }
  function linkOption(node, href) {
    const link = linkIn(node);
    if (!link) return;
    if (href) link.setAttribute("href", href);
    link.setAttribute("role", "option");
  }
  var SearchBox = class {
    constructor(root, input, results) {
      __publicField(this, "root");
      __publicField(this, "input");
      __publicField(this, "results");
      __publicField(this, "limit");
      __publicField(this, "minCharacters");
      __publicField(this, "resultsId");
      /** Counts searches, so only the latest one renders. */
      __publicField(this, "searchNumber", 0);
      __publicField(this, "timer");
      __publicField(this, "lastTerm", "");
      /** Results per term, for typing back and forth. */
      __publicField(this, "cache", /* @__PURE__ */ new Map());
      /**
       * Removes the box's listeners once its root has left the page. The window's own controller: a page's
       * `addEventListener` takes only its own signals, and in jsdom those aren't Node's.
       */
      __publicField(this, "listening", new window.AbortController());
      this.root = root;
      this.input = input;
      this.results = results;
      this.limit = integerAttribute(root, "search-limit", { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
      this.minCharacters = integerAttribute(root, "search-min", { min: 1, fallback: DEFAULT_MIN_CHARACTERS });
      if (!results.id) {
        searchBoxCount += 1;
        results.id = `${cfg.prefix}-search-${searchBoxCount}`;
      }
      this.resultsId = results.id;
      this.setUpAria();
      this.listen();
      liveBoxes.add(this);
    }
    /** Stops the box whose root a page swap removed; the root mounts afresh if it comes back. */
    stop() {
      this.listening.abort();
      clearTimeout(this.timer);
      liveBoxes.delete(this);
      mounted.delete(this.root);
    }
    setUpAria() {
      this.input.setAttribute("role", "combobox");
      this.input.setAttribute("aria-autocomplete", "list");
      this.input.setAttribute("aria-controls", this.resultsId);
      this.input.setAttribute("aria-expanded", "false");
      this.input.setAttribute("autocomplete", "off");
      if (!this.results.hasAttribute("role")) this.results.setAttribute("role", "listbox");
      this.results.hidden = true;
    }
    listen() {
      const { signal } = this.listening;
      this.input.addEventListener(
        "input",
        () => {
          const term = this.input.value.trim();
          if (term === this.lastTerm) return;
          this.lastTerm = term;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => void this.search(term), cfg.searchDelay);
        },
        { signal }
      );
      this.input.addEventListener(
        "focus",
        () => {
          if (this.input.value.trim().length >= this.minCharacters && this.options().length) this.open(true);
        },
        { signal }
      );
      this.input.addEventListener(
        "keydown",
        (event) => {
          this.onKeydown(event);
        },
        { signal }
      );
      document.addEventListener(
        "click",
        (event) => {
          if (!this.root.isConnected) {
            this.stop();
            return;
          }
          if (!this.root.contains(event.target)) this.open(false);
        },
        { signal }
      );
    }
    setState(state) {
      this.root.setAttribute(attr("search-state"), state);
    }
    open(open) {
      this.root.classList.toggle("is-open", open);
      this.results.hidden = !open;
      this.input.setAttribute("aria-expanded", String(open));
      if (!open) this.input.removeAttribute("aria-activedescendant");
    }
    options() {
      return qsa(this.results, '[role="option"]');
    }
    async fetchResults(term) {
      const cached = this.cache.get(term);
      if (cached) return cached;
      const data = await gql(QUERY, { q: term, limit: this.limit }, isSearchAnswer);
      this.cache.set(term, data.predictiveSearch);
      return data.predictiveSearch;
    }
    async search(term) {
      this.searchNumber += 1;
      const searchNumber = this.searchNumber;
      if (term.length < this.minCharacters) {
        this.open(false);
        this.setState("idle");
        return;
      }
      this.setState("loading");
      try {
        const results = await this.fetchResults(term);
        if (searchNumber === this.searchNumber) this.render(results, term);
      } catch (error) {
        if (searchNumber !== this.searchNumber) {
          log("a superseded search failed", error);
          return;
        }
        this.setState("error");
        reportError(error, "search");
      }
    }
    /** @param name The list attribute, e.g. `search-products`. */
    fillList(name, items, render) {
      qsa(this.results, sel(name)).forEach((list) => {
        repeat(list, items, render);
        show(list, items.length > 0);
      });
    }
    queryUrl(text) {
      const action = this.root.getAttribute("action") || DEFAULT_ACTION;
      const separator = action.includes("?") ? "&" : "?";
      return `${action}${separator}${this.input.name || "q"}=${encodeURIComponent(text)}`;
    }
    render(results, term) {
      const products = results?.products ?? [];
      const collections = results?.collections ?? [];
      const queries = (results?.queries ?? []).filter((query) => query.text.toLowerCase() !== term.toLowerCase());
      this.fillList("search-products", products, (node, product) => {
        const price = formatMoney(product.priceRange.minVariantPrice);
        bindValues(node, { title: product.title, price, image: product.featuredImage });
        linkOption(node, productUrl(product.handle, product.id));
        node.classList.toggle("is-sold-out", !product.availableForSale);
      });
      this.fillList("search-collections", collections, (node, collection) => {
        bindValues(node, { title: collection.title, image: collection.image });
        linkOption(node, `${(cfg.collectionPath || "/collection").replace(/\/$/, "")}/${collection.handle}`);
      });
      this.fillList("search-queries", queries, (node, query) => {
        bindValues(node, { text: query.text });
        linkIn(node)?.setAttribute("href", this.queryUrl(query.text));
      });
      const count = products.length + collections.length + queries.length;
      this.showCount(count);
      this.setState(count ? "ready" : "empty");
      this.open(true);
      emit("search", { term, products, collections, queries }, this.root);
    }
    showCount(count) {
      qsa(this.root, sel("show")).forEach((el) => {
        const condition = get(el, "show");
        if (condition === "search-empty") show(el, count === 0);
        if (condition === "search-results") show(el, count > 0);
      });
      this.options().forEach((option, index) => {
        option.id || (option.id = `${this.resultsId}-${index}`);
        option.setAttribute("aria-selected", "false");
      });
      this.input.removeAttribute("aria-activedescendant");
    }
    highlight(options, index) {
      options.forEach((option2, optionIndex) => {
        option2.setAttribute("aria-selected", String(optionIndex === index));
      });
      const option = options[index];
      if (!option) return;
      this.input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView?.({ block: "nearest" });
    }
    onKeydown(event) {
      const options = this.options();
      const current = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
      if (event.key === "ArrowDown" && options.length) {
        event.preventDefault();
        this.open(true);
        this.highlight(options, (current + 1) % options.length);
      } else if (event.key === "ArrowUp" && options.length) {
        event.preventDefault();
        this.highlight(options, current <= 0 ? options.length - 1 : current - 1);
      } else if (event.key === "Enter" && current >= 0) {
        event.preventDefault();
        options[current]?.click();
      } else if (event.key === "Escape") {
        this.open(false);
      }
    }
  };
  function mountSearch(root = document) {
    liveBoxes.forEach((box) => {
      if (!box.root.isConnected) box.stop();
    });
    for (const el of within(root, sel("search"))) {
      if (mounted.has(el)) continue;
      mounted.add(el);
      const input = el.querySelector(sel("search-input")) ?? el.querySelector("input");
      const results = el.querySelector(sel("search-results"));
      if (input && results) new SearchBox(el, input, results);
    }
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

  // src/parts/search.ts
  registerPart("search", search_exports);
})();
