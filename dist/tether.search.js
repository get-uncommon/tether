"use strict";
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
  var { DEFAULTS, cfg, configure, isConfigured, log, reportError, resolveConfig, toMetafieldIdentifier, warn } = m;

  // tether-core:client.js
  var m2 = window.Tether.__core["client.js"];
  var { TetherError, endpoint, gql, request, unwrap, withContext } = m2;

  // tether-core:dom.js
  var m3 = window.Tether.__core["dom.js"];
  var { attr, busy, cdnUrl, emit, formatDate, formatMoney, formatPercent, get, has, hasTemplate, imageUrl, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, repeatKeyed, sameImage, scoped, sel, setImage, setSelected, setStoreHtml, setText, setTextTracked, show, toAttributes, watchImages } = m3;

  // tether-core:mounting.js
  var m4 = window.Tether.__core["mounting.js"];
  var { hydrateFromPage, liveLists, liveProducts, mountProduct, mountedLists, mountedProducts, pruneLive, retryFailed, settleMarket, trackMarket, within } = m4;

  // src/search.js
  var QUERY = `query TetherPredictive($q:String!,$limit:Int!){predictiveSearch(query:$q,limit:$limit,limitScope:EACH,types:[PRODUCT,COLLECTION,QUERY]){products{id handle title availableForSale featuredImage{url altText}priceRange{minVariantPrice{amount currencyCode}}}collections{handle title image{url altText}}queries{text}}}`;
  var DEFAULT_LIMIT = 6;
  var DEFAULT_MIN_CHARACTERS = 2;
  var DEFAULT_ACTION = "/search";
  var mounted = /* @__PURE__ */ new WeakSet();
  var searchBoxCount = 0;
  function integerAttribute(el, name, fallback) {
    return parseInt(get(el, name) || "", 10) || fallback;
  }
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
    link.setAttribute("href", href);
    link.setAttribute("role", "option");
  }
  var SearchBox = class {
    /**
     * @param {HTMLElement} root
     * @param {HTMLInputElement} input
     * @param {HTMLElement} results
     */
    constructor(root, input, results) {
      this.root = root;
      this.input = input;
      this.results = results;
      this.limit = integerAttribute(root, "search-limit", DEFAULT_LIMIT);
      this.minCharacters = integerAttribute(root, "search-min", DEFAULT_MIN_CHARACTERS);
      if (!results.id) {
        searchBoxCount += 1;
        results.id = `${cfg.prefix}-search-${searchBoxCount}`;
      }
      this.resultsId = results.id;
      this.searchNumber = 0;
      this.timer = void 0;
      this.lastTerm = "";
      this.cache = /* @__PURE__ */ new Map();
      this.setUpAria();
      this.listen();
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
      this.input.addEventListener("input", () => {
        const term = this.input.value.trim();
        if (term === this.lastTerm) return;
        this.lastTerm = term;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.search(term), cfg.searchDelay);
      });
      this.input.addEventListener("focus", () => {
        if (this.input.value.trim().length >= this.minCharacters && this.options().length) this.open(true);
      });
      this.input.addEventListener("keydown", (event) => {
        this.onKeydown(event);
      });
      document.addEventListener("click", (event) => {
        if (!this.root.contains(
          /** @type {Node | null} */
          event.target
        )) this.open(false);
      });
    }
    /** @param {SearchState} state */
    setState(state) {
      this.root.setAttribute(attr("search-state"), state);
    }
    /** @param {boolean} open */
    open(open) {
      this.root.classList.toggle("is-open", open);
      this.results.hidden = !open;
      this.input.setAttribute("aria-expanded", String(open));
      if (!open) this.input.removeAttribute("aria-activedescendant");
    }
    options() {
      return qsa(this.results, '[role="option"]');
    }
    /**
     * @param {string} term
     * @returns {Promise<SearchResults | null>}
     */
    async fetchResults(term) {
      const cached = this.cache.get(term);
      if (cached) return cached;
      const data = await gql(QUERY, { q: term, limit: this.limit });
      this.cache.set(term, data.predictiveSearch);
      return data.predictiveSearch;
    }
    /** @param {string} term */
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
    /**
     * @template Item
     * @param {string} name The list attribute, e.g. `search-products`.
     * @param {readonly Item[]} items
     * @param {(node: HTMLElement, item: Item) => void} render
     */
    fillList(name, items, render) {
      qsa(this.results, sel(name)).forEach((list) => {
        repeat(list, items, render);
        show(list, items.length > 0);
      });
    }
    /** @param {string} text */
    queryUrl(text) {
      const action = this.root.getAttribute("action") || DEFAULT_ACTION;
      const separator = action.includes("?") ? "&" : "?";
      return `${action}${separator}${this.input.name || "q"}=${encodeURIComponent(text)}`;
    }
    /**
     * @param {SearchResults | null} results
     * @param {string} term
     */
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
    /** @param {number} count */
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
    }
    /**
     * @param {HTMLElement[]} options
     * @param {number} index
     */
    highlight(options, index) {
      options.forEach((option2, optionIndex) => {
        option2.setAttribute("aria-selected", String(optionIndex === index));
      });
      const option = options[index];
      if (!option) return;
      this.input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView?.({ block: "nearest" });
    }
    /** @param {KeyboardEvent} event */
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
    for (const el of within(root, sel("search"))) {
      if (mounted.has(el)) continue;
      mounted.add(el);
      const input = (
        /** @type {HTMLInputElement | null} */
        el.querySelector(sel("search-input")) ?? el.querySelector("input")
      );
      const results = (
        /** @type {HTMLElement | null} */
        el.querySelector(sel("search-results"))
      );
      if (input && results) new SearchBox(el, input, results);
    }
  }

  // src/parts/search.js
  var { Tether } = (
    /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */
    window
  );
  if (!Tether) throw new Error("tether.search.js runs after the Tether script, which loads it");
  Tether.__parts["search"] = search_exports;
})();
