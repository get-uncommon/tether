/**
 * Product lists: [tether-collection="handle"], [tether-products="search query"] and [tether-recommendations]. The
 * first child of [tether-list] is the card template; every card becomes a product scope, so all product attributes
 * work inside cards (including quick-add with a subscription toggle).
 */
import { reportError } from './config.js';
import { TetherError } from './client.js';
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
} from './dom.js';
import { getProducts, getRecommendations } from './loader.js';
import { setScopeStatus, isNotFound, resolveProductKey } from './status.js';
/** @import { Product } from './fragments.js' */
/** @import { Collection, PageInfo, ProductQuery } from './loader.js' */

/** `tether-products="url:q"`: the search in the page's `?q=`, for a results page on a static site. */
const URL_QUERY_SOURCE = 'url:';

export const listSelector = () => `${sel('collection')},${sel('products')},${sel('recommendations')}`;

/**
 * @param {EventTarget | null} target
 * @returns {target is Element}
 */
const isElement = (target) => target instanceof window.Element;

/**
 * @param {string | null} raw A `tether-limit`.
 * @returns {number | undefined} The limit; `undefined` for none, zero or not a number.
 */
const toLimit = (raw) => parseInt(raw ?? '', 10) || undefined;

/**
 * @param {string | null} raw A `tether-intent`.
 * @returns {'RELATED' | 'COMPLEMENTARY'} Shopify's recommendation intent, `RELATED` unless `COMPLEMENTARY` is written.
 */
const toIntent = (raw) => (raw === 'COMPLEMENTARY' ? 'COMPLEMENTARY' : 'RELATED');

export class ListScope {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    /** @type {Product[]} */
    this.products = [];
    /** @type {PageInfo | null} */
    this.pageInfo = null;
    /** @type {Collection | null} */
    this.collection = null;
    /** Counts loads, so only the latest one renders. */
    this.loadToken = 0;
    setScopeStatus(root, 'loading');
    root.addEventListener('click', (event) => {
      if (!isElement(event.target)) return;
      const more = event.target.closest(sel('load-more'));
      if (more?.closest(listSelector()) !== root) return;
      event.preventDefault();
      void busy(more, () => this.load(true));
    });
  }

  /** @param {string} selector */
  $(selector) {
    return scoped(this.root, selector, listSelector());
  }

  /** @returns {ProductQuery} The collection or search query of the list's attributes. */
  options() {
    const { root } = this;
    /** @type {ProductQuery} */
    const query = { reverse: get(root, 'reverse') === 'true' };
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
   * @returns {Promise<Product[]>}
   * @throws {TetherError} `NOT_FOUND` when there is no product to recommend for.
   */
  async loadRecommendations() {
    let { key } = resolveProductKey(this.root, window.location, 'recommendations');
    const scope = this.root.closest(sel('product'));
    if (!key && scope) ({ key } = resolveProductKey(scope));
    if (!key) throw new TetherError('No product for recommendations', { code: 'NOT_FOUND' });
    return getRecommendations(key, toIntent(get(this.root, 'intent')));
  }

  /** @param {boolean} [more] Appends the next page instead of replacing the products. */
  async load(more = false) {
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
