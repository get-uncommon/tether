/**
 * Product lists, an optional part loaded with a page's first list: [tether-collection="handle"], [tether-products="search
 * query"] and [tether-recommendations]. The first child of [tether-list] is the card template; every card becomes a
 * product scope, so all product attributes work inside cards (including quick-add with a subscription toggle). The
 * core finds the lists and keeps each one's handle (`collection.ts`); this part queries and renders them, and answers
 * `Tether.getProducts()` and `Tether.getRecommendations()`.
 */
import { cfg, reportError } from './config.ts';
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
} from './dom.ts';
import { collectionFields } from './fragments.ts';
import { normalizeProductKey, primeProduct, withProductFragment } from './loader.ts';
import { isCollectionAnswer, isRecommendationsAnswer, isSearchAnswer } from './product-shape.ts';
import { setScopeStatus, isNotFound, resolveProductKey } from './status.ts';
import { listSelector } from './collection.ts';
import type { Product } from './fragments.ts';
import type { ProductRef, RecommendationIntent } from './shopify-values.ts';
import type { Collection, PageInfo, ProductPage, ProductQuery } from './loader.ts';

/** `tether-products="url:q"`: the search in the page's `?q=`, for a results page on a static site. */
const URL_QUERY_SOURCE = 'url:';

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

const isElement = (target: EventTarget | null): target is Element => target instanceof window.Element;

/**
 * @param raw A `tether-limit`.
 * @returns The limit; `undefined` for none, zero or not a number.
 */
const toLimit = (raw: string | null): number | undefined => parseInt(raw ?? '', 10) || undefined;

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

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (event) => {
      if (!isElement(event.target)) return;
      const more = event.target.closest(sel('load-more'));
      if (more?.closest(listSelector()) !== root) return;
      event.preventDefault();
      void busy(more, () => this.load(true));
    });
  }

  $(selector: string) {
    return scoped(this.root, selector, listSelector());
  }

  /** The collection or search query of the list's attributes. */
  options(): ProductQuery {
    const { root } = this;
    const query: ProductQuery = { reverse: get(root, 'reverse') === 'true' };
    const first = toLimit(get(root, 'limit'));
    if (first) query.first = first;
    const sortKey = get(root, 'sort');
    if (sortKey) query.sortKey = sortKey;
    if (has(root, 'collection')) {
      query.collection = get(root, 'collection') ?? '';
      return query;
    }
    const raw = get(root, 'products') ?? '';
    query.query = raw.startsWith(URL_QUERY_SOURCE)
      ? new URL(window.location.href).searchParams.get(raw.slice(URL_QUERY_SOURCE.length)) || ''
      : raw;
    return query;
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
    try {
      if (has(this.root, 'recommendations')) {
        const recommendations = await this.loadRecommendations();
        if (stale()) return;
        const limit = toLimit(get(this.root, 'limit'));
        this.products = limit ? recommendations.slice(0, limit) : recommendations;
      } else {
        const page = await getProducts({ ...this.options(), after: more ? (this.pageInfo?.endCursor ?? null) : null });
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
