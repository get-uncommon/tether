// The optional parts the built core loads on account, search and cart pages, minified by terser, each from its file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { find, jsonResponse, pageLoaded, partsOf } from './fixtures.js';
import { assertLoadedWithIntegrity, builtPage } from './built-page.js';
import { urlOf, waitFor } from '../server/test/mocks.js';

/** @param {string} amount */
const euros = (amount) => ({ amount, currencyCode: 'EUR' });

const ORDER = {
  id: 'gid://shopify/Order/7',
  name: '#1007',
  processedAt: '2026-11-01',
  totalPrice: euros('10'),
  subtotal: euros('8'),
  totalShipping: euros('2'),
  financialStatus: 'PAID',
  fulfillmentStatus: 'FULFILLED',
  shippingAddress: { formatted: ['Street 1', 'Utrecht'] },
  lineItems: { nodes: [{ id: 'gid://shopify/LineItem/1', title: 'Tee', quantity: 2, price: euros('4') }] },
  fulfillments: { nodes: [] },
  returnInformation: { returnableLineItems: { nodes: [] } },
  returns: { nodes: [] },
};

/** The Worker's account routes, by path after `account.server`. */
const WORKER_ANSWERS = new Map([
  ['/me', { loggedIn: true, customer: { firstName: 'Ada', lastName: 'L', email: 'ada@x.test' } }],
  ['/orders', { orders: [ORDER] }],
  ['/order', { ok: true, order: ORDER }],
]);

const BODY = `
  <span id="first-name" tether-account-bind="first-name"></span>
  <ul tether-orders><li><a tether-order-bind="url"><span tether-order-bind="name"></span></a></li></ul>
  <section id="order" tether-order="url:id">
    <h1 tether-order-bind="name"></h1><span id="total" tether-order-bind="total"></span>
    <div tether-order-lines><div><span tether-order-line="title"></span></div></div>
  </section>
  <form tether-search action="/search"><input tether-search-input name="q"><div tether-search-results></div></form>
  <form id="discount" tether-discount-form><input tether-discount-input value="SAVE"></form>`;

test(
  'the account, account pages, search, analytics and extras parts run on the built core',
  { timeout: 120_000 },
  async () => {
    const page = builtPage(
      "{ domain: 'shop.test', token: 't', autoMount: true, account: { server: '/_tether/account' }, analytics: { onEvent() {} } }",
      BODY,
      'https://site.test/account/order?id=7',
      async (url) => {
        const { pathname } = new URL(urlOf(url), 'https://site.test/');
        const answer = pathname.startsWith('/_tether/account/')
          ? WORKER_ANSWERS.get(pathname.slice('/_tether/account'.length))
          : undefined;
        // The cart's requests to the Storefront API fail, so Shopify never sees the discount code.
        if (!answer) throw new TypeError('Failed to fetch');
        return jsonResponse(answer);
      },
    );
    try {
      await pageLoaded(page, 'the account page with the built script');
      const order = find('#order', page.document);
      await waitFor(
        () => find('h1', order).textContent === '#1007',
        'the account pages part to render the order',
        30_000,
      );
      assert.equal(find('[tether-order-line="title"]', order).textContent, 'Tee');
      assert.match(find('#total', page.document).textContent, /10/);
      assert.equal(find('[tether-orders] [tether-order-bind="name"]', page.document).textContent, '#1007');
      assert.equal(find('#first-name', page.document).textContent, 'Ada');
      await assertLoadedWithIntegrity(page, 'tether.account.min.js');
      await assertLoadedWithIntegrity(page, 'tether.account-pages.min.js');

      const input = find('[tether-search-input]', page.document);
      await waitFor(() => input.getAttribute('role') === 'combobox', 'the search part to set up the input', 30_000);
      await assertLoadedWithIntegrity(page, 'tether.search.min.js');

      await waitFor(() => Boolean(partsOf(page)?.analytics), 'the analytics part to register', 30_000);
      await assertLoadedWithIntegrity(page, 'tether.analytics.min.js');

      const discount = find('#discount', page.document);
      assert.ok(discount instanceof page.HTMLFormElement);
      discount.requestSubmit();
      await waitFor(
        () => discount.classList.contains('is-invalid'),
        'the extras part to mark the code refused',
        30_000,
      );
      await assertLoadedWithIntegrity(page, 'tether.extras.min.js');
    } finally {
      page.close();
    }
  },
);
