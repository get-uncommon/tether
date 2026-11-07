(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/lists.ts
  var lists_exports = {};
  __export(lists_exports, {
    getProducts: () => getProducts,
    getRecommendations: () => getRecommendations,
    loadList: () => loadList
  });

  // tether-core:config.ts
  var m = window.Tether.__core["config.ts"];
  var [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn] = m;

  // tether-core:client.ts
  var m2 = window.Tether.__core["client.ts"];
  var [endpoint, gql, matches, orNull, shaped, TetherError, withTimeout] = m2;

  // tether-core:dom.ts
  var m3 = window.Tether.__core["dom.ts"];
  var [ANALYTICS_EVENTS, attr, attributesFromJson, busy, emit, formatDate, formatMoney, get, has, hasTemplate, integerAttribute, isElement, isField, isOwnEvent, notifyLayoutChanged, parseJSONAttr, productUrl, qsa, repeat, scoped, sel, setImage, setStoreHtml, setText, show] = m3;

  // src/shopify-fields.ts
  var IMAGE_FIELDS = "url altText width height";
  function collectionFields() {
    return ` id handle title description descriptionHtml image{${IMAGE_FIELDS}}seo{title description}`;
  }

  // tether-core:loader.ts
  var m4 = window.Tether.__core["loader.ts"];
  var [clearProductCache, getProduct, normalizeProductKey, primeProduct, withProductFragment] = m4;

  // server/src/shared/json.ts
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // src/product-shape.ts
  var MONEY = { amount: "string", currencyCode: "string" };
  var PRODUCT = {
    id: "string",
    handle: "string",
    title: "string",
    options: ["object"],
    images: { nodes: ["object"] },
    priceRange: { minVariantPrice: MONEY, maxVariantPrice: MONEY },
    variants: { nodes: [{ id: "string", price: MONEY, selectedOptions: ["object"] }] }
  };

  // src/product-answers.ts
  var PRODUCT_CONNECTION = {
    nodes: [PRODUCT],
    pageInfo: { hasNextPage: "boolean" }
  };
  var isCollectionAnswer = shaped({
    collection: orNull({ handle: "string", products: PRODUCT_CONNECTION })
  });
  var isSearchAnswer = shaped({ products: PRODUCT_CONNECTION });
  var isRecommendationsAnswer = shaped({
    productRecommendations: orNull([PRODUCT])
  });

  // tether-core:status.ts
  var m5 = window.Tether.__core["status.ts"];
  var [boundary, isNotFound, resolveProductKey, setScopeStatus] = m5;

  // tether-core:collection.ts
  var m6 = window.Tether.__core["collection.ts"];
  var [listSelector] = m6;

  // tether-core:shopify-values.ts
  var m7 = window.Tether.__core["shopify-values.ts"];
  var [isHttpsUrl, MAX_CONNECTION_SIZE] = m7;

  // src/lists.ts
  var URL_QUERY_SOURCE = "url:";
  var noProducts = () => ({
    collection: null,
    products: [],
    pageInfo: { hasNextPage: false, endCursor: null }
  });
  var COLLECTION_SORT_KEYS = /* @__PURE__ */ new Set([
    "BEST_SELLING",
    "COLLECTION_DEFAULT",
    "CREATED",
    "ID",
    "MANUAL",
    "PRICE",
    "RELEVANCE",
    "TITLE"
  ]);
  var SEARCH_SORT_KEYS = /* @__PURE__ */ new Set([
    "BEST_SELLING",
    "CREATED_AT",
    "ID",
    "PRICE",
    "PRODUCT_TYPE",
    "RELEVANCE",
    "TITLE",
    "UPDATED_AT",
    "VENDOR"
  ]);
  var COLLECTION_QUERY = `query TetherCollection($handle:String!,$first:Int!,$after:String,$sortKey:ProductCollectionSortKeys,$reverse:Boolean,$filters:[ProductFilter!]){collection(handle:$handle){${collectionFields()} products(first:$first,after:$after,sortKey:$sortKey,reverse:$reverse,filters:$filters){nodes{...TetherProduct}pageInfo{hasNextPage endCursor}}}}`;
  var SEARCH_QUERY = `query TetherSearch($first:Int!,$after:String,$query:String,$sortKey:ProductSortKeys,$reverse:Boolean){products(first:$first,after:$after,query:$query,sortKey:$sortKey,reverse:$reverse){nodes{...TetherProduct}pageInfo{hasNextPage endCursor}}}`;
  async function getProducts({
    collection,
    query,
    first = cfg.collectionFirst,
    after = null,
    sortKey,
    reverse = false,
    filters
  } = {}) {
    if (collection) {
      const data2 = await gql(
        withProductFragment(COLLECTION_QUERY),
        {
          handle: collection,
          first,
          after,
          sortKey: sortKey || void 0,
          reverse,
          filters: filters ?? void 0
        },
        isCollectionAnswer
      );
      if (!data2.collection) throw new TetherError(`Collection not found: ${collection}`, { code: "NOT_FOUND" });
      const { products, ...rest } = data2.collection;
      products.nodes.forEach(primeProduct);
      return { collection: rest, products: products.nodes, pageInfo: products.pageInfo };
    }
    const data = await gql(
      withProductFragment(SEARCH_QUERY),
      { first, after, query: query || void 0, sortKey: sortKey || void 0, reverse },
      isSearchAnswer
    );
    data.products.nodes.forEach(primeProduct);
    return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
  }
  async function getRecommendations(product, intent = "RELATED") {
    const key = normalizeProductKey(typeof product === "object" ? product?.id : product);
    if (!key) throw new TetherError("No product for recommendations", { code: "NOT_FOUND" });
    const byId = key.startsWith("gid://");
    const data = await gql(
      withProductFragment(
        `query TetherRecs(${byId ? "$id: ID!" : "$handle: String!"},$intent:ProductRecommendationIntent){productRecommendations(${byId ? "productId: $id" : "productHandle: $handle"},intent:$intent){...TetherProduct}}`
      ),
      byId ? { id: key, intent } : { handle: key, intent },
      isRecommendationsAnswer
    );
    const list = data.productRecommendations ?? [];
    list.forEach(primeProduct);
    return list;
  }
  var listLimit = (root, fallback) => integerAttribute(root, "limit", { min: 1, max: MAX_CONNECTION_SIZE, fallback });
  var toIntent = (raw) => raw === "COMPLEMENTARY" ? "COMPLEMENTARY" : "RELATED";
  var ListScope = class {
    constructor(root) {
      __publicField(this, "root");
      __publicField(this, "products", []);
      __publicField(this, "pageInfo", null);
      __publicField(this, "collection", null);
      /** Counts loads, so only the latest one renders. */
      __publicField(this, "loadToken", 0);
      /**
       * The `loadToken` of the load in flight that replaces the products, `null` without one. A "load more" click during
       * it does nothing: its page would follow the products being replaced, which can be another market's.
       */
      __publicField(this, "replacingToken", null);
      /** Whether the list has warned about its `tether-sort`, so a list that reloads warns once. */
      __publicField(this, "warnedSort", false);
      /** Whether the list has warned about its `tether-empty-query`, likewise. */
      __publicField(this, "warnedEmptyQuery", false);
      this.root = root;
      root.addEventListener("click", (event) => {
        if (!isElement(event.target)) return;
        const more = event.target.closest(sel("load-more"));
        if (more?.closest(listSelector()) !== root) return;
        event.preventDefault();
        if (this.replacingToken !== null) return;
        void busy(more, () => this.load(true));
      });
    }
    $(selector) {
      return scoped(this.root, selector, listSelector());
    }
    /**
     * The collection or search query of the list's attributes.
     *
     * @returns `null` for a `url:` list whose parameter is missing or empty, with `tether-empty-query` (or `emptyQuery`)
     *   `none`: it lists nothing.
     */
    options() {
      const { root } = this;
      const query = {
        reverse: get(root, "reverse") === "true",
        first: listLimit(root, cfg.collectionFirst)
      };
      const isCollection = has(root, "collection");
      const sortKey = this.sortKey(isCollection);
      if (sortKey) query.sortKey = sortKey;
      if (isCollection) {
        query.collection = get(root, "collection") ?? "";
        return query;
      }
      const raw = get(root, "products") ?? "";
      if (!raw.startsWith(URL_QUERY_SOURCE)) {
        query.query = raw;
        return query;
      }
      query.query = new URL(window.location.href).searchParams.get(raw.slice(URL_QUERY_SOURCE.length)) || "";
      return query.query || this.emptyQuery() === "all" ? query : null;
    }
    /**
     * @returns The list's `tether-empty-query`, or the config's `emptyQuery` without one and, with a warning, for a value
     *   that is neither `all` nor `none`.
     */
    emptyQuery() {
      const raw = get(this.root, "empty-query");
      if (raw === "all" || raw === "none") return raw;
      if (raw !== null && !this.warnedEmptyQuery) {
        warn(`${attr("empty-query")} ${JSON.stringify(raw)} is not all or none: using ${cfg.emptyQuery}`, this.root);
        this.warnedEmptyQuery = true;
      }
      return cfg.emptyQuery;
    }
    /**
     * @returns The list's `tether-sort`, `undefined` (Shopify's default order) without one or, with a warning, for a key
     *   its source doesn't take: Shopify would fail the whole list. A search takes `CREATED` as `CREATED_AT`.
     */
    sortKey(isCollection) {
      const raw = get(this.root, "sort")?.trim();
      if (!raw) return void 0;
      if (isCollection ? COLLECTION_SORT_KEYS.has(raw) : SEARCH_SORT_KEYS.has(raw)) return raw;
      if (!isCollection && raw === "CREATED") return "CREATED_AT";
      if (!this.warnedSort) {
        warn(`${attr("sort")} ${JSON.stringify(raw)} is not a sort key of this list: using the default`, this.root);
      }
      this.warnedSort = true;
      return void 0;
    }
    /**
     * The product of a recommendations list: a handle, `url:…` (one dynamic product page), or empty inside a product
     * scope for that product.
     *
     * @throws {TetherError} `NOT_FOUND` when there is no product to recommend for.
     */
    async loadRecommendations() {
      let { key } = resolveProductKey(this.root, window.location, "recommendations");
      const scope = this.root.closest(sel("product"));
      if (!key && scope) ({ key } = resolveProductKey(scope));
      return getRecommendations(key, toIntent(get(this.root, "intent")));
    }
    /** @param more Appends the next page instead of replacing the products. */
    async load(more = false) {
      this.loadToken += 1;
      const token = this.loadToken;
      const stale = () => token !== this.loadToken;
      if (!more) this.replacingToken = token;
      try {
        if (has(this.root, "recommendations")) {
          const recommendations = await this.loadRecommendations();
          if (stale()) return;
          this.products = recommendations.slice(0, listLimit(this.root, recommendations.length));
        } else {
          const query = this.options();
          const after = more ? this.pageInfo?.endCursor ?? null : null;
          const page = query ? await getProducts({ ...query, after }) : noProducts();
          if (stale()) return;
          this.collection = page.collection;
          this.pageInfo = page.pageInfo;
          this.products = more ? [...this.products, ...page.products] : page.products;
        }
        this.render();
        setScopeStatus(this.root, "ready");
        emit("list-ready", { products: this.products, collection: this.collection }, this.root);
      } catch (error) {
        if (stale()) return;
        if (!more) setScopeStatus(this.root, isNotFound(error) ? "not-found" : "error", error);
        if (!(isNotFound(error) && has(this.root, "recommendations"))) reportError(error, "list load failed");
        emit("error", { error, context: "list" }, this.root);
      } finally {
        if (this.replacingToken === token) this.replacingToken = null;
      }
    }
    render() {
      const { collection } = this;
      this.$(sel("collection-bind")).forEach((el) => {
        switch (get(el, "collection-bind") ?? "") {
          case "title":
            setText(el, collection?.title ?? "");
            break;
          case "description":
            setStoreHtml(el, collection?.descriptionHtml);
            break;
          case "image":
            setImage(el, collection?.image?.url, collection?.image?.altText || collection?.title);
            break;
          case "count":
            setText(el, this.products.length);
            break;
        }
      });
      this.$(sel("list")).forEach((container) => {
        repeat(container, this.products, (node, product) => {
          node.setAttribute(attr("product"), product.handle);
          node.removeAttribute(attr("state"));
        });
        emit("list-rendered", { container }, this.root);
      });
      const empty = this.products.length === 0;
      this.$(sel("show")).forEach((el) => {
        const key = get(el, "show");
        if (key === "list-empty") show(el, empty);
        if (key === "list-filled") show(el, !empty);
      });
      this.$(sel("load-more")).forEach((el) => {
        show(el, Boolean(this.pageInfo?.hasNextPage));
      });
      notifyLayoutChanged("list");
    }
  };
  var listScopes = /* @__PURE__ */ new WeakMap();
  function loadList(root) {
    let scope = listScopes.get(root);
    if (!scope) {
      scope = new ListScope(root);
      listScopes.set(root, scope);
    }
    return scope.load();
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

  // src/parts/lists.ts
  registerPart("lists", lists_exports);
})();
