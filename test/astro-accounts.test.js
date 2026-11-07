// Analytics, and customer accounts through the Worker: login, orders, the account pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, cfg, firstVariantId, rendered, seedCart } from './astro-harness.js';
import { cartFrom, find, jsonResponse, product } from './fixtures.js';
import { asRecord, parseJson, urlOf, waitFor } from '../server/test/mocks.js';

test("analytics: Tether's own events become GA4 dataLayer events (view_item, add_to_cart from cart changes, begin_checkout); look-alikes send nothing", async () => {
  /**
   * What the analytics part pushes for GA4.
   *
   * @type {{ event?: string, ecommerce?: { items: { quantity: number }[], value: unknown } | null }[]}
   */
  const dataLayer = [];
  Object.assign(window, { dataLayer });
  const analytics = await import('../src/analytics.ts');
  const prev = cfg.analytics;
  cfg.analytics = { dataLayer: true };
  /** @type {Event[]} */
  const queue = [];
  await analytics.startAnalytics(queue, new WeakMap(), document.body);
  Tether.clearProductCache();
  Tether.primeProduct(product);
  document.body.innerHTML = '<div tether-product="coffee-box"></div>';
  Tether.mount(document);
  await rendered();
  const root = find('[tether-product]');
  const { ownEvent } = await import('../src/dom.ts');
  // Look-alike events from another script, whatever their detail, send nothing and don't throw.
  queue.push(new window.CustomEvent('tether:cart-updated', { detail: null }));
  queue.push(new window.CustomEvent('tether:checkout', { detail: { cart: cartFrom([]) } }));
  const scope = Tether.getScope(root);
  assert.ok(scope);
  queue.push(ownEvent('product-ready', { product, scope }));
  /** @param {number} quantity */
  const line = (quantity) => cartFrom([{ merchandiseId: firstVariantId, quantity }]);
  queue.push(ownEvent('cart-updated', { cart: line(1), reason: 'load' }));
  queue.push(ownEvent('cart-updated', { cart: line(3), reason: 'add' }));
  queue.push(ownEvent('checkout', { cart: line(3), url: 'https://shop.test/checkout/abc' }));
  const events = dataLayer.filter((entry) => entry.event).map((entry) => entry.event);
  assert.deepEqual(events, ['view_item', 'add_to_cart', 'begin_checkout']);
  const add = dataLayer.find((entry) => entry.event === 'add_to_cart');
  assert.equal(add?.ecommerce?.items[0]?.quantity, 2, 'the difference');
  assert.equal(typeof add.ecommerce.value, 'number');
  assert.ok(
    dataLayer.some((entry) => entry.ecommerce === null),
    'cleared before each push',
  );
  cfg.analytics = prev;
});

const TEE_ORDER = {
  id: 'o1',
  name: '#1001',
  processedAt: '2026-11-01',
  statusPageUrl: 'https://x/o1',
  totalPrice: { amount: '10', currencyCode: 'EUR' },
  lineItems: {
    nodes: [
      {
        title: 'Tee',
        variantTitle: 'M',
        quantity: 2,
        image: { url: 'https://cdn.shopify.com/tee.jpg', altText: null },
      },
    ],
  },
};

test('customer accounts: no token in the browser, the Worker does the work', async () => {
  const account = await import('../src/account.ts');
  /** @type {string[]} */
  const nav = [];
  cfg.account = { server: '/_tether/account', navigate: (url) => nav.push(url) }; // a path on this site works too
  const realFetch = globalThis.fetch;
  let noOrders = false;
  globalThis.fetch = async (url, init = {}) => {
    const target = urlOf(url);
    if (target.startsWith('https://astro.test/_tether/account')) {
      assert.equal(init.credentials, 'include');
      /** @param {unknown} data */
      const json = (data) => jsonResponse(data);
      if (target.endsWith('/me')) return json({ loggedIn: true, customer: { firstName: 'Ada', email: 'ada@x.test' } });
      if (target.includes('/orders')) return json({ orders: noOrders ? [] : [TEE_ORDER] });
      if (target.endsWith('/cart')) {
        assert.equal(new Headers(init.headers).get('X-Tether-Account'), '1');
        return json({ linked: true, checkoutUrl: 'https://shop.test/checkouts/c/1' });
      }
      if (target.endsWith('/logout')) return json({ logoutUrl: 'https://shopify.com/logout?x' });
    }
    return realFetch(url, init);
  };
  try {
    await seedCart(cartFrom([{ merchandiseId: firstVariantId, quantity: 1 }]));
    await account.login();
    const loginUrl = nav.pop();
    assert.ok(loginUrl);
    const to = new URL(loginUrl);
    assert.equal(to.pathname, '/_tether/account/login');
    assert.equal(to.searchParams.get('cart'), null, 'no cart on the login link (linked through POST /cart)');
    window.history.replaceState(null, '', '/account?account=in');
    document.body.innerHTML = `<span id="n" tether-account-bind="first-name"></span>
      <ul tether-orders><li><span tether-order-bind="name"></span><img id="oi" tether-order-bind="image">
        <div tether-order-lines><p><span tether-order-line="quantity"></span>x <span tether-order-line="title"></span> <span tether-order-line="variant-title"></span></p></div></li></ul>
      <p id="ol" tether-show="orders-loading"></p><p id="oe" tether-show="orders-empty"></p>`;
    await account.mountAccount(document);
    /** @param {string} id */
    const visible = (id) => window.getComputedStyle(find(`#${id}`)).display !== 'none';
    assert.match(find('#oi').getAttribute('src') ?? '', /tee\.jpg/);
    assert.equal(find('[tether-order-lines] p').textContent.replace(/\s+/g, ' ').trim(), '2x Tee M');
    assert.ok(!visible('ol') && !visible('oe'));
    assert.equal(find('[tether-order-bind="name"]').textContent, '#1001');
    noOrders = true;
    await account.render(document);
    assert.ok(visible('oe'), 'no orders yet');
    noOrders = false;
    assert.equal(window.location.search, '', '?account=in removed');
    assert.equal(find('#n').textContent, 'Ada');
    const url = await Tether.cart.checkout('_self');
    assert.equal(url, 'https://shop.test/checkouts/c/1?logged_in=true', "the Worker's checkout, logged in");
    const stored =
      JSON.stringify(Object.entries(window.localStorage)) + JSON.stringify(Object.entries(window.sessionStorage));
    assert.ok(
      !/access|refresh|token/i.test(stored.replace(/account-hint/g, '')),
      'nothing secret stored in the browser',
    );
    await account.logout();
    assert.match(nav.pop() ?? '', /shopify\.com\/logout/);
  } finally {
    globalThis.fetch = realFetch;
    cfg.account = null;
    Tether.cart.setCheckoutResolver(null);
    window.history.replaceState(null, '', '/');
  }
});

/** @param {string} amount */
const money = (amount) => ({ amount, currencyCode: 'EUR' });

const ORDER_7 = {
  id: 'gid://shopify/Order/7',
  name: '#1007',
  processedAt: '2026-11-01',
  totalPrice: money('10'),
  subtotal: money('8'),
  totalShipping: money('2'),
  financialStatus: 'PAID',
  fulfillmentStatus: 'FULFILLED',
  shippingAddress: { formatted: ['Street 1', 'Utrecht'] },
  lineItems: {
    nodes: [
      {
        id: 'gid://shopify/LineItem/1',
        title: 'Tee',
        quantity: 2,
        price: money('4'),
        suggestedReturnReasonDefinitions: {
          nodes: [{ id: 'gid://shopify/ReturnReasonDefinition/1', name: 'Too big' }],
        },
      },
    ],
  },
  fulfillments: {
    nodes: [
      {
        status: 'SUCCESS',
        createdAt: '2026-11-02',
        trackingInformation: [{ company: 'PostNL', number: '3S123', url: 'https://track.example/3S123' }],
      },
    ],
  },
  returnInformation: {
    returnableLineItems: { nodes: [{ quantity: 2, lineItem: { id: 'gid://shopify/LineItem/1' } }] },
  },
  returns: { nodes: [] },
};

/** @param {string} status */
const socksSubscription = (status) => ({
  id: 'gid://shopify/SubscriptionContract/5',
  status,
  nextBillingDate: '2026-12-01',
  currencyCode: 'EUR',
  deliveryPolicy: { interval: 'MONTH', intervalCount: { count: 1 } },
  lines: {
    nodes: [{ title: 'Socks', quantity: 1, currentPrice: money('9'), lineDiscountedPrice: money('9') }],
  },
  upcomingBillingCycles: { nodes: [{ cycleIndex: 2, skipped: false }] },
});

/**
 * The Worker's account routes behind the account pages, recording what the page posts.
 *
 * @param {typeof globalThis.fetch} realFetch Answers everything outside the account routes.
 * @param {Record<string, () => Response | Promise<Response>>} overrides A test's own answers, by route.
 */
function accountPagesWorker(realFetch, overrides) {
  /** @type {{ path: string, body: unknown }[]} */
  const posts = [];
  let status = 'ACTIVE';
  /** @type {Record<string, () => Response | Promise<Response>>} */
  const answers = {
    '/me': () => jsonResponse({ loggedIn: true, customer: { firstName: 'Ada', lastName: 'L', email: 'ada@x.test' } }),
    '/orders': () =>
      jsonResponse({
        orders: [{ id: 'gid://shopify/Order/7', name: '#1007', totalPrice: money('10'), lineItems: { nodes: [] } }],
      }),
    '/order': () => jsonResponse({ ok: true, order: ORDER_7 }),
    '/subscriptions': () => jsonResponse({ ok: true, subscriptions: [socksSubscription(status)] }),
    '/subscription': () => {
      status = 'PAUSED';
      return jsonResponse({ ok: true, contract: { status } });
    },
    '/addresses': () =>
      jsonResponse({
        ok: true,
        addresses: [
          {
            id: 'gid://shopify/CustomerAddress/1',
            city: 'Utrecht',
            formatted: ['Street 1', 'Utrecht'],
            isDefault: true,
          },
        ],
      }),
    '/address': () => jsonResponse({ error: 'City is required', userErrors: [{ message: 'City is required' }] }, 400),
    '/return': () => jsonResponse({ ok: true, return: { id: 'gid://shopify/Return/1', status: 'REQUESTED' } }),
    '/profile': () => jsonResponse({ ok: true, customer: { firstName: 'Ada' } }),
    ...overrides,
  };
  /** @type {typeof globalThis.fetch} */
  const fetch = async (url, init = {}) => {
    const target = new URL(urlOf(url), 'https://astro.test');
    if (!target.pathname.startsWith('/_tether/account')) return realFetch(url, init);
    const path = target.pathname.slice('/_tether/account'.length);
    if (init.method === 'POST') {
      assert.equal(new Headers(init.headers).get('X-Tether-Account'), '1');
      assert.ok(typeof init.body === 'string', 'a JSON body');
      posts.push({ path, body: parseJson(init.body) });
    }
    const answer = answers[path];
    return answer ? answer() : jsonResponse({});
  };
  return { fetch, posts };
}

const ACCOUNT_PAGES = `
  <a id="subs" tether-account-link="subscriptions" href="#">Manage</a>
  <ul tether-orders><li><a tether-order-bind="url"><span tether-order-bind="name"></span></a></li></ul>
  <section tether-order="url:id">
    <p tether-order-show="loading">Loading</p>
    <h1 tether-order-bind="name"></h1><span id="ship" tether-order-bind="shipping-address"></span><span id="tot" tether-order-bind="total"></span>
    <div tether-order-lines><div><span tether-order-line="title"></span><span tether-order-line="price"></span>
      <input tether-return-quantity type="number"><select tether-return-reason></select></div></div>
    <div tether-order-fulfillments><p><span tether-fulfillment-bind="company"></span> <a tether-fulfillment-bind="url" tether-fulfillment-bind-text="number"></a></p></div>
    <button id="ret" tether-order-show="returnable" tether-order-return>Return</button>
    <p id="done" tether-order-show="return-requested" hidden>Requested</p>
  </section>
  <p id="sl" tether-show="subscriptions-loading"></p><p id="se" tether-show="subscriptions-empty"></p>
  <div tether-subscriptions><div><span tether-subscription-bind="status"></span> <span tether-subscription-bind="interval"></span>
    <button id="pause" tether-subscription-action="pause">Pause</button><button id="resume" tether-subscription-action="resume">Resume</button>
    <span tether-subscription-show="paused" hidden>Paused</span></div></div>
  <ul tether-addresses><li><span tether-address-bind="formatted"></span><b tether-address-show="default" hidden>Default</b>
    <button tether-address-edit>Edit</button><button tether-address-delete>Delete</button></li></ul>
  <form tether-address-form><input name="address1" value="x"><p tether-form-error></p><p id="own-role" tether-form-error role="status"></p><button>Save</button></form>
  <form tether-profile-form><input name="firstName"><input name="lastName"></form>`;

/** @param {string} selector */
const visible = (selector) => window.getComputedStyle(find(selector)).display !== 'none';
/** @param {string} selector */
const input = (selector) => {
  const element = find(selector);
  assert.ok(element instanceof window.HTMLInputElement, `${selector} is an input`);
  return element;
};
/** @param {string} selector */
const button = (selector) => {
  const element = find(selector);
  assert.ok(element instanceof window.HTMLButtonElement, `${selector} is a button`);
  return element;
};

/**
 * A fresh copy of src/account.ts is the same source, so its export has the same type: what is left to check is that it
 * is there.
 *
 * @param {unknown} value
 * @returns {value is typeof import('../src/account.ts').mountAccount}
 */
const isMountAccount = (value) => typeof value === 'function';

/**
 * Mounts the account pages on an order page, with `check` run while the page is up.
 *
 * @param {(posts: { path: string, body: unknown }[]) => Promise<void>} check Given what the page posted so far.
 * @param {Record<string, () => Response | Promise<Response>>} [answers] The Worker's answers this test changes.
 */
async function onAccountPages(check, answers = {}) {
  // A fresh instance, as an earlier test logged out; tsc can't resolve the query string, so its export is checked.
  const freshAccount = '../src/account.ts?pages';
  const mountAccount = asRecord(await import(freshAccount), 'the fresh account module')['mountAccount'];
  assert.ok(isMountAccount(mountAccount));
  cfg.account = {
    server: '/_tether/account',
    orderUrl: '/account/order?id={id}',
    subscriptionsUrl: 'https://shopify.com/1/account/pages/subs',
  };
  const realFetch = globalThis.fetch;
  const worker = accountPagesWorker(realFetch, answers);
  globalThis.fetch = worker.fetch;
  try {
    window.history.replaceState(null, '', '/account/order?id=7');
    document.body.innerHTML = ACCOUNT_PAGES;
    await mountAccount(document);
    await check(worker.posts);
  } finally {
    globalThis.fetch = realFetch;
    cfg.account = null;
    window.history.replaceState(null, '', '/');
  }
}

test('account pages: the order page with tracking and a return request', async () => {
  await onAccountPages(async (posts) => {
    assert.equal(find('#subs').getAttribute('href'), 'https://shopify.com/1/account/pages/subs');
    assert.equal(
      find('[tether-orders] a').getAttribute('href'),
      '/account/order?id=7',
      "list links to the site's own order page",
    );
    assert.equal(find('[tether-order] h1').textContent, '#1007');
    assert.equal(find('#ship').textContent, 'Street 1, Utrecht');
    assert.equal(find('[tether-order-line="title"]').textContent, 'Tee');
    assert.equal(find('[tether-fulfillment-bind="company"]').textContent, 'PostNL');
    assert.equal(find('[tether-fulfillment-bind="url"]').getAttribute('href'), 'https://track.example/3S123');
    assert.equal(input('[tether-return-quantity]').max, '2');
    const reason = find('[tether-return-reason]');
    assert.ok(reason instanceof window.HTMLSelectElement);
    assert.equal(reason.options.length, 1);
    assert.ok(visible('#ret'));
    assert.ok(!visible('[tether-order-show="loading"]'));
    // Return request: only lines with a quantity.
    input('[tether-return-quantity]').value = '1';
    find('#ret').click();
    await waitFor(() => visible('#done'), 'the return request to finish');
    assert.deepEqual(posts.find((post) => post.path === '/return')?.body, {
      orderId: 'gid://shopify/Order/7',
      lines: [
        { lineItemId: 'gid://shopify/LineItem/1', quantity: 1, reasonId: 'gid://shopify/ReturnReasonDefinition/1' },
      ],
    });
    assert.ok(visible('#done'));
  });
});

test('account pages: subscriptions with actions that follow the status', async () => {
  await onAccountPages(async (posts) => {
    assert.equal(find('[tether-subscription-bind="status"]').textContent, 'active');
    assert.equal(find('[tether-subscription-bind="interval"]').textContent, 'month');
    assert.ok(!visible('#sl') && !visible('#se'));
    assert.equal(button('#resume').disabled, true);
    find('#pause').click();
    await waitFor(() => find('[tether-subscription-bind="status"]').textContent === 'paused', 'the pause to finish');
    assert.deepEqual(posts.find((post) => post.path === '/subscription')?.body, {
      id: 'gid://shopify/SubscriptionContract/5',
      action: 'pause',
    });
    assert.equal(find('[tether-subscription-bind="status"]').textContent, 'paused');
    assert.ok(visible('[tether-subscription-show="paused"]'));
    assert.equal(button('#pause').disabled, true);
  });
});

test('account pages: addresses with the default, a Shopify error in the form, the profile prefilled', async () => {
  // A router on document that registered first (Astro's ClientRouter) must see the submit handled.
  /** @type {boolean | null} */
  let routerSaw = null;
  /** @param {Event} event */
  const router = (event) => {
    routerSaw = event.defaultPrevented;
  };
  document.addEventListener('submit', router);
  await onAccountPages(async (posts) => {
    assert.equal(find('[tether-address-bind="formatted"]').textContent, 'Street 1, Utrecht');
    assert.ok(visible('[tether-address-show="default"]'));
    find('[tether-address-form]').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
    find('[tether-address-form]').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true })); // Enter twice
    document.removeEventListener('submit', router);
    assert.equal(routerSaw, true, 'account forms are handled in the capture phase, before a router');
    await waitFor(() => find('[tether-address-form]').getAttribute('tether-form-state') === 'error', "Shopify's error");
    assert.equal(find('[tether-address-form] [tether-form-error]').textContent, 'City is required');
    assert.equal(find('[tether-address-form] [tether-form-error]').getAttribute('role'), 'alert', 'announced');
    assert.equal(find('#own-role').getAttribute('role'), 'status', "the site's own role stays");
    assert.equal(
      posts.filter((post) => post.path === '/address').length,
      1,
      'a second submit while sending sends nothing',
    );
    assert.equal(input('[tether-profile-form] [name="firstName"]').value, 'Ada');
  });
});

/** @param {string} id The address's numeric id. */
const addressAt = (id) => ({
  id: `gid://shopify/CustomerAddress/${id}`,
  address1: `Street ${id}`,
  formatted: [`Street ${id}`],
});

test('account pages: Edit on another address while a save is on its way keeps that address in the form', async () => {
  /** @type {() => void} */
  let answerSave = () => {};
  const saveAnswered = new Promise((resolve) => {
    answerSave = () => {
      resolve(undefined);
    };
  });
  const answers = {
    '/addresses': () => jsonResponse({ ok: true, addresses: [addressAt('1'), addressAt('2')] }),
    '/address': async () => {
      await saveAnswered;
      return jsonResponse({ ok: true, address: addressAt('1') });
    },
  };
  await onAccountPages(async () => {
    const [editFirst, editSecond] = [...document.querySelectorAll('[tether-address-edit]')];
    assert.ok(editFirst instanceof window.HTMLElement && editSecond instanceof window.HTMLElement);
    const form = find('[tether-address-form]');
    assert.ok(form instanceof window.HTMLFormElement);
    /** @type {unknown[]} */
    const thrown = [];
    /** @param {ErrorEvent} event */
    const onError = (event) => thrown.push(event.error);
    window.addEventListener('error', onError);
    editFirst.click();
    form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
    editSecond.click();
    window.removeEventListener('error', onError);
    assert.deepEqual(thrown, [], 'Edit fills the form without throwing');
    answerSave();
    await waitFor(() => form.getAttribute('tether-form-state') === 'saved', 'the first address saved');
    assert.equal(form.dataset['tetherAddressId'], 'gid://shopify/CustomerAddress/2');
    assert.equal(input('[tether-address-form] [name="address1"]').value, 'Street 2');
  }, answers);
});

test("account pages: a failed delete shows in the address form's error box when the row has none", async () => {
  const refused = () =>
    jsonResponse({ error: 'Address is in use', userErrors: [{ message: 'Address is in use' }] }, 400);
  await onAccountPages(
    async () => {
      find('[tether-address-delete]').click();
      await waitFor(
        () => find('[tether-addresses] li').getAttribute('tether-form-state') === 'error',
        'the refused delete',
      );
      const box = find('[tether-address-form] [tether-form-error]');
      assert.equal(box.textContent, 'Address is in use');
      assert.equal(box.getAttribute('role'), 'alert', 'announced');
    },
    { '/address/delete': refused },
  );
});
