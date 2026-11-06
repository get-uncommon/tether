// The page the browser-side tests share: jsdom globals, a fake Storefront API with a saved cart, and Tether
// initialised for the NL market before each file's tests, with the call log and price reset before each test.
import { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  captureTetherWarnings,
  cartFrom,
  graphqlRequest,
  jsonResponse,
  linesAt,
  operationName,
  product,
} from './fixtures.js';
import { numberAt, recordAt, recordsAt, stringAt, waitFor } from '../server/test/mocks.js';

// The failures these tests cause on purpose are checked through onError, states and events, not the console.
captureTetherWarnings();

const [first] = product.variants.nodes;
assert.ok(first);
export const firstVariant = first;
export const firstVariantId = first.id;

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://astro.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window['Option'],
  getComputedStyle: dom.window.getComputedStyle,
});

/** @typedef {import('../src/cart/store.ts').ShopifyCart} ShopifyCart */
/** @typedef {import('../src/fragments.ts').Product} Product */
/** @typedef {Parameters<Parameters<typeof import('../src/cart/store.ts').subscribe>[0]>[1]} CartMeta */

/** @type {(ReturnType<typeof graphqlRequest> & { op: string })[]} */
export const calls = [];
/**
 * The cart "Shopify" has for the saved id: `seedCart` sets it.
 *
 * @type {ShopifyCart | null}
 */
let savedCart = null;
/** What "Shopify" returns now: the server-rendered copy may be older. */
let livePrice = '30';
/** @param {string} amount */
export const setLivePrice = (amount) => {
  livePrice = amount;
};
/**
 * @param {Product} sent
 * @param {string} amount
 * @returns {Product}
 */
const withPrice = (sent, amount) => JSON.parse(JSON.stringify(sent).replace(/"amount":"30"/g, `"amount":"${amount}"`));
/** @type {typeof globalThis.fetch} */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, query, variables });
  /** @param {unknown} data */
  const ok = (data) => jsonResponse({ data });
  if (op === 'TetherProducts') {
    /** @type {Record<string, Product | null>} */
    const data = {};
    Object.keys(variables).forEach((key) => {
      if (key.startsWith('h')) data[key] = variables[key] === product.handle ? withPrice(product, livePrice) : null;
    });
    return ok(data);
  }
  if (op === 'TetherServerProduct')
    return ok({ product: variables['handle'] === product.handle ? withPrice(product, livePrice) : null });
  if (op === 'TetherServerProductById') return ok({ node: variables['id'] === product.id ? product : null });
  if (op === 'TetherServerProducts') {
    const all = Array.from({ length: 5 }, (_, i) => ({
      ...product,
      id: `gid://shopify/Product/${i + 1}`,
      handle: `p-${i + 1}`,
    }));
    const start = variables['after'] ? Number(variables['after']) : 0;
    const page = all.slice(start, start + numberAt(variables, 'first'));
    return ok({
      products: {
        nodes: page,
        pageInfo: { hasNextPage: start + page.length < all.length, endCursor: String(start + page.length) },
      },
    });
  }
  if (op === 'TetherPredictive')
    return ok({
      predictiveSearch: {
        products: stringAt(variables, 'q').startsWith('cof')
          ? [
              {
                id: product.id,
                handle: product.handle,
                title: product.title,
                availableForSale: true,
                featuredImage: null,
                priceRange: product.priceRange,
              },
            ]
          : [],
        collections: [],
        queries: stringAt(variables, 'q').startsWith('cof') ? [{ text: 'coffee beans' }] : [],
      },
    });
  if (op === 'TetherSearch') return ok({ products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
  if (op === 'TetherCart') return ok({ cart: variables['id'] === savedCart?.id ? savedCart : null });
  if (op === 'Tether_cartCreate')
    return ok({ cartCreate: { cart: cartFrom(linesAt(recordAt(variables, 'input'), 'lines')), userErrors: [] } });
  if (op === 'Tether_cartLinesAdd')
    return ok({
      cartLinesAdd: {
        cart: cartFrom([...linesAt(variables, 'lines'), ...linesAt(variables, 'lines')]),
        userErrors: [],
      },
    });
  if (op === 'Tether_cartLinesUpdate') {
    await new Promise((resolve) => setTimeout(resolve, 30)); // a slow network, so clicks overlap
    const [update] = recordsAt(variables, 'lines');
    assert.ok(update);
    const cart = cartFrom([{ merchandiseId: firstVariantId, quantity: numberAt(update, 'quantity') }]);
    const [line] = cart.lines.nodes;
    assert.ok(line);
    line.id = stringAt(update, 'id');
    return ok({ cartLinesUpdate: { cart, userErrors: [] } });
  }
  throw new Error(`unexpected ${op}`);
};

/**
 * Starts the page with `cart` saved, as a visitor coming back to it.
 *
 * @param {ShopifyCart} cart
 */
export async function seedCart(cart) {
  savedCart = cart;
  window.localStorage.setItem(cfg.storageKey, cart.id);
  await Tether.cart.init();
}

/** For a check that nothing more happens: a request that shouldn't go out leaves no condition to wait for. */
export const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until the first `selector` on the page has rendered. */
export const rendered = (selector = '[tether-product]') =>
  waitFor(() => document.querySelector(selector)?.getAttribute('tether-state') === 'ready', `${selector} to render`);
/** The scope of the first product on the page, which the test has rendered. */
export function productScope() {
  const scope = Tether.getScope(document.querySelector('[tether-product]'));
  assert.ok(scope, 'a rendered product');
  return scope;
}
/**
 * @param {unknown} value
 * @param {string} name
 * @returns {unknown} The field `name` of `value`, `undefined` when `value` isn't an object.
 */
export function fieldOf(value, name) {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}
/** @type {typeof import('../src/index.ts').default} */
export let Tether;
/** @type {typeof import('../src/server.ts')} */
export let server;
/**
 * The live config: `Tether.config` is a read-only view of it.
 *
 * @type {import('../src/config.ts').TetherConfig}
 */
export let cfg;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  ({ cfg } = await import('../src/config.ts'));
  server = await import('../src/server.ts');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL' });
});
beforeEach(() => {
  calls.length = 0;
  livePrice = '30';
  Tether.clearProductCache();
});
