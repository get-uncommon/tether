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
import { cfg, log, reportError } from './config.ts';
import { gql } from './client.ts';
import { attr, sel, get, qsa, setText, setImage, repeat, show, formatMoney, productUrl, emit } from './dom.ts';
import { within } from './mounting.ts';
import type { Money } from './shopify-values.ts';

interface SearchImage {
  url: string;
  altText: string | null;
}
interface SearchProduct {
  id: string;
  handle: string;
  title: string;
  availableForSale: boolean;
  featuredImage: SearchImage | null;
  priceRange: { minVariantPrice: Money };
}
interface SearchCollection {
  handle: string;
  title: string;
  image: SearchImage | null;
}
interface SearchQuery {
  text: string;
}
export interface SearchResults {
  products: SearchProduct[];
  collections: SearchCollection[];
  queries: SearchQuery[];
}
type SearchState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
interface BindValues {
  title?: string;
  price?: string;
  text?: string;
  image?: SearchImage | null;
}

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

const mounted = new WeakSet<Element>();
let searchBoxCount = 0;

/** @returns The attribute as an integer; `fallback` when it is missing, zero or not a number. */
function integerAttribute(el: Element, name: string, fallback: number): number {
  return parseInt(get(el, name) || '', 10) || fallback;
}

/** @returns `node` when it is a link, else its first link. */
const linkIn = (node: Element): Element | null => (node.tagName === 'A' ? node : node.querySelector('a'));

function bindValues(node: HTMLElement, values: BindValues) {
  qsa(node, sel('search-bind')).forEach((el) => {
    const field = get(el, 'search-bind');
    if (field === 'image') setImage(el, values.image?.url, values.image?.altText || values.title);
    else if (field === 'title' || field === 'price' || field === 'text') {
      if (values[field] != null) setText(el, values[field]);
    }
  });
}

/** @param href `null` for a product without a page: the option shows, without a link. */
function linkOption(node: Element, href: string | null) {
  const link = linkIn(node);
  if (!link) return;
  if (href) link.setAttribute('href', href);
  link.setAttribute('role', 'option');
}

/** One `[tether-search]` root: its input, its results and the search in flight. */
class SearchBox {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  readonly results: HTMLElement;
  readonly limit: number;
  readonly minCharacters: number;
  readonly resultsId: string;
  /** Counts searches, so only the latest one renders. */
  searchNumber = 0;
  timer: ReturnType<typeof setTimeout> | undefined = undefined;
  lastTerm = '';
  /** Results per term, for typing back and forth. */
  readonly cache = new Map<string, SearchResults | null>();

  constructor(root: HTMLElement, input: HTMLInputElement, results: HTMLElement) {
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
      if (!this.root.contains(event.target as Node | null)) this.open(false);
    });
  }

  setState(state: SearchState) {
    this.root.setAttribute(attr('search-state'), state);
  }

  open(open: boolean) {
    this.root.classList.toggle('is-open', open);
    this.results.hidden = !open;
    this.input.setAttribute('aria-expanded', String(open));
    if (!open) this.input.removeAttribute('aria-activedescendant');
  }

  options() {
    return qsa(this.results, '[role="option"]');
  }

  async fetchResults(term: string): Promise<SearchResults | null> {
    const cached = this.cache.get(term);
    if (cached) return cached;
    const data = await gql<{ predictiveSearch: SearchResults | null }>(QUERY, { q: term, limit: this.limit });
    this.cache.set(term, data.predictiveSearch);
    return data.predictiveSearch;
  }

  async search(term: string) {
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

  /** @param name The list attribute, e.g. `search-products`. */
  fillList<Item>(name: string, items: readonly Item[], render: (node: HTMLElement, item: Item) => void) {
    qsa(this.results, sel(name)).forEach((list) => {
      repeat(list, items, render);
      show(list, items.length > 0);
    });
  }

  queryUrl(text: string) {
    const action = this.root.getAttribute('action') || DEFAULT_ACTION;
    const separator = action.includes('?') ? '&' : '?';
    return `${action}${separator}${this.input.name || 'q'}=${encodeURIComponent(text)}`;
  }

  render(results: SearchResults | null, term: string) {
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

  showCount(count: number) {
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

  highlight(options: HTMLElement[], index: number) {
    options.forEach((option, optionIndex) => {
      option.setAttribute('aria-selected', String(optionIndex === index));
    });
    const option = options[index];
    if (!option) return;
    this.input.setAttribute('aria-activedescendant', option.id);
    // jsdom has no scrollIntoView.
    (option as Partial<Pick<HTMLElement, 'scrollIntoView'>>).scrollIntoView?.({ block: 'nearest' });
  }

  onKeydown(event: KeyboardEvent) {
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
 */
export function mountSearch(root: ParentNode & Partial<Pick<Element, 'matches'>> = document): void {
  for (const el of within(root, sel('search'))) {
    if (mounted.has(el)) continue;
    mounted.add(el);
    // The markup names an input element; a site without one gets the first input.
    const input = el.querySelector<HTMLInputElement>(sel('search-input')) ?? el.querySelector('input');
    const results = el.querySelector<HTMLElement>(sel('search-results'));
    if (input && results) new SearchBox(el, input, results);
  }
}
