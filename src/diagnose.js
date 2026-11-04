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

/** Shopify supports each quarterly API version for 12 months. */
export function apiVersionStatus(version, now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(version || ''));
  if (!m) return { version, ok: version === 'unstable', note: 'not a dated version' };
  const released = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  const supportedUntil = new Date(Date.UTC(+m[1] + 1, +m[2] - 1, 1));
  const monthsLeft = (supportedUntil - now) / (30.44 * 24 * 3600 * 1000);
  let note = `supported until about ${supportedUntil.toISOString().slice(0, 7)}`;
  if (released > now) note = 'not released yet';
  else if (monthsLeft <= 0) note = 'no longer supported: Shopify falls back to the oldest supported version. Upgrade (see README)';
  else if (monthsLeft < 3) note = `${note}: plan the upgrade (see README)`;
  return { version, ok: released <= now && monthsLeft > 0, monthsLeft: Math.round(monthsLeft), note };
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

  [...qsa(root, sel('option-list')), ...qsa(root, sel('plan-list')), ...qsa(root, sel('cart-lines')), ...qsa(root, sel('list'))]
    .forEach((el) => {
      if (!el.firstElementChild && !hasTemplate(el)) {
        add('warn', 'Repeater without a template child: put one example element inside it.', el);
      }
    });

  qsa(root, listSel).forEach((el) => {
    if (!qsa(el, sel('list')).length) add('error', `List without a ${attr('list')} child: products have nowhere to render.`, el);
  });

  const known = new Set([
    'in-stock', 'out-of-stock', 'backorder', 'low-stock', 'on-sale', 'not-on-sale', 'has-variants', 'single-variant',
    'subscription-available', 'subscription-unavailable', 'subscription-only', 'one-time-available',
    'subscription-selected', 'one-time-selected', 'has-savings', 'loading', 'ready', 'error', 'not-found',
    'cart-empty', 'cart-filled', 'cart-has-subscription', 'cart-no-subscription', 'cart-has-discount', 'cart-error',
    'list-empty', 'list-filled',
  ]);
  qsa(root, sel('show')).forEach((el) => {
    const k = get(el, 'show');
    if (!known.has(k)) add('warn', `Unknown ${attr('show')}="${k}".`, el);
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
      country: cfg.country, language: cfg.language, locale: cfg.locale,
      prefix: cfg.prefix, productPath: cfg.productPath, metafields: cfg.metafields,
      autoMount: cfg.autoMount, observe: cfg.observe, onError: typeof cfg.onError === 'function',
    },
    apiVersion: apiVersionStatus(cfg.apiVersion, now),
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
      const hint = err.status === 401 || err.status === 403
        ? 'Token rejected: use the public Storefront token from the Headless channel, not an Admin token.'
        : err.status === 404 ? 'Store or API version not found: check domain (x.myshopify.com) and apiVersion.' : '';
      report.problems.push({ level: 'error', message: `Storefront API not reachable: ${err.message}${hint ? `. ${hint}` : ''}` });
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
        } else {
          report.products.push({ key: keys[i], error: r.reason?.message });
          report.problems.push({ level: 'error', message: `Product "${keys[i]}": ${r.reason?.message}. Is it published to the Headless channel?` });
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
  c.log(r.reachable ? `Storefront API reachable: ${r.shop?.name} (${r.latencyMs} ms)` : 'Storefront API NOT reachable');
  if (r.products.length) (c.table || c.log)(r.products);
  if (r.sellingPlans.length) (c.table || c.log)(r.sellingPlans);
  else if (r.reachable) c.log('No selling plans on the products of this page.');
  r.problems.forEach((p) => (p.level === 'error' ? c.error : c.warn)(p.message, p.el || ''));
  c.groupEnd?.();
}
