import assert from 'node:assert/strict';
import { asRecord, listAt, numberAt, parseJson, recordAt, recordsAt, stringAt } from '../server/test/mocks.js';
import { isTetherInternals } from '../src/part-registry.ts';

/**
 * @param {number | string} amount
 * @returns {import('../src/shopify-values.ts').Money}
 */
const money = (amount, currencyCode = 'EUR') => ({ amount: String(amount), currencyCode });

export const PLAN_MONTH = 'gid://shopify/SellingPlan/111';
export const PLAN_2MONTH = 'gid://shopify/SellingPlan/222';

/**
 * @param {string} planId
 * @param {number} price
 * @returns {import('../src/fragments.ts').SellingPlanAllocation}
 */
const allocation = (planId, price) => ({
  sellingPlan: { id: planId },
  checkoutChargeAmount: money(price),
  remainingBalanceChargeAmount: money(0),
  priceAdjustments: [
    { price: money(price), compareAtPrice: money(30), perDeliveryPrice: money(price), unitPrice: null },
  ],
});

/**
 * @param {number} id
 * @param {string} size
 * @param {import('../src/fragments.ts').SellingPlanAllocation[]} allocations
 * @returns {import('../src/fragments.ts').ProductVariant}
 */
const variant = (id, size, allocations, available = true) => ({
  id: `gid://shopify/ProductVariant/${id}`,
  title: size,
  availableForSale: available,
  currentlyNotInStock: false,
  quantityAvailable: 10,
  sku: `SKU-${id}`,
  barcode: null,
  selectedOptions: [{ name: 'Size', value: size }],
  image: null,
  price: money(30),
  compareAtPrice: null,
  unitPrice: null,
  sellingPlanAllocations: { nodes: allocations },
});

/** @type {import('../src/fragments.ts').Product} */
export const product = {
  id: 'gid://shopify/Product/1',
  handle: 'coffee-box',
  title: 'Coffee Box',
  description: 'Fresh beans',
  descriptionHtml: '<p>Fresh beans</p>',
  productType: 'Coffee',
  vendor: 'Test',
  tags: ['coffee', 'hidden'],
  availableForSale: true,
  publishedAt: '2026-01-01T00:00:00Z',
  onlineStoreUrl: null,
  requiresSellingPlan: false,
  seo: { title: null, description: null },
  featuredImage: { url: 'https://cdn.shopify.com/a.jpg', altText: null, width: 10, height: 10 },
  images: { nodes: [{ url: 'https://cdn.shopify.com/a.jpg', altText: null, width: 10, height: 10 }] },
  options: [
    {
      name: 'Size',
      optionValues: [
        { name: '250g', swatch: null },
        { name: '1kg', swatch: null },
      ],
    },
  ],
  priceRange: { minVariantPrice: money(30), maxVariantPrice: money(30) },
  compareAtPriceRange: { minVariantPrice: money(0), maxVariantPrice: money(0) },
  metafields: [
    { namespace: 'custom', key: 'origin', type: 'single_line_text_field', value: 'Ethiopia', reference: null },
  ],
  sellingPlanGroups: {
    nodes: [
      {
        name: 'Subscribe & save',
        appName: 'Shopify Subscriptions',
        options: [{ name: 'Delivery every', values: ['1 month', '2 months'] }],
        sellingPlans: {
          nodes: [
            {
              id: PLAN_MONTH,
              name: 'Every month',
              description: null,
              recurringDeliveries: true,
              options: [{ name: 'Delivery every', value: '1 month' }],
              priceAdjustments: [
                {
                  orderCount: null,
                  adjustmentValue: { __typename: 'SellingPlanPercentagePriceAdjustment', adjustmentPercentage: 10 },
                },
              ],
            },
            {
              id: PLAN_2MONTH,
              name: 'Every 2 months',
              description: null,
              recurringDeliveries: true,
              options: [{ name: 'Delivery every', value: '2 months' }],
              priceAdjustments: [
                {
                  orderCount: null,
                  adjustmentValue: { __typename: 'SellingPlanPercentagePriceAdjustment', adjustmentPercentage: 5 },
                },
              ],
            },
          ],
        },
      },
    ],
  },
  variants: {
    nodes: [
      variant(10, '250g', [allocation(PLAN_MONTH, 27), allocation(PLAN_2MONTH, 28.5)]),
      // 1kg is only on the 2-month plan
      variant(20, '1kg', [allocation(PLAN_2MONTH, 28.5)]),
    ],
  },
};

/**
 * A line a fake Storefront API keeps: what a cart mutation sent for it.
 *
 * @typedef {{ merchandiseId: string, quantity: number, sellingPlanId?: string | null,
 *   attributes?: import('../src/cart/store.ts').Attribute[] }} FakeLine
 */

/**
 * A line as a cart mutation sent it (a `CartLineInput`), checked field by field.
 *
 * @param {unknown} value
 * @param {string} what Names the line in a failure.
 * @returns {FakeLine}
 */
export function fakeLine(value, what = 'the line') {
  const sent = asRecord(value, what);
  /** @type {FakeLine} */
  const line = { merchandiseId: stringAt(sent, 'merchandiseId'), quantity: numberAt(sent, 'quantity') };
  if ('sellingPlanId' in sent)
    line.sellingPlanId = sent['sellingPlanId'] === null ? null : stringAt(sent, 'sellingPlanId');
  if ('attributes' in sent) line.attributes = attributesAt(sent, 'attributes');
  return line;
}

/**
 * @param {unknown} value An object.
 * @param {string} key Its list of attributes, as a cart mutation sends them.
 * @returns {import('../src/cart/store.ts').Attribute[]}
 */
export const attributesAt = (value, key) =>
  recordsAt(value, key).map((attribute) => ({ key: stringAt(attribute, 'key'), value: stringAt(attribute, 'value') }));

/**
 * @param {unknown} value An object.
 * @param {string} key Its list of lines.
 */
export const linesAt = (value, key) => listAt(value, key).map((line, i) => fakeLine(line, `${key}[${i}]`));

/**
 * @param {FakeLine[]} lines
 * @returns {import('../src/cart/store.ts').ShopifyCart}
 */
export function cartFrom(lines) {
  const total = lines.reduce((sum, line) => sum + line.quantity * (line.sellingPlanId ? 27 : 30), 0);
  return {
    id: 'gid://shopify/Cart/abc',
    checkoutUrl: 'https://shop.test/checkout/abc',
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    note: null,
    createdAt: '',
    updatedAt: '',
    attributes: [],
    buyerIdentity: { countryCode: 'NL', email: null },
    discountCodes: [],
    cost: { subtotalAmount: money(total), totalAmount: money(total), checkoutChargeAmount: money(total) },
    lines: {
      nodes: lines.map((line, i) => ({
        id: `gid://shopify/CartLine/${i + 1}`,
        quantity: line.quantity,
        attributes: line.attributes ?? [],
        cost: {
          totalAmount: money(line.quantity * (line.sellingPlanId ? 27 : 30)),
          subtotalAmount: money(line.quantity * 30),
          amountPerQuantity: money(line.sellingPlanId ? 27 : 30),
          compareAtAmountPerQuantity: null,
        },
        discountAllocations: [],
        sellingPlanAllocation: line.sellingPlanId
          ? {
              sellingPlan: {
                id: line.sellingPlanId,
                name: 'Every month',
                description: null,
                recurringDeliveries: true,
                options: [],
              },
              checkoutChargeAmount: money(27),
              priceAdjustments: [{ price: money(27), compareAtPrice: money(30), perDeliveryPrice: money(27) }],
            }
          : null,
        merchandise: {
          id: line.merchandiseId,
          title: '250g',
          sku: 'SKU-10',
          availableForSale: true,
          requiresShipping: true,
          image: null,
          price: money(30),
          compareAtPrice: null,
          selectedOptions: [{ name: 'Size', value: '250g' }],
          product: {
            id: product.id,
            title: product.title,
            handle: product.handle,
            vendor: 'Test',
            featuredImage: null,
          },
        },
      })),
    },
  };
}

/**
 * @param {number} id
 * @param {string} size
 * @param {string} color
 * @param {Partial<import('../src/fragments.ts').ProductVariant>} [overrides]
 * @returns {import('../src/fragments.ts').ProductVariant}
 */
const apparelVariant = (id, size, color, overrides = {}) => ({
  ...variant(id, `${size} / ${color}`, []),
  selectedOptions: [
    { name: 'Size', value: size },
    { name: 'Color', value: color },
  ],
  ...overrides,
});

// Two options, no plans: S/Red is sold out, M/Blue doesn't exist, S/Blue is on sale and low in stock, M/Red is on
// backorder.
/** @type {import('../src/fragments.ts').Product} */
export const apparel = {
  ...product,
  id: 'gid://shopify/Product/2',
  handle: 'tee',
  title: 'Tee',
  options: [
    {
      name: 'Size',
      optionValues: [
        { name: 'S', swatch: null },
        { name: 'M', swatch: null },
      ],
    },
    {
      name: 'Color',
      optionValues: [
        { name: 'Red', swatch: { color: '#f00', image: null } },
        { name: 'Blue', swatch: { color: '#00f', image: null } },
      ],
    },
  ],
  sellingPlanGroups: { nodes: [] },
  variants: {
    nodes: [
      apparelVariant(31, 'S', 'Red', { availableForSale: false, quantityAvailable: 0 }),
      apparelVariant(32, 'S', 'Blue', { quantityAvailable: 2, price: money('19.99'), compareAtPrice: money('25.5') }),
      apparelVariant(33, 'M', 'Red', { currentlyNotInStock: true, quantityAvailable: 0 }),
    ],
  },
};

/**
 * Keeps Tether's own console warnings (`[tether] …`, which every reported failure logs) out of the test output, for a
 * file whose tests cause failures on purpose and check them through `onError`, states and events. Other warnings
 * still print.
 *
 * @returns {unknown[][]} The captured warnings' arguments, for a test that checks one.
 */
export function captureTetherWarnings() {
  /** @type {unknown[][]} */
  const captured = [];
  const { warn } = console;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && /^\[[a-z][a-z0-9-]*\]$/.test(args[0])) captured.push(args);
    else warn(...args);
  };
  return captured;
}

/**
 * The globals a test sets from a jsdom window, for the browser modules it imports.
 *
 * @param {import('jsdom').DOMWindow} window
 */
export const pageGlobals = (window) => ({
  window,
  document: window.document,
  localStorage: window.localStorage,
  CustomEvent: window.CustomEvent,
  MutationObserver: window.MutationObserver,
  /** @type {unknown} jsdom's window type leaves `Option` to an index signature; the DOM library types the global. */
  Option: window['Option'],
  getComputedStyle: window.getComputedStyle,
});

/**
 * @param {import('jsdom').DOMWindow} window
 * @returns {unknown} The `window.Tether` a script on the page set, which jsdom's window type leaves to an index signature.
 */
const tetherOf = (window) => window['Tether'];

/**
 * The parts a page's core script has registered so far.
 *
 * @param {import('jsdom').DOMWindow} window
 * @returns {Partial<import('../src/lazy.ts').Parts> | undefined} `undefined` until the core script has run.
 */
export function partsOf(window) {
  const tether = tetherOf(window);
  return isTetherInternals(tether) ? tether.__parts : undefined;
}

/**
 * The built core script is this source, so a `window.Tether` with the core's internals and its API is the core's.
 *
 * @param {unknown} value
 * @returns {value is import('../src/index.ts').Tether & import('../src/lazy.ts').TetherInternals}
 */
const isCoreTether = (value) => isTetherInternals(value) && typeof Reflect.get(value, 'diagnose') === 'function';

/**
 * @param {import('jsdom').DOMWindow} window A page the built core script ran on.
 * @returns The `window.Tether` it set up.
 */
export function builtTether(window) {
  const tether = tetherOf(window);
  assert.ok(isCoreTether(tether), "window.Tether is the core script's");
  return tether;
}

/**
 * @param {unknown} body Sent as JSON.
 * @param {number} [status]
 */
export const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * The GraphQL request a fake Storefront API received.
 *
 * @param {RequestInit | undefined} init The fetch's options.
 * @returns {{ query: string; variables: Record<string, unknown> }}
 */
export function graphqlRequest(init) {
  assert.ok(typeof init?.body === 'string', 'a GraphQL request has a JSON body');
  const request = parseJson(init.body);
  return { query: stringAt(request, 'query'), variables: recordAt(request, 'variables') };
}

/**
 * @param {string} query A GraphQL document.
 * @returns {string} The name of its operation.
 */
export function operationName(query) {
  const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
  assert.ok(name, 'the operation has a name');
  return name;
}

/**
 * @param {Event} event One of Tether's events, which are `CustomEvent`s of the page's window.
 * @returns {Record<string, unknown>} Its detail, which is an object for every Tether event.
 */
export function detailOf(event) {
  assert.ok(event instanceof CustomEvent, `${event.type} is a CustomEvent`);
  /** @type {unknown} */
  const detail = event.detail;
  return asRecord(detail, `the ${event.type} detail`);
}

/**
 * @param {Element} element
 * @returns {element is HTMLElement} True for an HTML element of the element's own window.
 */
const isHtmlElement = (element) => {
  const view = element.ownerDocument.defaultView;
  return view !== null && element instanceof view.HTMLElement;
};

/**
 * The HTML element `selector` finds in `root`; the test fails when there is none.
 *
 * @param {string} selector
 * @param {ParentNode} [root]
 */
export function find(selector, root = document) {
  const element = root.querySelector(selector);
  assert.ok(element, `nothing matches ${selector}`);
  assert.ok(isHtmlElement(element), `${selector} is not an HTML element`);
  return element;
}

/**
 * The HTML elements `selector` finds in `root`; the test fails when one is not an HTML element.
 *
 * @param {string} selector
 * @param {ParentNode} [root]
 */
export function findAll(selector, root = document) {
  return [...root.querySelectorAll(selector)].map((element) => {
    assert.ok(isHtmlElement(element), `${selector} is not an HTML element`);
    return element;
  });
}
