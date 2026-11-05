/**
 * Tether.diagnose(): one call in the browser console that explains what's
 * wrong on a page. Logs a readable report and returns it as an object.
 *
 *   await Tether.diagnose()
 *   await Tether.diagnose({ silent: true })   // just the object
 */
import { cfg, isConfigured } from './config.js';
import { gql, endpoint } from './client.js';
import { attr, sel, get, qsa, hasTemplate } from './dom.js';
import { getProduct } from './loader.js';
import { allPlans } from './selling-plans.js';
import { resolveProductKey, boundary } from './status.js';
import { apiVersionStatus } from './api-version.js';
import { detectMarket } from './markets.js';

export { apiVersionStatus };

// Everything Tether reads, to tell valid markup from typos.
const SHOW = new Set([
  'in-stock', 'out-of-stock', 'backorder', 'low-stock', 'plenty-in-stock', 'on-sale', 'not-on-sale', 'has-variants', 'single-variant',
  'subscription-available', 'subscription-unavailable', 'subscription-only', 'one-time-available',
  'subscription-selected', 'one-time-selected', 'has-savings', 'loading', 'ready', 'error', 'not-found',
  'cart-empty', 'cart-filled', 'cart-has-subscription', 'cart-no-subscription', 'cart-has-discount', 'cart-error', 'cart-warning',
  'list-empty', 'list-filled', 'search-empty', 'search-results', 'logged-in', 'logged-out', 'orders-empty', 'orders-loading',
]);
const BIND = new Set([
  'title', 'description', 'description-text', 'vendor', 'type', 'handle', 'published-at', 'price', 'total-price',
  'compare-at-price', 'unit-price', 'min-price', 'max-price', 'discount-percentage', 'discount-amount', 'variant-title',
  'variant-id', 'sku', 'barcode', 'stock', 'quantity', 'featured-image', 'variant-image', 'images', 'tags', 'link', 'url',
  'one-time-price', 'subscription-price', 'subscription-savings', 'subscription-savings-amount', 'checkout-charge',
  'plan-name', 'plan-description', 'plan-group', 'option-value', 'swatch', 'image',
]);
const ATTRS = new Set(`account account-bind account-link account-login account-logout add-label add-to-cart adding-text
  always-enabled bind cart-checkout-charge cart-clear cart-close cart-count cart-discounts cart-drawer cart-label cart-lines
  cart-note cart-open cart-subtotal cart-total cart-warning checkout code collection collection-bind countries country
  country-bind country-label country-select default-plan default-purchase discount discount-code discount-form discount-input
  discount-remove display error group group-add hide-single language limit line line-attribute line-attributes line-id
  line-minus line-plan line-plus line-remove line-show list load-more market-pending one-time-label option option-list
  option-selected option-value order-bind order-line order-lines orders page-country page-language page-locale page-title plan plan-bind plan-list
  plan-value product products purchase purchase-mode qty qty-minus qty-plus quantity recommendations reverse search
  search-bind search-collections search-input search-limit search-min search-products search-queries search-results
  search-state show soldout-text sort state subscribe-text variant variant-select variant-url max-width max-height crop
  sig label hydrated busy`.split(/\s+/).filter(Boolean));

/** Levenshtein distance, for "did you mean". */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
export function didYouMean(value, options, prefix = '') {
  let best = null; let score = Infinity;
  for (const o of options) {
    const n = distance(String(value), o);
    if (n < score) { score = n; best = o; }
  }
  return best && score <= Math.max(2, Math.floor(String(value).length / 4)) ? ` Did you mean "${prefix}${best}"?` : '';
}

const mask = (t) => (t ? `${String(t).slice(0, 4)}…${String(t).slice(-4)} (${String(t).length} chars)` : '(missing)');

function describe(el) {
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}

/** Markup problems that don't need the network. */
export function checkMarkup(root = document) {
  const problems = [];
  const add = (level, message, el) => problems.push({ level, message, element: el ? describe(el) : undefined, el });
  const inProduct = (el) => Boolean(el.closest(sel('product')));
  const listSel = `${sel('collection')},${sel('products')},${sel('recommendations')}`;

  qsa(root, sel('product')).forEach((el) => {
    if (el.closest(listSel) && el.closest(sel('list'))) return; // list cards get their handle at render time
    const { key, fromUrl, raw } = resolveProductKey(el);
    if (!raw) add('error', `${attr('product')} has no value. Bind it to the Shopify handle (CMS field), or use "url:handle".`, el);
    else if (fromUrl && !key) add('warn', `${attr('product')}="${raw}" but this URL has no value for it (e.g. ?handle=my-product).`, el);
  });

  const productOnly = ['bind', 'option-list', 'option', 'variant-select', 'add-to-cart', 'purchase', 'plan-list', 'plan', 'qty', 'line-attribute'];
  productOnly.forEach((name) => {
    qsa(root, sel(name)).forEach((el) => {
      if (inProduct(el)) return;
      if (name === 'line-attribute' && el.closest(sel('group'))) return;
      add('warn', `${attr(name)} outside any ${attr('product')}: it does nothing here.`, el);
    });
  });

  qsa(root, sel('group-add')).forEach((el) => {
    if (!el.closest(sel('group'))) add('warn', `${attr('group-add')} outside a ${attr('group')}.`, el);
  });

  ['option-list', 'plan-list', 'cart-lines', 'list'].forEach((name) => qsa(root, sel(name)).forEach((el) => {
    if (!el.firstElementChild && !hasTemplate(el)) {
      add('warn', `${attr(name)} without a template child: put one example element inside it.`, el);
    }
  }));

  qsa(root, listSel).forEach((el) => {
    if (!qsa(el, sel('list')).length) add('error', `List without a ${attr('list')} child: products have nowhere to render.`, el);
  });

  qsa(root, sel('show')).forEach((el) => {
    const k = get(el, 'show');
    if (!SHOW.has(k)) add('warn', `Unknown ${attr('show')}="${k}".${didYouMean(k, SHOW)}`, el);
  });

  qsa(root, sel('bind')).forEach((el) => {
    const k = get(el, 'bind') || '';
    if (!k || BIND.has(k) || /^image:\d+$/.test(k) || k.startsWith('metafield:')) return;
    add('warn', `Unknown ${attr('bind')}="${k}": it stays empty.${didYouMean(k, BIND)}`, el);
  });

  // Typos in attribute names (tether-bnd, tether-add-to-card) do nothing, silently.
  const prefix = `${cfg.prefix}-`;
  const seen = new Set();
  qsa(root, '*').forEach((el) => {
    for (const a of el.attributes) {
      if (!a.name.startsWith(prefix)) continue;
      const name = a.name.slice(prefix.length);
      if (ATTRS.has(name) || seen.has(name)) continue;
      seen.add(name);
      add('warn', `Unknown attribute ${a.name}: Tether ignores it.${didYouMean(name, ATTRS, prefix)}`, el);
    }
  });

  qsa(root, sel('bind')).forEach((el) => {
    const k = get(el, 'bind') || '';
    if (!k.startsWith('metafield:')) return;
    const ref = k.slice(10);
    const listed = (cfg.metafields || []).some((m) => (typeof m === 'string' ? m : `${m.namespace}.${m.key}`) === ref);
    if (!listed) add('error', `${attr('bind')}="${k}" but "${ref}" is not in config.metafields, so it stays empty.`, el);
  });

  if (qsa(root, sel('cart-open')).length && !qsa(root, sel('cart-drawer')).length) {
    add('warn', `${attr('cart-open')} exists but there is no ${attr('cart-drawer')} on this page.`);
  }
  if (qsa(root, sel('cart-drawer')).length > 1) add('warn', `More than one ${attr('cart-drawer')}.`);

  qsa(root, `[${attr('state')}="error"]`).forEach((el) => {
    if (el.matches(boundary())) add('error', `Scope failed to load (${get(el, 'error') || 'error'}).`, el);
  });

  return problems;
}

export async function diagnose({ root = document, silent = false, version, now = new Date() } = {}) {
  const report = {
    version,
    config: {
      domain: cfg.domain || '(missing)',
      token: mask(cfg.token),
      apiVersion: cfg.apiVersion,
      endpoint: cfg.domain ? endpoint() : null,
      country: cfg.country, language: cfg.language, locale: cfg.locale, markets: cfg.markets || null,
      prefix: cfg.prefix, productPath: cfg.productPath, metafields: cfg.metafields,
      autoMount: cfg.autoMount, observe: cfg.observe, onError: typeof cfg.onError === 'function',
    },
    apiVersion: apiVersionStatus(cfg.apiVersion, now),
    // The market in use (a visitor's choice included), plus what detection would pick.
    market: { country: cfg.country || null, language: cfg.language || null, locale: cfg.locale || null, detected: cfg.markets?.detect ? detectMarket(cfg.markets) : null },
    reachable: false,
    shop: null,
    latencyMs: null,
    products: [],
    sellingPlans: [],
    problems: [],
  };

  if (!isConfigured()) {
    report.problems.push({ level: 'error', message: 'TETHER_CONFIG needs domain and token.' });
  } else {
    const t0 = Date.now();
    try {
      const data = await gql('query TetherDiagnose { shop { name primaryDomain { url } paymentSettings { currencyCode } } }', {}, { context: false });
      report.reachable = true;
      report.shop = { name: data.shop?.name, url: data.shop?.primaryDomain?.url, currency: data.shop?.paymentSettings?.currencyCode };
    } catch (err) {
      report.problems.push({ level: 'error', message: `Storefront API not reachable: ${err.message || err.code || 'unknown error'}` });
    }
    report.latencyMs = Date.now() - t0;

    if (report.reachable) {
      const keys = [...new Set(qsa(root, sel('product')).map((el) => resolveProductKey(el).key).filter(Boolean))].slice(0, 20);
      const results = await Promise.allSettled(keys.map((k) => getProduct(k)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const p = r.value;
          const plans = allPlans(p);
          report.products.push({ key: keys[i], handle: p.handle, title: p.title, plans: plans.length, requiresSellingPlan: p.requiresSellingPlan });
          plans.forEach((pl) => report.sellingPlans.push({ product: p.handle, group: pl.group?.name, plan: pl.name, id: pl.id }));
          // Options a visitor can't choose on this page (they get the first available variant's value).
          qsa(root, sel('product')).filter((el) => resolveProductKey(el).key === keys[i] && el.querySelector(sel('add-to-cart'))).forEach((el) => {
            const shown = new Set(qsa(el, `${sel('option-list')},select${sel('option')}`).map((x) => get(x, 'option-list') || get(x, 'option')));
            if (!shown.size && qsa(el, `select${sel('variant-select')}`).length) return;
            const names = (p.options || []).map((o) => o.name);
            if (!cfg.language) {
              [...shown].filter((n) => n && !names.includes(n)).forEach((n) => {
                report.problems.push({ level: 'warn', message: `Product "${p.handle}" has no option "${n}" (its options: ${names.join(', ') || 'none'}).${didYouMean(n, names)}` });
              });
            }
            (p.options || []).filter((o) => o.optionValues.length > 1 && !shown.has(o.name)).forEach((o) => {
              report.problems.push({ level: 'warn', message: `Product "${p.handle}": option "${o.name}" (${o.optionValues.length} values) has no tether-option-list, so visitors can't choose it.` });
            });
          });
        } else {
          report.products.push({ key: keys[i], error: r.reason?.message });
          report.problems.push({ level: 'error', message: `Product "${keys[i]}": ${r.reason?.message || r.reason?.code || 'not loaded'}. Is it published to the Headless channel?` });
        }
      });
    }
  }

  if (!report.apiVersion.ok || (report.apiVersion.monthsLeft ?? 99) < 3) {
    report.problems.push({ level: report.apiVersion.ok ? 'warn' : 'error', message: `apiVersion ${cfg.apiVersion}: ${report.apiVersion.note}` });
  }
  if (typeof document !== 'undefined') report.problems.push(...checkMarkup(root));

  if (!silent) print(report);
  return report;
}

function print(r) {
  const c = console;
  const errors = r.problems.filter((p) => p.level === 'error').length;
  c.group?.(`[${cfg.prefix}] diagnose: ${errors ? `${errors} error(s)` : 'no errors'}, ${r.problems.length - errors} warning(s)`);
  c.log('version', r.version, '| API', r.apiVersion.version, `(${r.apiVersion.note})`);
  c.log('config', r.config);
  if (r.market) c.log('market', `in use: ${[r.market.country, r.market.language].filter(Boolean).join(' / ') || 'the store default'}`, r.market.detected ? `(detection picks ${JSON.stringify(r.market.detected)})` : '');
  c.log(r.reachable ? `Storefront API reachable: ${r.shop?.name} (${r.latencyMs} ms)` : 'Storefront API NOT reachable');
  if (r.products.length) (c.table || c.log)(r.products);
  if (r.sellingPlans.length) (c.table || c.log)(r.sellingPlans);
  else if (r.reachable) c.log('No selling plans on the products of this page.');
  r.problems.forEach((p) => (p.level === 'error' ? c.error : c.warn)(p.message, p.el || ''));
  c.groupEnd?.();
}
