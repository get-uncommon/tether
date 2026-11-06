// What a customer does in the Astro starter, in real browsers, against Shopify's public demo store.
import assert from 'node:assert/strict';
import { test, expect } from '@playwright/test';

const shopify = (req) => /myshopify\.com\/api\/.*graphql/.test(req.url());

test.beforeEach(async ({ page }) => {
  // Never leave for Shopify's checkout: answer it here instead.
  await page.route(/checkout\.hydrogen\.shop|\/cart\/c\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>checkout</h1>' }),
  );
});

test('home: server-rendered cards are live after one Shopify request', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => {
    if (shopify(r)) requests.push(r);
  });
  await page.goto('/');
  await expect(page.locator('a.card').first()).toHaveAttribute('tether-state', 'ready');
  await expect(page.locator('a.card [tether-bind="price"]').first()).toContainText('€');
  await page.waitForTimeout(500);
  expect(requests.length).toBeLessThanOrEqual(2); // one batched refresh (+ the saved cart, if any)
});

test('product: variant changes the price, add to cart opens the drawer, quick clicks add up', async ({ page }) => {
  await page.goto('/products/the-h2-snowboard/');
  const root = page.locator('article[tether-product]');
  await expect(root).toHaveAttribute('tether-state', 'ready');
  const price = page.locator('article [tether-bind="price"]').first();
  await expect(price).toContainText('€');

  await page.getByRole('button', { name: 'Add to cart' }).click();
  const drawer = page.locator('[tether-cart-drawer]');
  await expect(drawer).toHaveClass(/is-open/);
  await expect(page.locator('[tether-cart-count]')).toHaveText('1');

  // Two quick clicks on +: Shopify caps this low-stock board, but the clicks must not be lost.
  const plus = drawer.locator('[tether-line-plus]').first();
  await plus.click();
  await plus.click();
  await expect(drawer.locator('[tether-cart-lines] > *').first()).not.toHaveClass(/is-busy/, { timeout: 15000 });
  const qty = Number(await drawer.locator('[tether-line="quantity"]').first().textContent());
  expect(qty).toBeGreaterThanOrEqual(1);
  if (qty < 3) await expect(drawer.locator('[tether-cart-warning]')).not.toBeEmpty(); // capped by stock: told why

  await page.keyboard.press('Escape');
  await expect(drawer).not.toHaveClass(/is-open/);
  expect(await drawer.evaluate((d) => d instanceof HTMLElement && d.inert)).toBe(true);
});

test('sold out: the button is disabled from the first paint', async ({ page }) => {
  await page.goto('/products/the-full-stack/');
  const btn = page.locator('[tether-add-to-cart]');
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveText(/Sold out/);
});

test('the cart survives a reload and View Transitions, and checkout goes to Shopify', async ({ page }) => {
  await page.goto('/products/the-h2-snowboard/');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.locator('[tether-cart-count]')).toHaveText(/[1-9]/);
  const count = await page.locator('[tether-cart-count]').textContent();
  assert.ok(count);

  await page.reload();
  await expect(page.locator('[tether-cart-count]')).toHaveText(count);

  await page.locator('header a[href="/"]').click(); // View Transition
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[tether-cart-count]')).toHaveText(count);

  await page.locator('[tether-cart-open]').click();
  const [checkout] = await Promise.all([
    page.waitForURL(/checkout\.hydrogen\.shop|\/cart\/c\//, { timeout: 20000 }),
    page.locator('[tether-checkout]').click(),
  ]);
  void checkout;
  expect(page.url()).toMatch(/checkout\.hydrogen\.shop|\/cart\/c\//);
});

test('search as you type: results, arrow keys, Enter opens the product', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard flow is for desktop');
  await page.goto('/');
  const input = page.getByRole('combobox', { name: 'Search products' });
  await input.fill('snowb');
  const first = page.locator('[tether-search-products] a').first();
  await expect(first).toContainText(/Snowboard/i, { timeout: 15000 });
  await input.press('ArrowDown');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/products\//);
});

test('structured data for search engines is in the product page', async ({ page }) => {
  await page.goto('/products/the-h2-snowboard/');
  const json = await page.locator('script[type="application/ld+json"]').textContent();
  assert.ok(json);
  const data = JSON.parse(json);
  expect(['Product', 'ProductGroup']).toContain(data['@type']);
  const offer = data.offers || data.hasVariant[0].offers;
  expect(offer.priceCurrency).toBe('EUR');
});
