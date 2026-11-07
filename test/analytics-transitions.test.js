// Page views with page transitions (Barba, Swup), which keep the body: `unmount()` and then `mount(container)` is a
// new page, and Astro's own navigation still counts once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, rendered } from './astro-harness.js';
import { waitFor } from '../server/test/mocks.js';

test('analytics: a container mounted after unmount() is a page view; other mounts and Astro navigations count once', async () => {
  /** @type {string[]} */
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
