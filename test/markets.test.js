// Markets: country/language detection, tether-country-select, setCountry().
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { product, cartFrom } from './fixtures.js';

// A German Webflow locale page, with a saved cart from the Dutch market.
const dom = new JSDOM('<!doctype html><html lang="de-DE"><body></body></html>', {
  url: 'https://site.test/de/product/coffee-box',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option,
  getComputedStyle: dom.window.getComputedStyle,
});

const delays = {}; // country -> ms, to simulate a slow response from the old market
const CURRENCY = { NL: 'EUR', DE: 'EUR', US: 'USD', CH: 'CHF' };
const calls = [];
const hosts = new Set(); // every host ever contacted (never cleared)
let cart = null;
const cartWith = (countryCode) => ({
  ...cartFrom([{ merchandiseId: product.variants.nodes[0].id, quantity: 1 }]),
  buyerIdentity: { countryCode, email: null },
});

/** The product as Shopify returns it in a market: prices in that market's currency. */
function productIn(country) {
  const cur = CURRENCY[country] || 'EUR';
  const amount = country === 'US' ? '35' : '30';
  const swap = (o) =>
    JSON.parse(
      JSON.stringify(o)
        .replace(/"amount":"30"/g, `"amount":"${amount}"`)
        .replace(/"currencyCode":"EUR"/g, `"currencyCode":"${cur}"`),
    );
  return swap(product);
}

globalThis.fetch = async (url, init) => {
  const host = new URL(url).host;
  const { query, variables } = JSON.parse(init.body);
  const op = query.match(/(?:query|mutation)\s+(\w+)/)[1];
  const ctx = query.match(/@inContext\(([^)]*)\)/)?.[1] || '';
  const country = ctx.match(/country: (\w+)/)?.[1] || null;
  calls.push({ host, op, variables, ctx, country });
  hosts.add(host);
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
  if (delays[country]) await new Promise((r) => setTimeout(r, delays[country]));

  switch (op) {
    case 'TetherProducts': {
      const data = {};
      Object.keys(variables).forEach((k) => {
        if (k.startsWith('h')) data[k] = variables[k] === product.handle ? productIn(country) : null;
      });
      return ok(data);
    }
    case 'TetherLocalization':
      return ok({
        localization: {
          country: {
            isoCode: country || 'NL',
            name: country || 'NL',
            currency: { isoCode: CURRENCY[country] || 'EUR', symbol: '€' },
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
      if (variables.cartId.endsWith('/expired'))
        return {
          ok: true,
          status: 200,
          json: async () => ({ errors: [{ message: 'The specified cart does not exist.' }] }),
        };
      cart = { ...cart, buyerIdentity: { countryCode: variables.buyerIdentity.countryCode, email: null } };
      return ok({ cartBuyerIdentityUpdate: { cart, userErrors: [] } });
    case 'Tether_cartCreate':
      throw new Error('switching country must not create a cart');
    default:
      throw new Error(`unexpected op ${op}`);
  }
};

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let Tether;

before(async () => {
  localStorage.setItem('tether:cart:shop.test', 'gid://shopify/Cart/1');
  cart = cartWith('NL');
  ({ default: Tether } = await import('../src/index.js'));
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

const env = ({ path = '/', lang = null, meta = null, cookie = '', saved = null, global = {} } = {}) => {
  const d = new JSDOM(
    `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head>${meta ? `<meta name="tether-country" content="${meta}">` : ''}</head></html>`,
    { url: `https://x.test${path}` },
  );
  d.window.document.cookie = cookie;
  const store = new Map(saved ? [['tether:market:shop.test', JSON.stringify(saved)]] : []);
  return {
    document: d.window.document,
    location: d.window.location,
    storage: { getItem: (k) => store.get(k) ?? null },
    global,
  };
};
const locales = { de: { country: 'DE', language: 'DE' }, 'fr-be': { country: 'BE', language: 'FR', locale: 'fr-BE' } };

test('detect: Webflow locale subdirectory through the locales map', async () => {
  const m = await Tether.detectMarket(); // async: the markets part loads on first use
  assert.equal(m.country, 'DE'); // from the page this file runs on (/de/...)
  const r = (o, mk = { detect: true, locales }) => detectOnly(mk, env(o));
  assert.deepEqual(pick(r({ path: '/fr-be/shop' })), { country: 'BE', language: 'FR', locale: 'fr-BE' });
  assert.deepEqual(pick(r({ path: '/de/shop' })), { country: 'DE', language: 'DE' });
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
  const mk = { detect: true, locales };
  assert.equal(detectOnly(mk, env({ path: '/de/', meta: 'us' })).country, 'US');
  assert.equal(detectOnly(mk, env({ path: '/de/', cookie: 'tether_country=CH' })).country, 'CH');
  assert.equal(detectOnly({ ...mk, cookie: 'cf_country' }, env({ cookie: 'cf_country=BE' })).country, 'BE');
  assert.equal(detectOnly(mk, env({ global: { TETHER_COUNTRY: 'FR' }, meta: 'US' })).country, 'FR');
  const saved = detectOnly(mk, env({ path: '/de/', meta: 'US', saved: { country: 'NL' } }));
  assert.equal(saved.country, 'NL');
  assert.equal(saved.sources.country, 'saved');
  assert.equal(saved.language, 'DE', 'language still from the Webflow locale');
  assert.equal(detectOnly({ ...mk, remember: false }, env({ meta: 'US', saved: { country: 'NL' } })).country, 'US');
});

test('detect: invalid or unknown countries are ignored; off by default; sources can be limited', () => {
  assert.equal(detectOnly({ detect: true }, env({ meta: 'XX' })).country, undefined);
  assert.equal(detectOnly({ detect: true }, env({ cookie: 'tether_country=Germany' })).country, undefined);
  assert.equal(detectOnly(null, env({ meta: 'US' })).country, undefined, 'server hints need detect');
  assert.equal(
    detectOnly(null, env({ meta: 'US', saved: { country: 'BE' } })).country,
    'BE',
    'a saved choice applies without detect',
  );
  assert.deepEqual(detectOnly({ detect: false }, env({ meta: 'US', saved: { country: 'BE' } })), {});
  assert.equal(detectOnly({ detect: ['webflow'], locales }, env({ path: '/de/', meta: 'US' })).country, 'DE');
});

let markets;
const detectOnly = (mk, e) => markets.detectMarket(mk, e);
const pick = ({ country, language, locale }) =>
  Object.fromEntries(Object.entries({ country, language, locale }).filter(([, v]) => v));
before(async () => {
  markets = await import('../src/markets.js');
});

// ---- init + switching --------------------------------------------------------

test('init used the detected market: @inContext DE and the saved NL cart moved to DE', async () => {
  assert.equal(Tether.config.country, 'DE');
  assert.equal(Tether.config.language, 'DE');
  assert.equal(Tether.cart.state.buyerIdentity.countryCode, 'DE');
  document.body.innerHTML = '<div tether-product="coffee-box"><span id="price" tether-bind="price"></span></div>';
  Tether.mount(document);
  await tick();
  const p = calls.find((c) => c.op === 'TetherProducts');
  assert.equal(p.ctx, 'country: DE, language: DE');
});

test('tether-country-select lists the markets; switching re-renders prices and updates the cart', async () => {
  localStorage.removeItem('tether:market:shop.test');
  document.body.innerHTML = `
    <select id="cs" tether-country-select tether-country-label="{name} – {currency}"><option>placeholder</option></select>
    <span id="cur" tether-country-bind="currency"></span>
    <div tether-product="coffee-box"><span id="price" tether-bind="price"></span>
      <div tether-option-list="Size"><button>v</button></div></div>`;
  Tether.mount(document);
  await tick();
  const s = document.getElementById('cs');
  assert.deepEqual(
    [...s.options].map((o) => o.textContent),
    ['Germany – EUR', 'Netherlands – EUR', 'United States – USD'],
  );
  assert.equal(s.value, 'DE');
  assert.equal(document.getElementById('cur').textContent, 'EUR');
  assert.match(document.getElementById('price').textContent, /30/);
  const scope = Tether.getScope(document.getElementById('price'));
  scope.select('Size', '1kg');

  let changed = null;
  document.addEventListener(
    'tether:country-changed',
    (e) => {
      changed = e.detail;
    },
    { once: true },
  );
  calls.length = 0;
  s.value = 'US';
  s.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(80);

  const update = calls.find((c) => c.op === 'Tether_cartBuyerIdentityUpdate');
  assert.equal(update.variables.buyerIdentity.countryCode, 'US');
  assert.equal(update.country, 'US', 'cart mutation sent in the new context');
  assert.equal(Tether.cart.state.buyerIdentity.countryCode, 'US');
  const refetch = calls.find((c) => c.op === 'TetherProducts');
  assert.equal(refetch.country, 'US');
  assert.match(document.getElementById('price').textContent, /\$|USD/);
  assert.match(document.getElementById('price').textContent, /35/);
  assert.equal(Tether.getScope(document.getElementById('price')), scope, 'same scope, updated in place');
  assert.equal(scope.selected.Size, '1kg', 'selection kept');
  assert.equal(document.getElementById('cur').textContent, 'USD');
  assert.equal(changed.country, 'US');
  assert.deepEqual(JSON.parse(localStorage.getItem('tether:market:shop.test')), { country: 'US', language: 'DE' });
});

test('setCountry validates, and does nothing when the country is unchanged', async () => {
  await assert.rejects(Tether.setCountry('Germany'), /Not a country code/);
  calls.length = 0;
  await Tether.setCountry('us');
  assert.ok(!calls.some((c) => c.op === 'TetherProducts' || c.op === 'Tether_cartBuyerIdentityUpdate'));
});

test('a list re-renders in the new market', async () => {
  document.body.innerHTML =
    '<div tether-products=""><div tether-list><div><span class="p" tether-bind="price"></span></div></div></div>';
  Tether.mount(document);
  await tick(80);
  assert.match(document.querySelector('.p').textContent, /35/);
  calls.length = 0;
  await Tether.setCountry('NL', { remember: false });
  await tick(80);
  assert.equal(calls.find((c) => c.op === 'TetherSearch').country, 'NL');
  assert.match(document.querySelector('.p').textContent, /30/);
  assert.equal(document.querySelectorAll('.p').length, 1);
});

test('a slow response from the old market never overwrites the new one or refills the cache', async () => {
  await Tether.setCountry('NL', { remember: false });
  Tether.clearProductCache();
  delays.NL = 120;
  document.body.innerHTML = '<div tether-product="coffee-box"><span id="price" tether-bind="price"></span></div>';
  Tether.mount(document); // NL request in flight (slow)
  await tick(10);
  const switching = Tether.setCountry('US', { remember: false });
  await switching;
  await tick(200); // the NL response has arrived by now
  delete delays.NL;
  assert.match(document.getElementById('price').textContent, /35/);
  const cached = await Tether.getProduct('coffee-box');
  assert.equal(cached.priceRange.minVariantPrice.currencyCode, 'USD', 'cache holds the US product');
});

test('switching country keeps rendered products visible (state "updating", not "loading")', async () => {
  document.body.innerHTML = '<div tether-product="coffee-box"><div id="ready" tether-show="ready">x</div></div>';
  Tether.mount(document);
  await tick();
  delays.DE = 60;
  const p = Tether.setCountry('DE', { remember: false });
  await tick(15); // the markets part loads first
  const root = document.querySelector('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'updating');
  assert.notEqual(document.getElementById('ready').style.display, 'none');
  await p;
  await tick(100);
  delete delays.DE;
  assert.equal(root.getAttribute('tether-state'), 'ready');
});

test('an expired saved cart is dropped on a country switch, not replaced by a new empty cart', async () => {
  localStorage.setItem('tether:cart:shop.test', 'gid://shopify/Cart/expired');
  calls.length = 0;
  await Tether.setCountry('BE', { remember: false });
  assert.ok(calls.some((c) => c.op === 'Tether_cartBuyerIdentityUpdate'));
  assert.ok(!calls.some((c) => c.op === 'Tether_cartCreate'));
  assert.equal(Tether.cart.id(), null);
});

test('no request ever leaves for anything but the Storefront API (no IP lookups)', () => {
  assert.deepEqual([...hosts], ['shop.test']);
});

test('setCountry: the money format follows the country (option or markets.locales), and is remembered', async () => {
  Tether.config.markets.locales = { de: { country: 'DE', language: 'DE', locale: 'de-DE' } };
  await Tether.setCountry('DE', { language: null });
  assert.equal(Tether.config.locale, 'de-DE');
  assert.equal(JSON.parse(localStorage.getItem('tether:market:shop.test')).locale, 'de-DE');
  await Tether.setCountry('NL', { locale: 'nl-NL', language: null });
  assert.equal(Tether.config.locale, 'nl-NL');
});

test('tether-countries limits a country select to your list, in your order', async () => {
  document.body.innerHTML = '<select id="cs2" tether-country-select tether-countries="NL, DE"></select>';
  Tether.mount(document);
  await tick(80);
  assert.deepEqual(
    [...document.getElementById('cs2').options].map((o) => o.value),
    ['NL', 'DE'],
  );
});

test('page market: <meta name="tether-page-country"> pages switch on View Transitions, and back again', async () => {
  await Tether.setCountry('NL', { language: null, remember: false });
  document.head.innerHTML =
    '<meta name="tether-page-country" content="DE"><meta name="tether-page-language" content="DE"><meta name="tether-page-locale" content="de-DE">';
  document.body.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await tick(80);
  assert.equal(Tether.config.country, 'DE');
  assert.equal(Tether.config.language, 'DE');
  assert.equal(Tether.config.locale, 'de-DE');
  document.head.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await tick(80);
  assert.notEqual(Tether.config.language, 'DE', 'left the German page');
});

test('page market: leaving a market page, a saved market that is not valid falls back to the configured one', async () => {
  await Tether.setCountry('NL', { language: null, remember: false });
  document.head.innerHTML = '<meta name="tether-page-country" content="DE">';
  document.body.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await tick(80);
  assert.equal(Tether.config.country, 'DE');
  localStorage.setItem('tether:market:shop.test', JSON.stringify({ country: 'not a country' }));
  document.head.innerHTML = '';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await tick(80);
  assert.equal(Tether.config.country, 'NL', 'the configured market');
  localStorage.removeItem('tether:market:shop.test');
});

test('readSavedMarket: a valid saved market, normalized; junk and other scripts’ values are rejected', () => {
  const storageWith = (text) => ({ getItem: (key) => (key === 'tether:market:shop.test' ? text : null) });
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
  assert.equal(markets.readSavedMarket(null), null, 'storage blocked');
  assert.equal(detectOnly(null, env({ saved: { country: 'Germany', language: 'DE' } })).country, undefined);
});

test('detect: a single source name or an unknown one in detect is tolerated', () => {
  assert.equal(detectOnly({ detect: 'server' }, env({ meta: 'US' })).country, 'US');
  assert.deepEqual(detectOnly({ detect: ['nope'] }, env({ meta: 'US' })), { sources: {} });
});
