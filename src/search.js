// @ts-nocheck
/**
 * Search as you type (Shopify predictive search). Optional part: loaded only on pages with
 * [tether-search].
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
 * Each list's first child is the template. The root gets is-open while there are results (or none)
 * to show, and tether-search-state="loading|ready|empty|error". Arrow keys move through the results,
 * Escape closes. tether-search-limit (default 6), tether-search-min (characters, default 2).
 */
import { cfg, reportError } from './config.js';
import { gql } from './client.js';
import { attr, sel, get, qsa, setText, setImage, repeat, show, formatMoney, productUrl, emit } from './dom.js';

const QUERY = `query TetherPredictive($q: String!, $limit: Int!) {
  predictiveSearch(query: $q, limit: $limit, limitScope: EACH, types: [PRODUCT, COLLECTION, QUERY]) {
    products { id handle title availableForSale featuredImage { url altText } priceRange { minVariantPrice { amount currencyCode } } }
    collections { handle title image { url altText } }
    queries { text }
  }
}`;

const mounted = new WeakSet();
let uid = 0;

export function mountSearch(root = document) {
  const roots = [...(root.matches?.(sel('search')) ? [root] : []), ...qsa(root, sel('search'))];
  roots.forEach((el) => {
    if (!mounted.has(el)) {
      mounted.add(el);
      setup(el);
    }
  });
}

function setup(rootEl) {
  const input = rootEl.querySelector(sel('search-input')) || rootEl.querySelector('input');
  const results = rootEl.querySelector(sel('search-results'));
  if (!input || !results) return;
  const limit = parseInt(get(rootEl, 'search-limit') || '6', 10) || 6;
  const min = parseInt(get(rootEl, 'search-min') || '2', 10) || 2;
  const id = results.id || (results.id = `${cfg.prefix}-search-${++uid}`);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');
  if (!results.hasAttribute('role')) results.setAttribute('role', 'listbox');
  results.hidden = true;

  let token = 0;
  let timer = null;
  let last = '';
  const cache = new Map(); // term -> results, for typing back and forth

  const setState = (state) => rootEl.setAttribute(attr('search-state'), state);
  const open = (yes) => {
    rootEl.classList.toggle('is-open', yes);
    results.hidden = !yes;
    input.setAttribute('aria-expanded', String(yes));
    if (!yes) input.removeAttribute('aria-activedescendant');
  };
  const items = () => qsa(results, '[role="option"]');

  async function run(term) {
    const t = ++token;
    if (term.length < min) {
      open(false);
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const data = cache.get(term) || (await gql(QUERY, { q: term, limit })).predictiveSearch;
      cache.set(term, data);
      if (t !== token) return; // a newer search is on its way
      render(data, term);
    } catch (err) {
      if (t !== token) return;
      setState('error');
      reportError(err, 'search');
    }
  }

  function render(data, term) {
    const products = data?.products || [];
    const collections = data?.collections || [];
    const queries = (data?.queries || []).filter((q) => q.text.toLowerCase() !== term.toLowerCase());
    const fill = (name, list, each) =>
      qsa(results, sel(name)).forEach((c) => {
        repeat(c, list, each);
        show(c, list.length > 0);
      });
    fill('search-products', products, (node, p) => {
      binds(node, { title: p.title, price: formatMoney(p.priceRange?.minVariantPrice), image: p.featuredImage });
      link(node, productUrl(p.handle, p.id));
      node.classList.toggle('is-sold-out', !p.availableForSale);
    });
    fill('search-collections', collections, (node, c) => {
      binds(node, { title: c.title, image: c.image });
      link(node, `${(cfg.collectionPath || '/collection').replace(/\/$/, '')}/${c.handle}`);
    });
    fill('search-queries', queries, (node, q) => {
      binds(node, { text: q.text });
      const a = node.tagName === 'A' ? node : node.querySelector('a');
      const action = rootEl.getAttribute('action') || '/search';
      if (a)
        a.setAttribute(
          'href',
          `${action}${action.includes('?') ? '&' : '?'}${input.name || 'q'}=${encodeURIComponent(q.text)}`,
        );
    });
    const count = products.length + collections.length + queries.length;
    qsa(rootEl, sel('show')).forEach((el) => {
      const k = get(el, 'show');
      if (k === 'search-empty') show(el, count === 0);
      if (k === 'search-results') show(el, count > 0);
    });
    items().forEach((el, i) => {
      el.id ||= `${id}-${i}`;
      el.setAttribute('aria-selected', 'false');
    });
    setState(count ? 'ready' : 'empty');
    open(true);
    emit('search', { term, products, collections, queries }, rootEl);
  }

  function binds(node, values) {
    qsa(node, sel('search-bind')).forEach((el) => {
      const k = get(el, 'search-bind');
      if (k === 'image') setImage(el, values.image?.url, values.image?.altText || values.title);
      else if (values[k] != null) setText(el, values[k]);
    });
  }

  function link(node, href) {
    const a = node.tagName === 'A' ? node : node.querySelector('a');
    if (a) {
      a.setAttribute('href', href);
      a.setAttribute('role', 'option');
    }
  }

  input.addEventListener('input', () => {
    const term = input.value.trim();
    if (term === last) return;
    last = term;
    clearTimeout(timer);
    timer = setTimeout(() => run(term), cfg.searchDelay ?? 150);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= min && items().length) open(true);
  });
  input.addEventListener('keydown', (e) => {
    const list = items();
    const cur = list.findIndex((el) => el.getAttribute('aria-selected') === 'true');
    const move = (i) => {
      list.forEach((el, j) => el.setAttribute('aria-selected', String(j === i)));
      if (list[i]) {
        input.setAttribute('aria-activedescendant', list[i].id);
        list[i].scrollIntoView?.({ block: 'nearest' });
      }
    };
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault();
      open(true);
      move((cur + 1) % list.length);
    } else if (e.key === 'ArrowUp' && list.length) {
      e.preventDefault();
      move(cur <= 0 ? list.length - 1 : cur - 1);
    } else if (e.key === 'Enter' && cur >= 0) {
      e.preventDefault();
      list[cur].click();
    } else if (e.key === 'Escape') {
      open(false);
    }
  });
  document.addEventListener('click', (e) => {
    if (!rootEl.contains(e.target)) open(false);
  });
}
