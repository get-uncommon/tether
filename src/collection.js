// @ts-nocheck
/**
 * Product lists: [tether-collection="handle"] or [tether-products="search query"].
 * The first child of [tether-list] is the card template; every card becomes a
 * product scope, so all product attributes work inside cards (including
 * quick-add with a subscription toggle).
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
  setImage,
  repeat,
  notifyLayoutChanged,
  busy,
  show,
} from './dom.js';
import { getProducts, getRecommendations } from './loader.js';
import { setScopeStatus, isNotFound, resolveProductKey } from './status.js';

export const listSelector = () => `${sel('collection')},${sel('products')},${sel('recommendations')}`;

export class ListScope {
  constructor(root) {
    this.root = root;
    this.products = [];
    this.pageInfo = null;
    this.collection = null;
    setScopeStatus(root, 'loading');
    root.addEventListener('click', (e) => {
      const more = e.target.closest?.(sel('load-more'));
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
      first: parseInt(get(r, 'limit') || '', 10) || undefined,
      sortKey: get(r, 'sort') || undefined,
      reverse: get(r, 'reverse') === 'true',
    };
    if (has(r, 'collection')) opts.collection = get(r, 'collection');
    else {
      // url:q = the search in the page's ?q= (a results page on a static site).
      const raw = get(r, 'products') || '';
      opts.query = raw.startsWith('url:') ? new URL(window.location.href).searchParams.get(raw.slice(4)) || '' : raw;
    }
    return opts;
  }

  async load(more = false) {
    const token = (this.loadToken = (this.loadToken || 0) + 1);
    const stale = () => token !== this.loadToken;
    try {
      if (has(this.root, 'recommendations')) {
        // A handle, url:handle (one dynamic product page), or empty inside a product: that product.
        let { key } = resolveProductKey(this.root, window.location, 'recommendations');
        const scope = this.root.closest(sel('product'));
        if (!key && scope) ({ key } = resolveProductKey(scope));
        if (!key) throw new TetherError('No product for recommendations', { code: 'NOT_FOUND' });
        const recs = await getRecommendations(key, get(this.root, 'intent') || 'RELATED');
        if (stale()) return;
        const limit = parseInt(get(this.root, 'limit') || '', 10);
        this.products = limit ? recs.slice(0, limit) : recs;
      } else {
        const res = await getProducts({ ...this.options(), after: more ? this.pageInfo?.endCursor : null });
        if (stale()) return;
        this.collection = res.collection;
        this.pageInfo = res.pageInfo;
        this.products = more ? [...this.products, ...res.products] : res.products;
      }
      this.render();
      setScopeStatus(this.root, 'ready');
      emit('list-ready', { products: this.products, collection: this.collection }, this.root);
    } catch (err) {
      if (stale()) return;
      // Keep what's already rendered on a failed "load more"; otherwise show the error state.
      if (!more) setScopeStatus(this.root, isNotFound(err) ? 'not-found' : 'error', err);
      // A missing product for recommendations is a page detail, not an error to report.
      if (!(isNotFound(err) && has(this.root, 'recommendations'))) reportError(err, 'list load failed');
      emit('error', { error: err, context: 'list' }, this.root);
    }
  }

  render() {
    const c = this.collection;
    this.$(sel('collection-bind')).forEach((el) => {
      switch (get(el, 'collection-bind')) {
        case 'title':
          return setText(el, c?.title || '');
        case 'description':
          el.innerHTML = c?.descriptionHtml || '';
          return undefined;
        case 'image':
          return setImage(el, c?.image?.url, c?.image?.altText || c?.title);
        case 'count':
          return setText(el, this.products.length);
        default:
          return undefined;
      }
    });

    this.$(sel('list')).forEach((container) => {
      repeat(container, this.products, (node, p) => {
        node.setAttribute(attr('product'), p.handle);
        node.removeAttribute(attr('state'));
      });
      // Cards are new elements: mount them (product data is already cached).
      emit('list-rendered', { container }, this.root);
    });

    const empty = this.products.length === 0;
    this.$(sel('show')).forEach((el) => {
      const k = get(el, 'show');
      if (k === 'list-empty') show(el, empty);
      if (k === 'list-filled') show(el, !empty);
    });
    this.$(sel('load-more')).forEach((el) => show(el, Boolean(this.pageInfo?.hasNextPage)));
    notifyLayoutChanged('list');
  }
}
