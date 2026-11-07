/**
 * Product lists, an optional part loaded with a page's first list: [tether-collection="handle"], [tether-products="search
 * query"] and [tether-recommendations]. The first child of [tether-list] is the card template; every card becomes a
 * product scope, so all product attributes work inside cards (including quick-add with a subscription toggle). The
 * core finds the lists and keeps each one's handle (`collection.ts`); this part queries and renders them, and answers
 * `Tether.getProducts()` and `Tether.getRecommendations()`.
 */
import { cfg, reportError, warn } from './config.ts';
import { gql, TetherError } from './client.ts';
import {
  attr,
  sel,
  get,
  has,
  scoped,
  emit,
  setText,
  setStoreHtml,
  setImage,
  repeat,
  notifyLayoutChanged,
  busy,
  show,
  integerAttribute,
  isElement,
} from './dom.ts';
import { collectionFields } from './shopify-fields.ts';
import { normalizeProductKey, primeProduct, withProductFragment } from './loader.ts';
import { isCollectionAnswer, isRecommendationsAnswer, isSearchAnswer } from './product-answers.ts';
import { setScopeStatus, isNotFound, resolveProductKey } from './status.ts';
import { listSelector } from './collection.ts';
import type { Product } from './fragments.ts';
import { MAX_CONNECTION_SIZE } from './shopify-values.ts';
import type { ProductRef, RecommendationIntent } from './shopify-values.ts';
import type { Collection, PageInfo, ProductPage, ProductQuery } from './loader.ts';
import type { EmptyQuery } from './config.ts';

/** `tether-products="url:q"`: the search in the page's `?q=`, for a results page on a static site. */
const URL_QUERY_SOURCE = 'url:';

/**
 * What a `url:` list without a search in its parameter shows: no products, and no request for them. A new page each
 * time, as `list-ready` hands its products to the site.
 */
const noProducts = (): ProductPage => ({
  collection: null,
  products: [],
  pageInfo: { hasNextPage: false, endCursor: null },
});

/** Storefront API `ProductCollectionSortKeys`, which a collection's products take. */
const COLLECTION_SORT_KEYS = new Set([
  'BEST_SELLING',
  'COLLECTION_DEFAULT',
  'CREATED',
  'ID',
  'MANUAL',
  'PRICE',
  'RELEVANCE',
  'TITLE',
]);
/** Storefront API `ProductSortKeys`, which a search takes. */
const SEARCH_SORT_KEYS = new Set([
  'BEST_SELLING',
  'CREATED_AT',
  'ID',
  'PRICE',
  'PRODUCT_TYPE',
  'RELEVANCE',
  'TITLE',
  'UPDATED_AT',
  'VENDOR',
]);

const COLLECTION_QUERY = `query TetherCollection($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean, $filters: [ProductFilter!]) {
  collection(handle: $handle) {
    ${collectionFields()}
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
      nodes { ...TetherProduct }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const SEARCH_QUERY = `query TetherSearch($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
  products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
    nodes { ...TetherProduct }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * A page of products from a collection (by handle) or from a search. Every product on it is cached.
 *
 * @throws {TetherError} `NOT_FOUND` for a collection the store doesn't have.
 */
export async function getProducts({
  collection,
  query,
  first = cfg.collectionFirst,
  after = null,
  sortKey,
  reverse = false,
  filters,
}: ProductQuery = {}): Promise<ProductPage> {
  if (collection) {
    const data = await gql(
      withProductFragment(COLLECTION_QUERY),
      {
        handle: collection,
        first,
        after,
        sortKey: sortKey || undefined,
        reverse,
        filters: filters ?? undefined,
      },
      isCollectionAnswer,
    );
    if (!data.collection) throw new TetherError(`Collection not found: ${collection}`, { code: 'NOT_FOUND' });
    const { products, ...rest } = data.collection;
    products.nodes.forEach(primeProduct);
    return { collection: rest, products: products.nodes, pageInfo: products.pageInfo };
  }

  const data = await gql(
    withProductFragment(SEARCH_QUERY),
    { first, after, query: query || undefined, sortKey: sortKey || undefined, reverse },
    isSearchAnswer,
  );
  data.products.nodes.forEach(primeProduct);
  return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
}

/**
 * Shopify's recommendations for a product. Every product in them is cached.
 *
 * @throws {TetherError} `NOT_FOUND` when `product` names no product (empty, `null` or `undefined`).
 */
export async function getRecommendations(
  product: ProductRef | null | undefined,
  intent: RecommendationIntent = 'RELATED',
): Promise<Product[]> {
  const key = normalizeProductKey(typeof product === 'object' ? product?.id : product);
  if (!key) throw new TetherError('No product for recommendations', { code: 'NOT_FOUND' });
  const byId = key.startsWith('gid://');
  const data = await gql(
    withProductFragment(
      `query TetherRecs(${byId ? '$id: ID!' : '$handle: String!'}, $intent: ProductRecommendationIntent) {
  productRecommendations(${byId ? 'productId: $id' : 'productHandle: $handle'}, intent: $intent) { ...TetherProduct }
}`,
    ),
    byId ? { id: key, intent } : { handle: key, intent },
    isRecommendationsAnswer,
  );
  const list = data.productRecommendations ?? [];
  list.forEach(primeProduct);
  return list;
}

/** @returns The list's `tether-limit`: how many products it shows, `fallback` without one. */
const listLimit = (root: Element, fallback: number): number =>
  integerAttribute(root, 'limit', { min: 1, max: MAX_CONNECTION_SIZE, fallback });

/**
 * @param raw A `tether-intent`.
 * @returns Shopify's recommendation intent, `RELATED` unless `COMPLEMENTARY` is written.
 */
const toIntent = (raw: string | null): RecommendationIntent => (raw === 'COMPLEMENTARY' ? 'COMPLEMENTARY' : 'RELATED');

class ListScope {
  readonly root: HTMLElement;
  products: Product[] = [];
  pageInfo: PageInfo | null = null;
  collection: Collection | null = null;
  /** Counts loads, so only the latest one renders. */
  loadToken = 0;
  /**
   * The `loadToken` of the load in flight that replaces the products, `null` without one. A "load more" click during
   * it does nothing: its page would follow the products being replaced, which can be another market's.
   */
  replacingToken: number | null = null;
  /** Whether the list has warned about its `tether-sort`, so a list that reloads warns once. */
  warnedSort = false;
  /** Whether the list has warned about its `tether-empty-query`, likewise. */
  warnedEmptyQuery = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (event) => {
      if (!isElement(event.target)) return;
      const more = event.target.closest(sel('load-more'));
      if (more?.closest(listSelector()) !== root) return;
      event.preventDefault();
      if (this.replacingToken !== null) return;
      void busy(more, () => this.load(true));
    });
  }

  $(selector: string) {
    return scoped(this.root, selector, listSelector());
  }

  /**
   * The collection or search query of the list's attributes.
   *
   * @returns `null` for a `url:` list whose parameter is missing or empty, with `tether-empty-query` (or `emptyQuery`)
   *   `none`: it lists nothing.
   */
  options(): ProductQuery | null {
    const { root } = this;
    const query: ProductQuery = {
      reverse: get(root, 'reverse') === 'true',
      first: listLimit(root, cfg.collectionFirst),
    };
    const isCollection = has(root, 'collection');
    const sortKey = this.sortKey(isCollection);
    if (sortKey) query.sortKey = sortKey;
    if (isCollection) {
      query.collection = get(root, 'collection') ?? '';
      return query;
    }
    const raw = get(root, 'products') ?? '';
    if (!raw.startsWith(URL_QUERY_SOURCE)) {
      query.query = raw;
      return query;
    }
    query.query = new URL(window.location.href).searchParams.get(raw.slice(URL_QUERY_SOURCE.length)) || '';
    return query.query || this.emptyQuery() === 'all' ? query : null;
  }

  /**
   * @returns The list's `tether-empty-query`, or the config's `emptyQuery` without one and, with a warning, for a value
   *   that is neither `all` nor `none`.
   */
  emptyQuery(): EmptyQuery {
    const raw = get(this.root, 'empty-query');
    if (raw === 'all' || raw === 'none') return raw;
    if (raw !== null && !this.warnedEmptyQuery) {
      warn(`${attr('empty-query')} ${JSON.stringify(raw)} is not all or none: using ${cfg.emptyQuery}`, this.root);
      this.warnedEmptyQuery = true;
    }
    return cfg.emptyQuery;
  }

  /**
   * @returns The list's `tether-sort`, `undefined` (Shopify's default order) without one or, with a warning, for a key
   *   its source doesn't take: Shopify would fail the whole list. A search takes `CREATED` as `CREATED_AT`.
   */
  sortKey(isCollection: boolean): string | undefined {
    const raw = get(this.root, 'sort')?.trim();
    if (!raw) return undefined;
    if (isCollection ? COLLECTION_SORT_KEYS.has(raw) : SEARCH_SORT_KEYS.has(raw)) return raw;
    if (!isCollection && raw === 'CREATED') return 'CREATED_AT';
    if (!this.warnedSort) {
      warn(`${attr('sort')} ${JSON.stringify(raw)} is not a sort key of this list: using the default`, this.root);
    }
    this.warnedSort = true;
    return undefined;
  }

  /**
   * The product of a recommendations list: a handle, `url:…` (one dynamic product page), or empty inside a product
   * scope for that product.
   *
   * @throws {TetherError} `NOT_FOUND` when there is no product to recommend for.
   */
  async loadRecommendations(): Promise<Product[]> {
    let { key } = resolveProductKey(this.root, window.location, 'recommendations');
    const scope = this.root.closest(sel('product'));
    if (!key && scope) ({ key } = resolveProductKey(scope));
    return getRecommendations(key, toIntent(get(this.root, 'intent')));
  }

  /** @param more Appends the next page instead of replacing the products. */
  async load(more = false): Promise<void> {
    this.loadToken += 1;
    const token = this.loadToken;
    const stale = () => token !== this.loadToken;
    if (!more) this.replacingToken = token;
    try {
      if (has(this.root, 'recommendations')) {
        const recommendations = await this.loadRecommendations();
        if (stale()) return;
        this.products = recommendations.slice(0, listLimit(this.root, recommendations.length));
      } else {
        const query = this.options();
        const after = more ? (this.pageInfo?.endCursor ?? null) : null;
        const page = query ? await getProducts({ ...query, after }) : noProducts();
        if (stale()) return;
        this.collection = page.collection;
        this.pageInfo = page.pageInfo;
        this.products = more ? [...this.products, ...page.products] : page.products;
      }
      this.render();
      setScopeStatus(this.root, 'ready');
      emit('list-ready', { products: this.products, collection: this.collection }, this.root);
    } catch (error) {
      if (stale()) return;
      // A failed "load more" keeps what is rendered; otherwise the list shows its error state.
      if (!more) setScopeStatus(this.root, isNotFound(error) ? 'not-found' : 'error', error);
      // A missing product for recommendations is a page detail, not an error to report.
      if (!(isNotFound(error) && has(this.root, 'recommendations'))) reportError(error, 'list load failed');
      emit('error', { error, context: 'list' }, this.root);
    } finally {
      if (this.replacingToken === token) this.replacingToken = null;
    }
  }

  render() {
    const { collection } = this;
    this.$(sel('collection-bind')).forEach((el) => {
      switch (get(el, 'collection-bind') ?? '') {
        case 'title':
          setText(el, collection?.title ?? '');
          break;
        case 'description':
          setStoreHtml(el, collection?.descriptionHtml);
          break;
        case 'image':
          setImage(el, collection?.image?.url, collection?.image?.altText || collection?.title);
          break;
        case 'count':
          setText(el, this.products.length);
          break;
      }
    });

    this.$(sel('list')).forEach((container) => {
      repeat(container, this.products, (node, product) => {
        node.setAttribute(attr('product'), product.handle);
        node.removeAttribute(attr('state'));
      });
      // Cards are new elements: mounting them uses the product data already cached.
      emit('list-rendered', { container }, this.root);
    });

    const empty = this.products.length === 0;
    this.$(sel('show')).forEach((el) => {
      const key = get(el, 'show');
      if (key === 'list-empty') show(el, empty);
      if (key === 'list-filled') show(el, !empty);
    });
    this.$(sel('load-more')).forEach((el) => {
      show(el, Boolean(this.pageInfo?.hasNextPage));
    });
    notifyLayoutChanged('list');
  }
}

const listScopes = new WeakMap<HTMLElement, ListScope>();

/**
 * Loads the products of the list at `root` and renders them, replacing what it shows. Never rejects: a failure shows
 * in the list's state and is reported.
 */
export function loadList(root: HTMLElement): Promise<void> {
  let scope = listScopes.get(root);
  if (!scope) {
    scope = new ListScope(root);
    listScopes.set(root, scope);
  }
  return scope.load();
}
