// @ts-nocheck
/**
 * Customer account pages (optional part, loaded by the account part on pages that use them):
 * order detail with returns, profile, addresses, subscriptions. The operations and their input
 * checks are shared with the Worker (server/src/account-ops.js), so both modes do the same.
 */
import { cfg, reportError } from './config.js';
import { TetherError } from './client.js';
import { attr, sel, get, qsa, setText, setImage, repeat, show, formatMoney, emit } from './dom.js';
import { ops, InputError } from '../server/src/account-ops.js';

let ctx = null; // the account part's server(), serverFetch(), query(), customer(), reset()
let bound = false;
export function setup(c) {
  ctx = c;
}

const https = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};
const date = (s) => {
  try {
    return new Date(s).toLocaleDateString(cfg.locale || undefined);
  } catch {
    return s;
  }
};
// ---------------------------------------------------------------- order detail, profile, addresses, subscriptions, returns

// The same fixed operations in both modes: the Worker's routes in server mode, the Customer
// Account API directly (with the same documents and input checks) in browser mode.
const ROUTE = {
  order: (i) => ['GET', `/order?id=${encodeURIComponent(i.id)}`],
  addresses: () => ['GET', '/addresses'],
  subscriptions: () => ['GET', '/subscriptions'],
  profile: () => ['POST', '/profile'],
  saveAddress: () => ['POST', '/address'],
  deleteAddress: () => ['POST', '/address/delete'],
  subscription: () => ['POST', '/subscription'],
  requestReturn: () => ['POST', '/return'],
};
async function run(name, input = {}) {
  const { server, serverFetch, query } = ctx;
  if (server()) {
    const [method, path] = ROUTE[name](input);
    const data = await serverFetch(path, method === 'POST' ? { method, body: input } : {});
    if (data.loggedIn === false) throw new TetherError('Not logged in', { code: 'NOT_LOGGED_IN', status: 401 });
    return data;
  }
  try {
    return await ops[name]((q, v) => query(q, v), input);
  } catch (err) {
    if (err instanceof InputError) throw new TetherError(err.message, { code: 'INVALID', userErrors: err.userErrors });
    throw err;
  }
}
const changed = (what) => {
  ctx.reset();
  emit('account-updated', { what });
};

/** One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns). */
export const order = (id) => run('order', { id }).then((r) => r.order);
export const updateProfile = ({ firstName, lastName } = {}) =>
  run('profile', { firstName, lastName }).then((r) => {
    changed('profile');
    return r.customer;
  });
export const addresses = () => run('addresses').then((r) => r.addresses);
/** saveAddress({ address1, city, zip, countryCode, … }, { id, isDefault }): creates, or updates with an id. */
export const saveAddress = (address, { id, isDefault } = {}) =>
  run('saveAddress', { id, address, isDefault }).then((r) => {
    changed('addresses');
    return r.address;
  });
export const deleteAddress = (id) =>
  run('deleteAddress', { id }).then((r) => {
    changed('addresses');
    return r.deleted;
  });
export const subscriptions = () => run('subscriptions').then((r) => r.subscriptions);
/** subscriptionAction(id, 'pause' | 'resume' | 'skip' | 'unskip' | 'cancel') */
export const subscriptionAction = (id, action) =>
  run('subscription', { id, action }).then((r) => {
    changed('subscriptions');
    return r;
  });
/** requestReturn(orderId, [{ lineItemId, quantity, reasonId, note }]) */
export const requestReturn = (orderId, lines) =>
  run('requestReturn', { orderId, lines }).then((r) => {
    changed('orders');
    return r.return;
  });

const nid = (g) =>
  String(g || '')
    .split('/')
    .pop()
    .split('?')[0];
/** The order's page: your own (account.orderUrl: '/account/order?id={id}') or Shopify's status page. */
function orderUrl(o) {
  const t = cfg.account?.orderUrl;
  if (t) return String(t).replace('{id}', encodeURIComponent(nid(o.id)));
  return https(o.statusPageUrl) ? o.statusPageUrl : null;
}
const lower = (v) => (v ? String(v).toLowerCase().replace(/_/g, ' ') : '');
const lines = (a) => (a?.formatted || []).join(', ');
const showIn = (root, name, conds) =>
  qsa(root, sel(name)).forEach((el) => {
    const k = get(el, name);
    if (k in conds) show(el, Boolean(conds[k]));
  });
const showGlobal = (root, conds) => showIn(root, 'show', conds);

function fillLines(box, items, returnable = null) {
  repeat(box, items, (row, l) => {
    const can = returnable ? returnable.get(l.id) || 0 : 0;
    row.dataset.tetherLine = l.id;
    qsa(row, sel('order-line'))
      .concat(row.matches(sel('order-line')) ? [row] : [])
      .forEach((el) => {
        const k = get(el, 'order-line');
        if (k === 'image') {
          if (l.image) setImage(el, l.image.url, l.image.altText || l.title);
          return;
        }
        const v = {
          title: l.title || l.name,
          'variant-title': l.variantTitle || '',
          quantity: String(l.quantity),
          price: l.price ? formatMoney(l.price) : '',
          total: l.totalPrice ? formatMoney(l.totalPrice) : '',
          sku: l.sku || '',
          returnable: String(can),
        }[k];
        if (v != null) setText(el, v);
      });
    showIn(row, 'order-line-show', { returnable: can > 0 });
    qsa(row, sel('return-quantity')).forEach((input) => {
      input.max = String(can);
      input.min = '0';
      if (!input.value) input.value = '0';
      input.disabled = can < 1;
    });
    qsa(row, `select${sel('return-reason')}`).forEach((select) => {
      const reasons = l.suggestedReturnReasonDefinitions?.nodes || [];
      if (select.dataset.tetherFilled !== l.id) {
        select.dataset.tetherFilled = l.id;
        reasons.forEach((r) => select.appendChild(new Option(r.name, r.id)));
      }
    });
  });
}

const SCOPE = { order: sel('order') };
async function renderOrder(el) {
  const raw = get(el, 'order') || '';
  const key = raw.startsWith('url:') ? new URL(window.location.href).searchParams.get(raw.slice(4) || 'id') : raw;
  const state = (s) => el.setAttribute(attr('order-state'), s);
  if (!key) {
    state('not-found');
    showIn(el, 'order-show', { 'not-found': true });
    return;
  }
  state('loading');
  showIn(el, 'order-show', { loading: true, ready: false, 'not-found': false, error: false });
  let o;
  try {
    o = await order(key);
  } catch (err) {
    reportError(err, 'order');
    state('error');
    showIn(el, 'order-show', { loading: false, error: true });
    return;
  }
  if (!o) {
    state('not-found');
    showIn(el, 'order-show', { loading: false, 'not-found': true });
    return;
  }
  el.dataset.tetherOrderId = o.id;
  const returnable = new Map(
    (o.returnInformation?.returnableLineItems?.nodes || []).map((r) => [r.lineItem?.id, r.quantity]),
  );
  const ships = o.fulfillments?.nodes || [];
  qsa(el, sel('order-bind')).forEach((b) => {
    const k = get(b, 'order-bind');
    if (k === 'url') {
      if (https(o.statusPageUrl)) b.setAttribute('href', o.statusPageUrl);
      return;
    }
    const v = {
      name: o.name,
      date: date(o.processedAt),
      total: formatMoney(o.totalPrice),
      subtotal: o.subtotal ? formatMoney(o.subtotal) : '',
      shipping: o.totalShipping ? formatMoney(o.totalShipping) : '',
      tax: o.totalTax ? formatMoney(o.totalTax) : '',
      status: lower(o.financialStatus),
      fulfillment: lower(o.fulfillmentStatus),
      'shipping-address': lines(o.shippingAddress),
      'billing-address': lines(o.billingAddress),
      items: (o.lineItems?.nodes || []).map((l) => `${l.quantity}× ${l.title || l.name}`).join(', '),
      cancelled: o.cancelledAt ? date(o.cancelledAt) : '',
    }[k];
    if (v != null) setText(b, v);
  });
  qsa(el, sel('order-lines')).forEach((box) => fillLines(box, o.lineItems?.nodes || [], returnable));
  qsa(el, sel('order-fulfillments')).forEach((box) =>
    repeat(box, ships, (row, f) => {
      const t = f.trackingInformation?.[0] || {};
      qsa(row, sel('fulfillment-bind'))
        .concat(row.matches(sel('fulfillment-bind')) ? [row] : [])
        .forEach((b) => {
          const k = get(b, 'fulfillment-bind');
          if (k === 'url') {
            const ok = https(t.url);
            if (ok) b.setAttribute('href', t.url);
            show(b, ok);
            return;
          } // no tracking link: hidden
          const v = {
            status: lower(f.latestShipmentStatus || f.status),
            date: date(f.createdAt),
            eta: f.estimatedDeliveryAt ? date(f.estimatedDeliveryAt) : '',
            company: t.company || '',
            number: t.number || '',
          }[k];
          if (v != null) setText(b, v);
        });
    }),
  );
  showIn(el, 'order-show', {
    loading: false,
    ready: true,
    error: false,
    'not-found': false,
    cancelled: Boolean(o.cancelledAt),
    shipped: ships.length > 0,
    returnable: [...returnable.values()].some((q) => q > 0),
    'has-returns': el.dataset.tetherReturned !== '1' && (o.returns?.nodes || []).length > 0,
    'return-requested': el.dataset.tetherReturned === '1',
  });
  state('ready');
}

async function renderProfile(form) {
  const c = await ctx.customer().catch(() => null);
  if (!c) return;
  ['firstName', 'lastName'].forEach((n) => {
    const i = form.elements?.[n];
    if (i && !i.dataset.tetherTouched) i.value = c[n] || '';
  });
}

let addressCache = null;
async function renderAddresses(root) {
  const boxes = qsa(root, sel('addresses'));
  if (!boxes.length) return;
  showGlobal(root, { 'addresses-loading': true, 'addresses-empty': false });
  let list;
  try {
    list = addressCache = await addresses();
  } catch (err) {
    reportError(err, 'addresses'); // not "no addresses yet": keep what's shown
    showGlobal(root, { 'addresses-loading': false, 'addresses-error': true });
    return;
  }
  showGlobal(root, { 'addresses-loading': false, 'addresses-empty': list.length === 0, 'addresses-error': false });
  boxes.forEach((box) =>
    repeat(box, list, (row, a) => {
      row.dataset.tetherAddress = a.id;
      qsa(row, sel('address-bind'))
        .concat(row.matches(sel('address-bind')) ? [row] : [])
        .forEach((b) => {
          const v = {
            formatted: lines(a),
            name: [a.firstName, a.lastName].filter(Boolean).join(' '),
            company: a.company || '',
            address1: a.address1 || '',
            address2: a.address2 || '',
            city: a.city || '',
            zip: a.zip || '',
            province: a.province || '',
            country: a.country || '',
            phone: a.phoneNumber || '',
          }[get(b, 'address-bind')];
          if (v != null) setText(b, v);
        });
      showIn(row, 'address-show', { default: a.isDefault, 'not-default': !a.isDefault });
    }),
  );
}

const SUB_ACTIONS = ['pause', 'resume', 'skip', 'unskip', 'cancel'];
function subConds(c) {
  const next = c.upcomingBillingCycles?.nodes?.[0];
  const st = c.status;
  return {
    active: st === 'ACTIVE',
    paused: st === 'PAUSED',
    cancelled: st === 'CANCELLED',
    expired: st === 'EXPIRED',
    failed: st === 'FAILED',
    skipped: Boolean(next?.skipped),
    'can-pause': st === 'ACTIVE',
    'can-resume': st === 'PAUSED' || st === 'FAILED',
    'can-skip': st === 'ACTIVE' && Boolean(next) && !next.skipped,
    'can-unskip': st === 'ACTIVE' && Boolean(next?.skipped),
    'can-cancel': st === 'ACTIVE' || st === 'PAUSED' || st === 'FAILED',
  };
}
async function renderSubscriptions(root) {
  const boxes = qsa(root, sel('subscriptions'));
  if (!boxes.length) return;
  showGlobal(root, { 'subscriptions-loading': true, 'subscriptions-empty': false });
  let list;
  try {
    list = await subscriptions();
  } catch (err) {
    reportError(err, 'subscriptions');
    showGlobal(root, { 'subscriptions-loading': false, 'subscriptions-error': true });
    return;
  }
  showGlobal(root, {
    'subscriptions-loading': false,
    'subscriptions-empty': list.length === 0,
    'subscriptions-error': false,
  });
  boxes.forEach((box) =>
    repeat(box, list, (row, c) => {
      row.dataset.tetherSubscription = c.id;
      row.setAttribute(attr('subscription-status'), lower(c.status));
      const ls = c.lines?.nodes || [];
      const n = c.deliveryPolicy?.intervalCount?.count || 1;
      const unit = lower(c.deliveryPolicy?.interval);
      const total = ls.reduce((sum, l) => sum + parseFloat(l.lineDiscountedPrice?.amount || 0), 0);
      qsa(row, sel('subscription-bind')).forEach((b) => {
        const k = get(b, 'subscription-bind');
        const v = {
          status: lower(c.status),
          next: c.nextBillingDate ? date(c.nextBillingDate) : '',
          interval: unit ? (n === 1 ? unit : `${n} ${unit}s`) : '',
          products: ls.map((l) => `${l.quantity}× ${l.title}`).join(', '),
          total: ls.length ? formatMoney({ amount: String(total), currencyCode: c.currencyCode }) : '',
          delivery: c.deliveryPrice ? formatMoney(c.deliveryPrice) : '',
        }[k];
        if (v != null) setText(b, v);
      });
      qsa(row, sel('subscription-lines')).forEach((lb) =>
        repeat(lb, ls, (lr, l) => {
          qsa(lr, sel('subscription-line'))
            .concat(lr.matches(sel('subscription-line')) ? [lr] : [])
            .forEach((b) => {
              const k = get(b, 'subscription-line');
              if (k === 'image') {
                if (l.image) setImage(b, l.image.url, l.image.altText || l.title);
                return;
              }
              const v = {
                title: l.title,
                'variant-title': l.variantTitle || '',
                quantity: String(l.quantity),
                price: formatMoney(l.currentPrice),
              }[k];
              if (v != null) setText(b, v);
            });
        }),
      );
      const conds = subConds(c);
      showIn(row, 'subscription-show', conds);
      qsa(row, sel('subscription-action')).forEach((btn) => {
        const a = get(btn, 'subscription-action');
        const ok = conds[`can-${a}`];
        btn.disabled = !ok;
        btn.classList.toggle('is-disabled', !ok);
      });
    }),
  );
}

/** Order page, profile form, addresses, subscriptions: only what the page has. */
export async function renderPages(root = document) {
  if (!bound) {
    bound = true;
    bindPages();
  }
  await Promise.all([
    ...qsa(root, sel('order')).map((el) => renderOrder(el)),
    ...qsa(root, sel('profile-form')).map((f) => renderProfile(f)),
    renderAddresses(root),
    renderSubscriptions(root),
  ]);
}

const fieldsOf = (form) =>
  Object.fromEntries(
    [...form.elements]
      .filter((i) => i.name && i.type !== 'submit' && i.type !== 'button' && i.type !== 'checkbox')
      .map((i) => [i.name, i.value]),
  );
async function act(el, fn, { error } = {}) {
  if (el.getAttribute('aria-busy') === 'true') return undefined; // already sending: no second request (Enter, double click)
  el.classList.add('is-busy');
  el.setAttribute('aria-busy', 'true');
  el.setAttribute(attr('form-state'), 'pending');
  qsa(el, sel('form-error')).forEach((e) => setText(e, ''));
  try {
    const out = await fn();
    el.setAttribute(attr('form-state'), 'saved');
    return out;
  } catch (err) {
    el.setAttribute(attr('form-state'), 'error');
    const msg = err?.userErrors?.map((u) => u.message).join(' ') || err?.message || 'Something went wrong';
    qsa(el, sel('form-error')).forEach((e) => setText(e, msg.replace(/^Customer accounts: /, '')));
    if (error) reportError(err, error);
    return undefined;
  } finally {
    el.classList.remove('is-busy');
    el.removeAttribute('aria-busy');
  }
}

function bindPages() {
  document.addEventListener(
    'submit',
    (e) => {
      const f = e.target;
      if (f.matches?.(sel('profile-form'))) {
        e.preventDefault();
        act(f, async () => {
          await updateProfile(fieldsOf(f));
          await ctx.bindCustomer?.(document);
        });
      } else if (f.matches?.(sel('address-form'))) {
        e.preventDefault();
        const id = f.dataset.tetherAddressId || undefined;
        const isDefault = Boolean(f.elements?.isDefault?.checked);
        act(f, async () => {
          await saveAddress(fieldsOf(f), { id, isDefault });
          f.reset();
          delete f.dataset.tetherAddressId;
          await renderAddresses(document);
        });
      }
    },
    true,
  ); // capture: before a router (Astro's ClientRouter) turns the submit into a navigation with the fields in the URL
  document.addEventListener('input', (e) => {
    if (e.target.closest?.(sel('profile-form'))) e.target.dataset.tetherTouched = '1';
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    const row = t.closest?.('[data-tether-address]');
    const confirmOk = (btn) => {
      const q = get(btn, 'confirm');
      return !q || window.confirm(q);
    };
    let btn;
    if ((btn = t.closest?.(sel('address-delete'))) && row) {
      e.preventDefault();
      if (confirmOk(btn))
        act(row, async () => {
          await deleteAddress(row.dataset.tetherAddress);
          await renderAddresses(document);
        });
    } else if ((btn = t.closest?.(sel('address-default'))) && row) {
      e.preventDefault();
      act(row, async () => {
        await saveAddress(null, { id: row.dataset.tetherAddress, isDefault: true });
        await renderAddresses(document);
      });
    } else if ((btn = t.closest?.(sel('address-edit'))) && row) {
      e.preventDefault();
      const a = (addressCache || []).find((x) => x.id === row.dataset.tetherAddress);
      const f = document.querySelector(sel('address-form'));
      if (a && f) {
        f.dataset.tetherAddressId = a.id;
        [...f.elements].forEach((i) => {
          if (i.name && i.name in a) i.value = a[i.name] ?? '';
          if (i.name === 'isDefault') i.checked = a.isDefault;
        });
        f.scrollIntoView?.({ block: 'nearest' });
      }
    } else if ((btn = t.closest?.(sel('address-new')))) {
      const f = document.querySelector(sel('address-form'));
      if (f) {
        f.reset();
        delete f.dataset.tetherAddressId;
      }
    } else if ((btn = t.closest?.(sel('subscription-action')))) {
      e.preventDefault();
      const sub = btn.closest('[data-tether-subscription]');
      const a = get(btn, 'subscription-action');
      if (!sub || !SUB_ACTIONS.includes(a) || btn.disabled || !confirmOk(btn)) return;
      const id = sub.dataset.tetherSubscription;
      sub.setAttribute(attr('subscription-state'), 'pending');
      act(sub, async () => {
        await subscriptionAction(id, a);
        await renderSubscriptions(document);
      }).then(() => {
        const state = sub.getAttribute(attr('form-state')) === 'error' ? 'error' : 'done';
        // The re-render may have replaced the row: mark the one that shows this subscription now.
        qsa(document, '[data-tether-subscription]')
          .filter((r) => r === sub || r.dataset.tetherSubscription === id)
          .forEach((r) => r.setAttribute(attr('subscription-state'), state));
      });
    } else if ((btn = t.closest?.(sel('order-return')))) {
      e.preventDefault();
      const scope = btn.closest(SCOPE.order);
      if (!scope?.dataset.tetherOrderId) return;
      const req = qsa(scope, '[data-tether-line]')
        .map((r) => ({
          lineItemId: r.dataset.tetherLine,
          quantity: parseInt(r.querySelector(sel('return-quantity'))?.value || '0', 10),
          reasonId: r.querySelector(sel('return-reason'))?.value || undefined,
          note: r.querySelector(sel('return-note'))?.value || undefined,
        }))
        .filter((l) => l.quantity > 0);
      if (!req.length || !confirmOk(btn)) return;
      act(scope, async () => {
        await requestReturn(scope.dataset.tetherOrderId, req);
        scope.dataset.tetherReturned = '1';
        await renderOrder(scope);
      });
    }
  });
}
