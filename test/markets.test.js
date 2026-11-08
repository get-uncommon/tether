// Markets: country/language detection, tether-country-select, setCountry().
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cancelTimersAfterTests,
  cartFrom,
  detailOf,
  find,
  graphqlRequest,
  jsonResponse,
  operationName,
  pageGlobals,
  product,
  whenRead,
} from './fixtures.js';
import { fieldOf, parseJson, recordAt, stringAt, waitFor } from '../server/test/mocks.js';
import { isRecord } from '../server/src/shared/json.ts';

cancelTimersAfterTests();

// A German Webflow locale page, with a saved cart from the Dutch market.
const dom = new JSDOM('<!doctype html><html lang="de-DE"><body></body></html>', {
  url: 'https://site.test/de/product/coffee-box',
});
Object.assign(globalThis, pageGlobals(dom.window));

/** @type {Partial<Record<string, number>>} */
const delays = {}; // country -> ms, to simulate a slow response from the old market
/** @type {Partial<Record<string, string>>} */
const CURRENCY = { NL: 'EUR', DE: 'EUR', US: 'USD', CH: 'CHF' };
/**
 * @typedef {{ host: string, op: string, variables: ReturnType<typeof graphqlRequest>['variables'], ctx: string,
 *   country: string | null, read: boolean }} StorefrontCall
 */
/** @type {StorefrontCall[]} */
const calls = [];
/** @type {Set<string>} */
const hosts = new Set(); // every host ever contacted (never cleared)
/** @type {import('../src/cart/store.ts').ShopifyCart | null} */
let cart = null;
const firstVariantId = product.variants.nodes[0]?.id ?? '';
/** @param {string} countryCode */
const cartWith = (countryCode) => ({
  ...cartFrom([{ merchandiseId: firstVariantId, quantity: 1 }]),
  buyerIdentity: { countryCode, email: null },
});

/**
 * The product as Shopify returns it in a market: prices in that market's currency.
 *
 * @param {string | null} country
 * @returns {import('../src/fragments.ts').Product}
 */
function productIn(country) {
  const currency = (country && CURRENCY[country]) || 'EUR';
  const amount = country === 'US' ? '35' : '30';
  const priced = structuredClone(product);
  /** @param {unknown} node Part of the copy, repriced in place. */
  const reprice = (node) => {
    if (typeof node !== 'object' || node === null) return;
    if (isRecord(node)) {
      if (node['amount'] === '30') node['amount'] = amount;
      if (node['currencyCode'] === 'EUR') node['currencyCode'] = currency;
    }
    Object.values(node).forEach(reprice);
  };
  reprice(priced);
  return priced;
}

/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (url, init) => {
  const host = new URL(url instanceof Request ? url.url : url).host;
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  const ctx = /@inContext\(([^)]*)\)/.exec(query)?.[1] || '';
  const country = /country: (\w+)/.exec(ctx)?.[1] || null;
  /** @type {StorefrontCall} */
  const call = { host, op, variables, ctx, country, read: false };
  calls.push(call);
  hosts.add(host);
  /** @param {unknown} data */
  const ok = (data) => whenRead(jsonResponse({ data }), call);
  const delay = country ? delays[country] : undefined;
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

  switch (op) {
    case 'TetherProducts': {
      /** @type {Record<string, import('../src/fragments.ts').Product | null>} */
      const data = {};
      Object.keys(variables).forEach((key) => {
        if (key.startsWith('h')) data[key] = variables[key] === product.handle ? productIn(country) : null;
      });
      return ok(data);
    }
    case 'TetherLocalization':
      return ok({
        localization: {
          country: {
            isoCode: country || 'NL',
            name: country || 'NL',
            currency: { isoCode: (country && CURRENCY[country]) || 'EUR', symbol: '€' },
          },
          language: { isoCode: 'DE', name: 'Deutsch' },
          availableCountries: [
            { isoCode: 'US', name: 'United States', currency: { isoCode: 'USD', symbol: '$' }, availableLanguages: [] },
            { isoCode: 'DE', name: 'Germany', currency: { isoCode: 'EUR', symbol: '€' }, availableLanguages: [] },
            { isoCode: 'NL', name: 'Netherlands', currency: { isoCode: 'EUR', symbol: '€' }, availableLanguages: [] },
          ],
        },
      });
    case 'TetherCart':
      return ok({ cart });
    case 'TetherSearch':
      return ok({ products: { nodes: [productIn(country)], pageInfo: { hasNextPage: false, endCursor: null } } });
    case 'Tether_cartBuyerIdentityUpdate':
      if (stringAt(variables, 'cartId').endsWith('/expired'))
        return jsonResponse({ errors: [{ message: 'The specified cart does not exist.' }] });
      assert.ok(cart, 'a cart to update');
      cart = {
        ...cart,
        buyerIdentity: { countryCode: stringAt(recordAt(variables, 'buyerIdentity'), 'countryCode'), email: null },
      };
      return ok({ cartBuyerIdentityUpdate: { cart, userErrors: [] } });
    case 'Tether_cartCreate':
      throw new Error('switching country must not create a cart');
    default:
      throw new Error(`unexpected op ${op}`);
  }
};

const priceText = () => document.querySelector('#price')?.textContent ?? '';
const listPrice = () => document.querySelector('.p')?.textContent ?? '';
/** @type {typeof import('../src/index.ts').default} */
let Tether;

before(async () => {
  localStorage.setItem('tether:cart:shop.test', 'gid://shopify/Cart/1');
  cart = cartWith('NL');
  ({ default: Tether } = await import('../src/index.ts'));
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    country: 'NL',
    locale: 'nl-NL',
    markets: { detect: true, locales: { de: { country: 'DE', language: 'DE' } } },
  });
});

beforeEach(() => {
  calls.length = 0;
});

// ---- detection (pure) -------------------------------------------------------

/**
 * @param {{ path?: string; lang?: string | null; meta?: string | null; cookie?: string; saved?: object | null; global?: object }} [page]
 */
const env = ({ path = '/', lang = null, meta = null, cookie = '', saved = null, global = {} } = {}) => {
  const page = new JSDOM(
    `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head>${meta ? `<meta name="tether-country" content="${meta}">` : ''}</head></html>`,
    { url: `https://x.test${path}` },
  );
  page.window.document.cookie = cookie;
  const store = new Map(saved ? [['tether:market:shop.test', JSON.stringify(saved)]] : []);
  return {
    document: page.window.document,
    location: page.window.location,
    storage: { getItem: (/** @type {string} */ key) => store.get(key) ?? null },
    global,
  };
};
const locales = { de: { country: 'DE', language: 'DE' }, 'fr-be': { country: 'BE', language: 'FR', locale: 'fr-BE' } };

test('detect: Webflow locale subdirectory through the locales map', async () => {
  const detected = await Tether.detectMarket(); // async: the markets part loads on first use
  assert.equal(detected.country, 'DE'); // from the page this file runs on (/de/...)
  /** @param {Parameters<typeof env>[0]} page */
  const detectOn = (page) => detectOnly({ detect: true, locales }, env(page));
  assert.deepEqual(pick(detectOn({ path: '/fr-be/shop' })), { country: 'BE', language: 'FR', locale: 'fr-BE' });
  assert.deepEqual(pick(detectOn({ path: '/de/shop' })), { country: 'DE', language: 'DE' });
});

test('detect: <html lang>, mapped or not; never invents a country', () => {
  assert.deepEqual(pick(detectOnly({ detect: true, locales }, env({ lang: 'de' }))), {
    country: 'DE',
    language: 'DE',
    locale: 'de',
  });
  assert.deepEqual(pick(detectOnly({ detect: true }, env({ lang: 'de-CH' }))), {
    country: 'CH',
    language: 'DE',
    locale: 'de-CH',
  });
  assert.deepEqual(pick(detectOnly({ detect: true }, env({ lang: 'pt-BR' }))), {
    country: 'BR',
    language: 'PT_BR',
    locale: 'pt-BR',
  });
  assert.deepEqual(pick(detectOnly({ detect: true }, env({ lang: 'en' }))), { language: 'EN', locale: 'en' });
});

test('detect: server hints (global, meta, cookie) and the saved choice win, in that order', () => {
  const config = { detect: true, locales };
  assert.equal(detectOnly(config, env({ path: '/de/', meta: 'us' })).country, 'US');
  assert.equal(detectOnly(config, env({ path: '/de/', cookie: 'tether_country=CH' })).country, 'CH');
  assert.equal(detectOnly({ ...config, cookie: 'cf_country' }, env({ cookie: 'cf_country=BE' })).country, 'BE');
  assert.equal(detectOnly(config, env({ global: { TETHER_COUNTRY: 'FR' }, meta: 'US' })).country, 'FR');
  const saved = detectOnly(config, env({ path: '/de/', meta: 'US', saved: { country: 'NL' } }));
  assert.equal(saved.country, 'NL');
  assert.equal(saved.sources?.country, 'saved');
  assert.equal(saved.language, 'DE', 'language still from the Webflow locale');
  assert.equal(detectOnly({ ...config, remember: false }, env({ meta: 'US', saved: { country: 'NL' } })).country, 'US');
});

test('detect: invalid or unknown countries are ignored; off by default; sources can be limited', () => {
  assert.equal(detectOnly({ detect: true }, env({ meta: 'XX' })).country, undefined);
  assert.equal(detectOnly({ detect: true }, env({ cookie: 'tether_country=Germany' })).country, undefined);
  const malformed = env({ path: '/de/', cookie: 'tether_country=%E0%A4%A' });
  assert.equal(detectOnly({ detect: true, locales }, malformed).country, 'DE', 'a malformed cookie is ignored');
  assert.equal(detectOnly(null, env({ meta: 'US' })).country, undefined, 'server hints need detect');
  assert.equal(
    detectOnly(null, env({ meta: 'US', saved: { country: 'BE' } })).country,
    'BE',
    'a saved choice applies without detect',
  );
  assert.deepEqual(detectOnly({ detect: false }, env({ meta: 'US', saved: { country: 'BE' } })), {});
  assert.equal(detectOnly({ detect: ['webflow'], locales }, env({ path: '/de/', meta: 'US' })).country, 'DE');
});

/** @type {typeof import('../src/markets.ts')} */
let markets;
/** @param {Parameters<typeof markets.detectMarket>} args */
const detectOnly = (...args) => markets.detectMarket(...args);
/** @param {import('../src/markets.ts').DetectedMarket} market The fields it found, without `sources`. */
const pick = ({ country, language, locale }) =>
  Object.fromEntries(Object.entries({ country, language, locale }).filter(([, value]) => value));
before(async () => {
  markets = await import('../src/markets.ts');
});

// ---- init + switching --------------------------------------------------------

test('init used the detected market: @inContext DE and the saved NL cart moved to DE', async () => {
  assert.equal(Tether.config.country, 'DE');
  assert.equal(Tether.config.language, 'DE');
  assert.equal(Tether.cart.state?.buyerIdentity.countryCode, 'DE');
  document.body.innerHTML = '<div tether-product="coffee-box"><span id="price" tether-bind="price"></span></div>';
  Tether.mount(document);
  await waitFor(() => calls.some((call) => call.op === 'TetherProducts'), 'the product request');
  const productCall = calls.find((call) => call.op === 'TetherProducts');
  assert.equal(productCall?.ctx, 'country: DE, language: DE');
});

test('tether-country-select lists the markets; switching re-renders prices and updates the cart', async () => {
  localStorage.removeItem('tether:market:shop.test');
  document.body.innerHTML = `
    <select id="cs" tether-country-select tether-country-label="{name} – {currency}"><option>placeholder</option></select>
    <span id="cur" tether-country-bind="currency"></span>
    <div tether-product="coffee-box"><span id="price" tether-bind="price"></span>
      <div tether-option-list="Size"><button>v</button></div></div>`;
  Tether.mount(document);
  await waitFor(
    () => document.querySelector('select')?.options.length === 3 && priceText().includes('30'),
    'the country select and the price',
  );
  const select = document.querySelector('select');
  assert.ok(select);
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ['Germany – EUR', 'Netherlands – EUR', 'United States – USD'],
  );
  assert.equal(select.value, 'DE');
  assert.equal(find('#cur').textContent, 'EUR');
  assert.match(find('#price').textContent, /30/);
  const scope = Tether.getScope(find('#price'));
  assert.ok(scope);
  scope.select('Size', '1kg');

  /** @type {{ country: string }[]} */
  const changes = [];
  document.addEventListener(
    'tether:country-changed',
    (event) => changes.push({ country: stringAt(detailOf(event), 'country') }),
    { once: true },
  );
  calls.length = 0;
  select.value = 'US';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(
    () => changes.length === 1 && priceText().includes('35') && find('#cur').textContent === 'USD',
    'the switch to US',
  );

  const update = calls.find((call) => call.op === 'Tether_cartBuyerIdentityUpdate');
  assert.ok(update);
  assert.equal(recordAt(update.variables, 'buyerIdentity')['countryCode'], 'US');
  assert.equal(update.country, 'US', 'cart mutation sent in the new context');
  assert.equal(Tether.cart.state?.buyerIdentity.countryCode, 'US');
  const refetch = calls.find((call) => call.op === 'TetherProducts');
  assert.equal(refetch?.country, 'US');
  assert.match(find('#price').textContent, /\$|USD/);
  assert.match(find('#price').textContent, /35/);
  assert.equal(Tether.getScope(find('#price')), scope, 'same scope, updated in place');
  assert.equal(scope.selected['Size'], '1kg', 'selection kept');
  assert.equal(find('#cur').textContent, 'USD');
  assert.equal(changes[0]?.country, 'US');
  assert.deepEqual(JSON.parse(String(localStorage.getItem('tether:market:shop.test'))), {
    country: 'US',
    language: 'DE',
  });
});

test('setCountry validates, and does nothing when the country is unchanged', async () => {
  await assert.rejects(Tether.setCountry('Germany'), /Not a country code/);
  calls.length = 0;
  await Tether.setCountry('us');
  assert.ok(!calls.some((call) => call.op === 'TetherProducts' || call.op === 'Tether_cartBuyerIdentityUpdate'));
});

test('a list re-renders in the new market', async () => {
  document.body.innerHTML =
    '<div tether-products=""><div tether-list><div><span class="p" tether-bind="price"></span></div></div></div>';
  Tether.mount(document);
  await waitFor(() => listPrice().includes('35'), 'the list in US prices');
  calls.length = 0;
  await Tether.setCountry('NL', { remember: false });
  await waitFor(() => listPrice().includes('30'), 'the list in NL prices');
  assert.equal(calls.find((call) => call.op === 'TetherSearch')?.country, 'NL');
  assert.match(find('.p').textContent, /30/);
  assert.equal(document.querySelectorAll('.p').length, 1);
});

test('a slow response from the old market never overwrites the new one or refills the cache', async () => {
  await Tether.setCountry('NL', { remember: false });
  Tether.clearProductCache();
  delays['NL'] = 120;
  document.body.innerHTML = '<div tether-product="coffee-box"><span id="price" tether-bind="price"></span></div>';
  calls.length = 0;
  Tether.mount(document);
  await waitFor(
    () => calls.some((call) => call.op === 'TetherProducts' && call.country === 'NL'),
    'the slow NL request',
  );
  await Tether.setCountry('US', { remember: false });
  const slow = calls.find((call) => call.country === 'NL');
  await waitFor(() => slow?.read === true, 'Tether to read the NL answer');
  // What Tether does with an answer it has read runs in microtasks, or in a 0 ms timer queued before this one.
  await new Promise((resolve) => setTimeout(resolve, 0));
  delete delays['NL'];
  assert.match(find('#price').textContent, /35/);
  const cached = await Tether.getProduct('coffee-box');
  assert.equal(cached.priceRange.minVariantPrice.currencyCode, 'USD', 'cache holds the US product');
});

test('switching country keeps rendered products visible (state "updating", not "loading")', async () => {
  document.body.innerHTML = '<div tether-product="coffee-box"><div id="ready" tether-show="ready">x</div></div>';
  Tether.mount(document);
  const root = find('[tether-product]');
  await waitFor(() => root.getAttribute('tether-state') === 'ready', 'the product');
  delays['DE'] = 60;
  const switched = Tether.setCountry('DE', { remember: false });
  await waitFor(() => root.getAttribute('tether-state') === 'updating', 'the switch to start');
  assert.notEqual(find('#ready').style.display, 'none');
  await switched;
  await waitFor(() => root.getAttribute('tether-state') === 'ready', 'the product in DE');
  delete delays['DE'];
});

test('an expired saved cart is dropped on a country switch, not replaced by a new empty cart', async () => {
  localStorage.setItem('tether:cart:shop.test', 'gid://shopify/Cart/expired');
  calls.length = 0;
  await Tether.setCountry('BE', { remember: false });
  assert.ok(calls.some((call) => call.op === 'Tether_cartBuyerIdentityUpdate'));
  assert.ok(!calls.some((call) => call.op === 'Tether_cartCreate'));
  assert.equal(Tether.cart.id(), null);
});

test('no request ever leaves for anything but the Storefront API (no IP lookups)', () => {
  assert.deepEqual([...hosts], ['shop.test']);
});

test('setCountry: the money format follows the country (option or markets.locales), and is remembered', async () => {
  const { cfg } = await import('../src/config.ts');
  assert.ok(cfg.markets);
  cfg.markets.locales = { de: { country: 'DE', language: 'DE', locale: 'de-DE' } };
  await Tether.setCountry('DE', { language: null });
  assert.equal(Tether.config.locale, 'de-DE');
  assert.equal(fieldOf(parseJson(String(localStorage.getItem('tether:market:shop.test'))), 'locale'), 'de-DE');
  await Tether.setCountry('NL', { locale: 'nl-NL', language: null });
  assert.equal(Tether.config.locale, 'nl-NL');
});

test('tether-countries limits a country select to your list, in your order', async () => {
  document.body.innerHTML = '<select id="cs2" tether-country-select tether-countries="NL, DE"></select>';
  Tether.mount(document);
  await waitFor(() => document.querySelector('select')?.options.length === 2, 'the country select');
  const select = document.querySelector('select');
  assert.ok(select);
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ['NL', 'DE'],
  );
});

test('page market: <meta name="tether-page-country"> pages switch on View Transitions, and back again', async () => {
  await Tether.setCountry('NL', { language: null, remember: false });
  document.head.innerHTML =
    '<meta name="tether-page-country" content="DE"><meta name="tether-page-language" content="DE"><meta name="tether-page-locale" content="de-DE">';
  document.body.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await waitFor(() => Tether.config.locale === 'de-DE', 'the German page market');
  assert.equal(Tether.config.country, 'DE');
  assert.equal(Tether.config.language, 'DE');
  assert.equal(Tether.config.locale, 'de-DE');
  document.head.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await waitFor(() => Tether.config.language !== 'DE', 'leaving the German page');
});

test('page market: leaving a market page, a saved market that is not valid falls back to the configured one', async () => {
  await Tether.setCountry('NL', { language: null, remember: false });
  document.head.innerHTML = '<meta name="tether-page-country" content="DE">';
  document.body.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await waitFor(() => Tether.config.country === 'DE', 'the German page market');
  localStorage.setItem('tether:market:shop.test', JSON.stringify({ country: 'not a country' }));
  document.head.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await waitFor(() => Tether.config.country === 'NL', 'the configured market');
  localStorage.removeItem('tether:market:shop.test');
});

test('readSavedMarket: a valid saved market, normalized; junk and other scripts’ values are rejected', () => {
  /** @param {string | null} text */
  const storageWith = (text) => ({
    getItem: (/** @type {string} */ key) => (key === 'tether:market:shop.test' ? text : null),
  });
  assert.deepEqual(markets.readSavedMarket(storageWith('{"country":"de","language":"de-DE","locale":"de-DE"}')), {
    country: 'DE',
    language: 'DE',
    locale: 'de-DE',
  });
  assert.deepEqual(markets.readSavedMarket(storageWith('{"country":"BE","language":"Flemish!","locale":""}')), {
    country: 'BE',
    language: undefined,
    locale: undefined,
  });
  for (const junk of [
    'not json',
    'null',
    '"DE"',
    '[]',
    '{"country":"Germany"}',
    '{"country":"XX"}',
    '{"language":"FR"}',
  ]) {
    assert.equal(markets.readSavedMarket(storageWith(junk)), null, junk);
  }
  assert.equal(markets.readSavedMarket(storageWith(null)), null, 'nothing saved');
  assert.equal(detectOnly(null, env({ saved: { country: 'Germany', language: 'DE' } })).country, undefined);
});

test('detect: a single source name or an unknown one in detect is tolerated', () => {
  // @ts-expect-error -- a single name, not a list, as a site's own untyped script may pass it
  assert.equal(detectOnly({ detect: 'server' }, env({ meta: 'US' })).country, 'US');
  // @ts-expect-error -- a source Tether doesn't know, as a site's own untyped script may pass it
  assert.deepEqual(detectOnly({ detect: ['nope'] }, env({ meta: 'US' })), { sources: {} });
});
