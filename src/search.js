/**
 * Search as you type (Shopify predictive search). Optional part: loaded only on pages with [tether-search].
 *
 *   <form tether-search action="/search">            <!-- Enter: your full results page -->
 *     <input tether-search-input name="q" type="search" placeholder="Search">
 *     <div tether-search-results>
 *       <div tether-search-products><a><img tether-search-bind="image" max-width="120"><span tether-search-bind="title"></span> <span tether-search-bind="price"></span></a></div>
 *       <div tether-search-queries><a><span tether-search-bind="text"></span></a></div>
 *       <div tether-search-collections><a><span tether-search-bind="title"></span></a></div>
 *       <p tether-show="search-empty">No results</p>
 *     </div>
 *   </form>
 *
 * Each list's first child is the template. The root gets is-open while there are results (or none) to show, and
 * tether-search-state="idle|loading|ready|empty|error". Arrow keys move through the results, Escape closes.
 * tether-search-limit (default 6), tether-search-min (characters, default 2).
 */
import { cfg, log, reportError } from './config.js';
import { gql } from './client.js';
import { attr, sel, get, qsa, setText, setImage, repeat, show, formatMoney, productUrl, emit } from './dom.js';
import { within } from './mounting.js';
/** @import { Money } from './shopify-values.js' */

/** @typedef {{ url: string, altText: string | null }} SearchImage */
/**
 * @typedef {object} SearchProduct
 * @property {string} id
 * @property {string} handle
 * @property {string} title
 * @property {boolean} availableForSale
 * @property {SearchImage | null} featuredImage
 * @property {{ minVariantPrice: Money }} priceRange
 */
/** @typedef {{ handle: string, title: string, image: SearchImage | null }} SearchCollection */
/** @typedef {{ text: string }} SearchQuery */
/** @typedef {{ products: SearchProduct[], collections: SearchCollection[], queries: SearchQuery[] }} SearchResults */
/** @typedef {'idle' | 'loading' | 'ready' | 'empty' | 'error'} SearchState */
/** @typedef {{ title?: string, price?: string, text?: string, image?: SearchImage | null }} BindValues */

const QUERY = `query TetherPredictive($q: String!, $limit: Int!) {
  predictiveSearch(query: $q, limit: $limit, limitScope: EACH, types: [PRODUCT, COLLECTION, QUERY]) {
    products { id handle title availableForSale featuredImage { url altText } priceRange { minVariantPrice { amount currencyCode } } }
    collections { handle title image { url altText } }
    queries { text }
  }
}`;

const DEFAULT_LIMIT = 6;
const DEFAULT_MIN_CHARACTERS = 2;
const DEFAULT_ACTION = '/search';

/** @type {WeakSet<Element>} */
const mounted = new WeakSet();
let searchBoxCount = 0;

/**
 * @param {Element} el
 * @param {string} name
 * @param {number} fallback
 * @returns {number} The attribute as an integer; `fallback` when it is missing, zero or not a number.
 */
function integerAttribute(el, name, fallback) {
  return parseInt(get(el, name) || '', 10) || fallback;
}

/**
 * @param {Element} node
 * @returns {Element | null} `node` when it is a link, else its first link.
 */
const linkIn = (node) => (node.tagName === 'A' ? node : node.querySelector('a'));

/**
 * @param {HTMLElement} node
 * @param {BindValues} values
 */
function bindValues(node, values) {
  qsa(node, sel('search-bind')).forEach((el) => {
    const field = get(el, 'search-bind');
    if (field === 'image') setImage(el, values.image?.url, values.image?.altText || values.title);
    else if (field === 'title' || field === 'price' || field === 'text') {
      if (values[field] != null) setText(el, values[field]);
    }
  });
}

/**
 * @param {Element} node
 * @param {string} href
 */
function linkOption(node, href) {
  const link = linkIn(node);
  if (!link) return;
  link.setAttribute('href', href);
  link.setAttribute('role', 'option');
}

/** One `[tether-search]` root: its input, its results and the search in flight. */
class SearchBox {
  /**
   * @param {HTMLElement} root
   * @param {HTMLInputElement} input
   * @param {HTMLElement} results
   */
  constructor(root, input, results) {
    this.root = root;
    this.input = input;
    this.results = results;
    this.limit = integerAttribute(root, 'search-limit', DEFAULT_LIMIT);
    this.minCharacters = integerAttribute(root, 'search-min', DEFAULT_MIN_CHARACTERS);
    if (!results.id) {
      searchBoxCount += 1;
      results.id = `${cfg.prefix}-search-${searchBoxCount}`;
    }
    this.resultsId = results.id;
    /** Counts searches, so only the latest one renders. */
    this.searchNumber = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.timer = undefined;
    this.lastTerm = '';
    /** @type {Map<string, SearchResults | null>} Results per term, for typing back and forth. */
    this.cache = new Map();
    this.setUpAria();
    this.listen();
  }

  setUpAria() {
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-controls', this.resultsId);
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('autocomplete', 'off');
    if (!this.results.hasAttribute('role')) this.results.setAttribute('role', 'listbox');
    this.results.hidden = true;
  }

  listen() {
    this.input.addEventListener('input', () => {
      const term = this.input.value.trim();
      if (term === this.lastTerm) return;
      this.lastTerm = term;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.search(term), cfg.searchDelay);
    });
    this.input.addEventListener('focus', () => {
      if (this.input.value.trim().length >= this.minCharacters && this.options().length) this.open(true);
    });
    this.input.addEventListener('keydown', (event) => {
      this.onKeydown(event);
    });
    document.addEventListener('click', (event) => {
      // A click event's target is always a node.
      if (!this.root.contains(/** @type {Node | null} */ (event.target))) this.open(false);
    });
  }

  /** @param {SearchState} state */
  setState(state) {
    this.root.setAttribute(attr('search-state'), state);
  }

  /** @param {boolean} open */
  open(open) {
    this.root.classList.toggle('is-open', open);
    this.results.hidden = !open;
    this.input.setAttribute('aria-expanded', String(open));
    if (!open) this.input.removeAttribute('aria-activedescendant');
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
    /** @type {{ predictiveSearch: SearchResults | null }} */
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
      this.setState('idle');
      return;
    }
    this.setState('loading');
    try {
      const results = await this.fetchResults(term);
      if (searchNumber === this.searchNumber) this.render(results, term);
    } catch (error) {
      // A newer search owns the state and reports its own failure.
      if (searchNumber !== this.searchNumber) {
        log('a superseded search failed', error);
        return;
      }
      this.setState('error');
      reportError(error, 'search');
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
    const action = this.root.getAttribute('action') || DEFAULT_ACTION;
    const separator = action.includes('?') ? '&' : '?';
    return `${action}${separator}${this.input.name || 'q'}=${encodeURIComponent(text)}`;
  }

  /**
   * @param {SearchResults | null} results
   * @param {string} term
   */
  render(results, term) {
    const products = results?.products ?? [];
    const collections = results?.collections ?? [];
    const queries = (results?.queries ?? []).filter((query) => query.text.toLowerCase() !== term.toLowerCase());
    this.fillList('search-products', products, (node, product) => {
      const price = formatMoney(product.priceRange.minVariantPrice);
      bindValues(node, { title: product.title, price, image: product.featuredImage });
      linkOption(node, productUrl(product.handle, product.id));
      node.classList.toggle('is-sold-out', !product.availableForSale);
    });
    this.fillList('search-collections', collections, (node, collection) => {
      bindValues(node, { title: collection.title, image: collection.image });
      linkOption(node, `${(cfg.collectionPath || '/collection').replace(/\/$/, '')}/${collection.handle}`);
    });
    this.fillList('search-queries', queries, (node, query) => {
      bindValues(node, { text: query.text });
      linkIn(node)?.setAttribute('href', this.queryUrl(query.text));
    });
    const count = products.length + collections.length + queries.length;
    this.showCount(count);
    this.setState(count ? 'ready' : 'empty');
    this.open(true);
    emit('search', { term, products, collections, queries }, this.root);
  }

  /** @param {number} count */
  showCount(count) {
    qsa(this.root, sel('show')).forEach((el) => {
      const condition = get(el, 'show');
      if (condition === 'search-empty') show(el, count === 0);
      if (condition === 'search-results') show(el, count > 0);
    });
    this.options().forEach((option, index) => {
      option.id ||= `${this.resultsId}-${index}`;
      option.setAttribute('aria-selected', 'false');
    });
  }

  /**
   * @param {HTMLElement[]} options
   * @param {number} index
   */
  highlight(options, index) {
    options.forEach((option, optionIndex) => {
      option.setAttribute('aria-selected', String(optionIndex === index));
    });
    const option = options[index];
    if (!option) return;
    this.input.setAttribute('aria-activedescendant', option.id);
    // jsdom has no scrollIntoView.
    /** @type {Partial<Pick<HTMLElement, 'scrollIntoView'>>} */ (option).scrollIntoView?.({ block: 'nearest' });
  }

  /** @param {KeyboardEvent} event */
  onKeydown(event) {
    const options = this.options();
    const current = options.findIndex((option) => option.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      this.open(true);
      this.highlight(options, (current + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      this.highlight(options, current <= 0 ? options.length - 1 : current - 1);
    } else if (event.key === 'Enter' && current >= 0) {
      event.preventDefault();
      options[current]?.click();
    } else if (event.key === 'Escape') {
      this.open(false);
    }
  }
}

/**
 * Sets up every `[tether-search]` in `root` (and `root` itself) once.
 *
 * @param {ParentNode & Partial<Pick<Element, 'matches'>>} [root]
 */
export function mountSearch(root = document) {
  for (const el of within(root, sel('search'))) {
    if (mounted.has(el)) continue;
    mounted.add(el);
    // The markup names an input element; a site without one gets the first input.
    const input = /** @type {HTMLInputElement | null} */ (
      el.querySelector(sel('search-input')) ?? el.querySelector('input')
    );
    const results = /** @type {HTMLElement | null} */ (el.querySelector(sel('search-results')));
    if (input && results) new SearchBox(el, input, results);
  }
}
