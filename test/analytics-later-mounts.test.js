// `Tether.mount(el)` for a part of the page (products added later, an island) is no new page: page views and the
// page's product view still count once per page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, queuedRequestsSent, rendered } from './astro-harness.js';
import { waitFor } from '../server/test/mocks.js';

/**
 * The events Shopify's analytics was given in this file's tests: the analytics part starts once.
 *
 * @type {string[]}
 */
const published = [];
Reflect.set(window, 'Shopify', {
  analytics: {
    getConfig: () => ({
      shop: { shopId: 'gid://shopify/Shop/1', channel: 'headless' },
      consent: { mode: 'no-banner' },
    }),
    /** @param {string} event */
    publish: (event) => published.push(event),
    addDestination: () => () => {},
  },
});
const pageViews = () => published.filter((event) => event === 'page_viewed').length;
const productViews = () => published.filter((event) => event === 'product_viewed').length;

/** @param {Element} root The product root, rendered once this settles. */
const productRendered = (root) => waitFor(() => root.getAttribute('tether-state') === 'ready', 'the product to render');

/** @returns {HTMLElement} A product root for the coffee box. */
function productRoot() {
  const root = document.createElement('div');
  root.setAttribute('tether-product', 'coffee-box');
  return root;
}

test("analytics: a product mounted later on a product page is no second view of the page's product", async () => {
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    country: 'NL',
    locale: 'nl-NL',
    analytics: { shopify: true },
  });
  document.body.innerHTML = '<main><div tether-product="coffee-box"></div></main>';
  Tether.mount(document);
  await rendered();
  await waitFor(() => productViews() === 1, "the page's product view");

  const section = document.createElement('section');
  const later = section.appendChild(productRoot());
  document.body.append(section);
  Tether.mount(section);
  await productRendered(later);
  await queuedRequestsSent();
  assert.deepEqual(published, ['page_viewed', 'product_viewed']);
});

test('analytics: with a persistent <main>, an island mounted outside it leaves the page view to the next mount', async () => {
  document.body.innerHTML = '<div><header></header><main></main></div>';
  const main = document.querySelector('main');
  const header = document.querySelector('header');
  assert.ok(main && header);
  const navigate = async () => {
    const product = main.appendChild(productRoot());
    Tether.mount(main);
    await productRendered(product);
  };
  Tether.unmount();
  await navigate();
  await waitFor(() => pageViews() === 2, 'the page view of the first page');
  const views = productViews();

  Tether.mount(header.appendChild(document.createElement('div')));
  Tether.mount(document.body.appendChild(document.createElement('div')));
  Tether.unmount();
  await queuedRequestsSent();
  assert.equal(pageViews(), 2, 'unmount() alone is no page view');
  main.replaceChildren();
  await navigate();
  await waitFor(() => pageViews() === 3, 'the page view of the next page');
  await queuedRequestsSent();
  assert.equal(pageViews(), 3, 'one page view for the navigation');
  assert.equal(productViews(), views + 1, "the next page's product view");
});

test("analytics: a page's own component mounted before its container is one page view", async () => {
  const main = document.querySelector('main');
  assert.ok(main);
  Tether.unmount();
  main.replaceChildren();
  const component = main.appendChild(document.createElement('div'));
  Tether.mount(component);
  Tether.mount(main);
  await waitFor(() => pageViews() === 4, 'the page view of the page');

  Tether.unmount();
  await queuedRequestsSent();
  assert.equal(pageViews(), 4, 'unmount() alone is no page view');
  Tether.mount(main);
  await waitFor(() => pageViews() === 5, 'the page view of the next page');
});
