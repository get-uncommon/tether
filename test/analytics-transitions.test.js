// Page views with page transitions (Barba, Swup), which keep the body: `unmount()` and then `mount(container)` is a
// new page, and Astro's own navigation still counts once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, rendered } from './astro-harness.js';
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

test('analytics: a container mounted after unmount() is a page view; other mounts and Astro navigations count once', async () => {
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    country: 'NL',
    locale: 'nl-NL',
    analytics: { shopify: true },
  });
  const first = document.createElement('main');
  document.body.append(first);
  Tether.mount(first);
  document.dispatchEvent(new window.Event('astro:page-load'));
  await waitFor(() => pageViews() === 1, 'the landing page view');

  Tether.unmount();
  first.remove();
  const second = document.createElement('main');
  document.body.append(second);
  Tether.mount(second);
  await waitFor(() => pageViews() === 2, 'the page view of the page swapped in');
  Tether.mount(second.appendChild(document.createElement('div')));
  Tether.unmount();
  Tether.mount(second);
  await waitFor(() => pageViews() === 3, 'the page view of a page in the same container');

  document.dispatchEvent(new window.Event('astro:before-swap'));
  const next = document.createElement('body');
  next.innerHTML = '<div tether-product="coffee-box"></div>';
  document.body.replaceWith(next);
  document.dispatchEvent(new window.Event('astro:page-load'));
  await rendered();
  assert.equal(pageViews(), 4, "one page view for Astro's navigation");
});

test("analytics: with Barba's sync mode, a container mounted before unmount() is a page view, whichever runs first", async () => {
  const enter = () => {
    const container = document.createElement('main');
    document.body.append(container);
    Tether.mount(container);
    return container;
  };
  const before = pageViews();
  Tether.unmount();
  const first = enter();
  await waitFor(() => pageViews() === before + 1, 'the page view of the first container');

  // beforeEnter before afterLeave: both containers are in the page when the next one mounts.
  const second = enter();
  Tether.mount(second.appendChild(document.createElement('div')));
  Tether.unmount();
  first.remove();
  await waitFor(() => pageViews() === before + 2, 'the page view of the container mounted before unmount()');
  Tether.mount(second);

  // beforeLeave before beforeEnter.
  Tether.unmount();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pageViews(), before + 2, 'unmount() alone is no page view');
  enter();
  second.remove();
  await waitFor(() => pageViews() === before + 3, 'the page view of the container mounted after unmount()');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pageViews(), before + 3, 'one page view for each container');
});

test("analytics: with Barba's sync mode, the product of the container coming in is that page's product", async () => {
  document.body.replaceChildren();
  const productViews = () => published.filter((event) => event === 'product_viewed').length;
  const enter = async () => {
    const container = document.createElement('main');
    container.innerHTML = '<div tether-product="coffee-box"></div>';
    document.body.append(container);
    Tether.mount(container);
    const product = container.firstElementChild;
    await waitFor(() => product?.getAttribute('tether-state') === 'ready', 'the product to render');
    return container;
  };
  Tether.unmount();
  const first = await enter();
  const before = productViews();
  assert.ok(before > 0, 'the first page has its product view');
  Tether.unmount();
  await enter();
  first.remove();
  assert.equal(productViews(), before + 1, 'the product view of the page coming in, while the page left is shown');
});
