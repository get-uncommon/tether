/**
 * Product lists: [tether-collection="handle"] or [tether-products="search query"].
 * The first child of [tether-list] is the card template; every card becomes a
 * product scope, so all product attributes work inside cards (including
 * quick-add with a subscription toggle).
 */
import { reportError } from './config.js';
import { attr, sel, get, has, scoped, emit, setText, setImage, repeat, notifyLayoutChanged, busy } from './dom.js';
import { getProducts, getRecommendations, getProduct } from './loader.js';
import { setScopeStatus, isNotFound } from './status.js';

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

  $(s) { return scoped(this.root, s, listSelector()); }

  options() {
    const r = this.root;
    const opts = {
      first: parseInt(get(r, 'limit') || '', 10) || undefined,
      sortKey: get(r, 'sort') || undefined,
      reverse: get(r, 'reverse') === 'true',
    };
    if (has(r, 'collection')) opts.collection = get(r, 'collection');
    else opts.query = get(r, 'products') || '';
    return opts;
  }

  async load(more = false) {
    try {
      if (has(this.root, 'recommendations')) {
        const key = get(this.root, 'recommendations');
        const base = await getProduct(key);
        this.products = await getRecommendations(base.id, get(this.root, 'intent') || 'RELATED');
        const limit = parseInt(get(this.root, 'limit') || '', 10);
        if (limit) this.products = this.products.slice(0, limit);
      } else {
        const res = await getProducts({ ...this.options(), after: more ? this.pageInfo?.endCursor : null });
        this.collection = res.collection;
        this.pageInfo = res.pageInfo;
        this.products = more ? [...this.products, ...res.products] : res.products;
      }
      this.render();
      setScopeStatus(this.root, 'ready');
      emit('list-ready', { products: this.products, collection: this.collection }, this.root);
    } catch (err) {
      // Keep what's already rendered on a failed "load more"; otherwise show the error state.
      if (!more) setScopeStatus(this.root, isNotFound(err) ? 'not-found' : 'error', err);
      reportError(err, 'list load failed');
      emit('error', { error: err, context: 'list' }, this.root);
    }
  }

  render() {
    const c = this.collection;
    this.$(sel('collection-bind')).forEach((el) => {
      switch (get(el, 'collection-bind')) {
        case 'title': return setText(el, c?.title || '');
        case 'description': el.innerHTML = c?.descriptionHtml || ''; return undefined;
        case 'image': return setImage(el, c?.image?.url, c?.image?.altText || c?.title);
        case 'count': return setText(el, this.products.length);
        default: return undefined;
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
      if (k === 'list-empty') el.style.display = empty ? '' : 'none';
      if (k === 'list-filled') el.style.display = empty ? 'none' : '';
    });
    this.$(sel('load-more')).forEach((el) => { el.style.display = this.pageInfo?.hasNextPage ? '' : 'none'; });
    notifyLayoutChanged('list');
  }
}

