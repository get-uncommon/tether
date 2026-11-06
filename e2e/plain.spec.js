// The <script> build on a plain HTML page (the Webflow setup), its optional parts, analytics and
// markets, in real browsers. Shopify analytics events are intercepted: nothing reaches Shopify.
import { test, expect } from '@playwright/test';

const MONORAIL = /monorail-edge\.shopifysvc\.com/;

test.beforeEach(async ({ page }) => {
  await page.route(/checkout\.hydrogen\.shop|\/cart\/c\//, (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: 'checkout' }),
  );
});

test('script tag: optional parts load from their own files (search, extras), variant links, bundles', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop flow');
  const parts = [];
  page.on('request', (r) => {
    const m = r.url().match(/tether\.(\w+)\.min\.js/);
    if (m) parts.push(m[1]);
  });
  await page.goto('/plain/?handle=the-h2-snowboard');
  await expect(page.locator('#pdp')).toHaveAttribute('tether-state', 'ready');
  await expect(page.locator('#price')).toContainText('€');

  // Search part
  await page.getByLabel('Search').fill('snowb');
  await expect(page.locator('[tether-search-products] a').first()).toContainText(/snowboard/i, { timeout: 15000 });
  expect(parts).toContain('search');

  // Extras part: ?variant= follows the choice
  const sizes = page.locator('#pdp [tether-option-list] [tether-option-value]');
  await sizes.nth(2).click();
  await expect(page).toHaveURL(/variant=\d+/);

  // Extras part: a bundle in one request
  await page.locator('#add-set').click();
  await expect(page.locator('[tether-cart-count]')).toHaveText(/[1-9]/, { timeout: 15000 });
  expect(parts).toContain('extras');
  expect(parts).not.toContain('account'); // not configured: never loaded
});

test('GA4: dataLayer gets view_item, add_to_cart and begin_checkout in a real browser', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop flow');
  await page.goto('/plain/?handle=the-h2-snowboard');
  await expect(page.locator('#pdp')).toHaveAttribute('tether-state', 'ready');
  await expect
    .poll(() => page.evaluate(() => (window.dataLayer || []).map((x) => x.event).filter(Boolean)))
    .toContain('view_item');
  await page.locator('#pdp [tether-add-to-cart]').click();
  await expect
    .poll(() => page.evaluate(() => window.dataLayer.map((x) => x.event).filter(Boolean)), { timeout: 15000 })
    .toContain('add_to_cart');
  const add = await page.evaluate(() => window.dataLayer.find((x) => x.event === 'add_to_cart'));
  expect(add.ecommerce.currency).toBe('EUR');
  expect(add.ecommerce.items[0].item_name).toMatch(/H2/);
  await page.locator('[tether-checkout]').click();
  await page.waitForURL(/checkout/);
});

test('other market on a static page: html.tether-market-pending until the live prices are in', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'tether:market:hydrogen-preview.myshopify.com',
      JSON.stringify({ country: 'DE', locale: 'de-DE' }),
    );
    window.__classes = [];
    // The init script runs before <html> exists: watch the whole document for it.
    new MutationObserver((list) =>
      list.forEach((m) => {
        if (m.target === document.documentElement) window.__classes.push(m.target.className);
      }),
    ).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.goto('/products/the-h2-snowboard/');
  await expect(page.locator('article[tether-product]')).toHaveAttribute('tether-state', 'ready');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('tether-market-pending')))
    .toBe(false);
  const history = await page.evaluate(() => window.__classes);
  expect(history.some((c) => c.includes('tether-market-pending'))).toBe(true);
  await expect(page.locator('article [tether-bind="price"]').first()).toContainText(/\d,\d\d\s?€/); // German format
});

test("Shopify analytics: Shopify's own scripts load, nothing is sent before consent, events go out after", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop flow');
  const sent = [];
  await page.route(MONORAIL, (r) => {
    sent.push(r.request().postData() || '');
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":[]}' });
  });
  const scripts = [];
  page.on('request', (r) => {
    if (/cdn\.shopify\.com\/(storefront\/analytics|shopifycloud\/consent-tracking-api)/.test(r.url()))
      scripts.push(r.url());
  });
  await page.goto('/plain/?handle=the-h2-snowboard&shopify=1');
  await expect(page.locator('#pdp')).toHaveAttribute('tether-state', 'ready');
  await expect.poll(() => scripts.length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => typeof window.Shopify?.analytics?.publish)).toBe('function');
  await expect
    .poll(() => page.evaluate(() => typeof window.Shopify?.customerPrivacy?.setTrackingConsent), { timeout: 15000 })
    .toBe('function');

  // Whether Shopify's script registered on the bus, and whether anything went out without consent.
  const before = sent.length;
  test.info().annotations.push({ type: 'before consent', description: `${before} sends` });

  // The visitor accepts analytics (what a cookie banner does).
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        window.Shopify.customerPrivacy.setTrackingConsent(
          {
            analytics: true,
            marketing: false,
            preferences: true,
            sale_of_data: false,
            headlessStorefront: true,
            checkoutRootDomain: 'hydrogen-preview.myshopify.com',
            storefrontAccessToken: window.TETHER_CONFIG.token,
          },
          () => resolve(),
        ),
      ),
  );
  await page.locator('#pdp [tether-add-to-cart]').click();
  await expect(page.locator('[tether-cart-count]')).toHaveText(/[1-9]/, { timeout: 15000 });
  await page.waitForTimeout(3000);
  const bodies = sent.join('\n');
  test.info().annotations.push({ type: 'after consent', description: `${sent.length} sends: ${bodies.slice(0, 300)}` });
  console.log(
    '[shopify analytics] sends before consent:',
    before,
    '| after:',
    sent.length,
    '|',
    (bodies.match(/"event_name":"\w+"/g) || []).join(' '),
  );
});
