/**
 * DOM helpers. Attribute names go through attr() so the prefix is configurable
 * (e.g. prefix: 'wfs' for markup that uses wfs-* attributes).
 */
import { cfg, warn } from './config.js';

export const attr = (name) => `${cfg.prefix}-${name}`;
export const sel = (name, value) =>
  value === undefined ? `[${attr(name)}]` : `[${attr(name)}="${value}"]`;
export const get = (el, name) => el.getAttribute(attr(name));
export const has = (el, name) => el.hasAttribute(attr(name));
export const dataKey = () => `data-${cfg.prefix}-key`;

/**
 * productPath '/product' -> /product/<handle>.
 * Templates: '/product?handle={handle}' (one static page for every product,
 * with tether-product="url:handle"), '/p/{id}' (numeric product id).
 */
export function productUrl(handle, id) {
  const path = cfg.productPath || '/product';
  if (!/\{(handle|id)\}/.test(path)) return `${path.replace(/\/$/, '')}/${handle}`;
  const numeric = id ? String(id).split('/').pop() : '';
  return path.replace(/\{handle\}/g, encodeURIComponent(handle || '')).replace(/\{id\}/g, encodeURIComponent(numeric));
}

export const qsa = (root, s) => (root ? [...root.querySelectorAll(s)] : []);

/** Elements in `root` whose nearest `scopeSelector` ancestor is `root` itself. */
export const scoped = (root, s, scopeSelector) =>
  qsa(root, s).filter((el) => el.closest(scopeSelector) === root);

export function emit(name, detail, target = document) {
  target.dispatchEvent(new CustomEvent(`${cfg.prefix}:${name}`, { detail, bubbles: true }));
}

/** 30 -> "30%" (en, nl) or "30 %" (de, fr), in the configured locale. */
export function formatPercent(n, locale = cfg.locale) {
  if (!n) return '';
  try { return new Intl.NumberFormat(locale || undefined, { style: 'percent', maximumFractionDigits: 0 }).format(n / 100); } catch { return `${n}%`; }
}

export function formatMoney(money) {
  if (!money) return '';
  if (typeof cfg.formatMoney === 'function') return cfg.formatMoney(money, cfg.locale);
  const amount = parseFloat(money.amount);
  if (Number.isNaN(amount)) return '';
  try {
    return new Intl.NumberFormat(cfg.locale || undefined, {
      style: 'currency', currency: money.currencyCode,
    }).format(amount);
  } catch {
    return `${money.currencyCode} ${amount.toFixed(2)}`;
  }
}

export function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(cfg.locale || undefined); } catch { return ''; }
}

/** Shopify CDN resize via max-width / max-height / crop attributes on the element. */
/**
 * Shopify CDN image at a size: imageUrl(url, { width: 800 }). Use the same width as the element's
 * max-width attribute, so the browser script keeps the image instead of loading it again.
 */
export function imageUrl(url, { width, height, crop } = {}) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (width) u.searchParams.set('width', String(width));
    if (height) u.searchParams.set('height', String(height));
    if (crop) u.searchParams.set('crop', crop);
    return u.toString();
  } catch { return url; }
}

export function cdnUrl(url, el) {
  if (!url || !el) return url;
  // max-width (Webflow's custom attribute), or valid HTML: tether-max-width / data-max-width.
  const g = (k) => el.getAttribute(k) ?? el.getAttribute(`${cfg.prefix}-${k}`) ?? el.getAttribute(`data-${k}`);
  return imageUrl(url, { width: g('max-width'), height: g('max-height'), crop: g('max-width') || g('max-height') ? g('crop') : null });
}

/** Same image, whatever size parameters: the server-rendered one is kept (no second download). */
export const sameImage = (a, b) => Boolean(a && b) && a.split('?')[0] === b.split('?')[0];

export function setImage(el, url, alt) {
  if (!url) return;
  const src = cdnUrl(url, el);
  if (el.tagName === 'IMG' && sameImage(el.getAttribute('src'), src)) {
    if (alt != null && !el.getAttribute('alt')) el.setAttribute('alt', alt);
    return;
  }
  if (el.tagName === 'IMG') {
    el.removeAttribute('srcset');
    el.removeAttribute('sizes');
    el.setAttribute('src', src);
    if (alt != null) el.setAttribute('alt', alt);
    if (!el.getAttribute('loading')) el.setAttribute('loading', 'lazy');
  } else {
    el.style.backgroundImage = `url("${src}")`;
  }
}

export function setText(el, v) {
  const text = v == null ? '' : String(v);
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = text;
  else el.textContent = text;
}

export const readText = (el) => (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.textContent);

/** setText that reports changes to cfg.onValueChange (for scramble/roll effects). */
export function setTextTracked(el, v) {
  const before = readText(el);
  setText(el, v);
  const after = readText(el);
  if (before !== after && el.dataset.tetherSeen && typeof cfg.onValueChange === 'function') {
    try { cfg.onValueChange(el, before); } catch { /* ignore */ }
  }
  el.dataset.tetherSeen = '1';
}

export function show(el, visible) {
  const k = 'tetherPrevDisplay';
  if (visible) {
    if (el.dataset.tetherShown !== undefined) return; // already visible, nothing to check
    el.dataset.tetherShown = '';
    el.removeAttribute('hidden');
    if (el.dataset[k] !== undefined) {
      el.style.display = el.dataset[k];
      delete el.dataset[k];
    } else if (el.style.display === 'none') {
      el.style.display = '';
    }
    // Hidden before the script ran (a class, an inline display:none, a hidden attribute): show it
    // as block or the value of tether-display.
    if (typeof getComputedStyle === 'function' && getComputedStyle(el).display === 'none') {
      el.style.display = el.getAttribute(`${cfg.prefix}-display`) || 'block';
    }
  } else {
    delete el.dataset.tetherShown;
    // Remember a real display value to restore, never 'none'.
    if (el.dataset[k] === undefined && el.style.display !== 'none') el.dataset[k] = el.style.display || '';
    el.style.display = 'none';
  }
}

export function setSelected(el, selected) {
  el.classList.toggle('is-selected', selected);
  el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) el.checked = selected;
  const input = el.querySelector?.('input[type="radio"],input[type="checkbox"]');
  if (input) input.checked = selected;
}

// ---------------------------------------------------------------------------
// Repeaters: the first child in Webflow is the template, the rest is removed.
// ---------------------------------------------------------------------------

const templates = new WeakMap();

/** True once a repeater's template has been captured (it may be empty after that). */
export const hasTemplate = (container) => Boolean(templates.get(container));

function template(container) {
  if (!templates.has(container)) {
    const tpl = container.firstElementChild?.cloneNode(true) ?? null;
    templates.set(container, tpl);
    container.innerHTML = '';
  }
  return templates.get(container);
}

/** Rebuilds the list on every render. Fine for images, tags, options. */
export function repeat(container, items, render) {
  const tpl = template(container);
  if (!tpl) { if (items.length) warn('repeater without a template child', container); return; }
  container.innerHTML = '';
  items.forEach((item, i) => {
    const node = tpl.cloneNode(true);
    render(node, item, i);
    container.appendChild(node);
  });
}

/**
 * Keyed repeater: keeps existing nodes, inserts new ones, removes old ones.
 * Used for cart lines, so values can animate and lines can slide in/out.
 */
export function repeatKeyed(container, items, keyOf, render, { onEnter, onLeave } = {}) {
  const tpl = template(container);
  if (!tpl) { warn('repeater without a template child', container); return; }

  const KEY = dataKey();
  const LEAVING = `data-${cfg.prefix}-leaving`;
  const live = () => [...container.children].filter((n) => n.hasAttribute(KEY) && !n.hasAttribute(LEAVING));

  const existing = new Map(live().map((n) => [n.getAttribute(KEY), n]));
  const wanted = [];
  const fresh = new Set();

  items.forEach((item, i) => {
    const k = String(keyOf(item, i));
    let node = existing.get(k);
    if (node) existing.delete(k);
    else {
      node = tpl.cloneNode(true);
      node.setAttribute(KEY, k);
      fresh.add(node);
    }
    render(node, item, i, fresh.has(node));
    wanted.push(node);
  });

  const staying = wanted.filter((n) => !fresh.has(n));
  const current = live().filter((n) => staying.includes(n));
  const orderOk = current.length === staying.length && current.every((n, i) => n === staying[i]);

  if (!orderOk) {
    existing.forEach((n) => n.remove());
    wanted.forEach((n) => container.appendChild(n));
    return;
  }

  wanted.forEach((node, i) => {
    if (!fresh.has(node)) return;
    const prev = wanted[i - 1];
    if (prev && prev.parentNode === container) prev.after(node);
    else container.prepend(node);
    if (onEnter) { try { onEnter(node); } catch { /* ignore */ } }
  });

  existing.forEach((node) => {
    node.setAttribute(LEAVING, '');
    node.removeAttribute(KEY);
    node.style.pointerEvents = 'none';
    node.inert = true;
    const done = () => node.remove();
    if (onLeave) { try { onLeave(node, done); } catch { done(); } } else done();
  });
}

// ---------------------------------------------------------------------------
// Layout notifications: async renders change page height after your
// page-transition hooks ran. Debounced, then cfg.onLayoutChange or a default.
// ---------------------------------------------------------------------------

let layoutTimer = null;

export function notifyLayoutChanged(reason) {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    if (typeof cfg.onLayoutChange === 'function') cfg.onLayoutChange(reason);
    else if (window.ScrollTrigger?.refresh) window.ScrollTrigger.refresh();
    emit('layout-changed', { reason });
  }, 120);
}

export function watchImages(root, reason) {
  const imgs = qsa(root, 'img').filter((i) => !i.complete);
  if (!imgs.length) return;
  let left = imgs.length;
  const done = () => { if (--left === 0) notifyLayoutChanged(`${reason}:images`); };
  imgs.forEach((img) => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
}

export function busy(el, fn) {
  if (el.getAttribute('aria-busy') === 'true') return Promise.resolve();
  el.setAttribute('aria-busy', 'true');
  return Promise.resolve().then(fn).finally(() => el.removeAttribute('aria-busy'));
}

export function parseJSONAttr(el, name) {
  const raw = el && get(el, name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { warn(`invalid JSON in ${attr(name)}`, el); return null; }
}

/** {a: 1} or [{key, value}] -> [{key, value}] as Shopify wants it. */
export function toAttributes(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.map((a) => ({ key: String(a.key), value: String(a.value ?? '') }));
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? '') }));
}
