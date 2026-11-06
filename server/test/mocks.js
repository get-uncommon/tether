// In-memory fake Shopify Admin API + Webflow Data API v2 behind one fetch().
import assert from 'node:assert/strict';
import { isRecord } from '../src/shared/json.ts';

// Readers for the parsed JSON a fake receives or a store holds, which is `unknown`: each asserts the shape the test
// reads, so a request of the wrong shape fails the test where it is read instead of reading as `undefined`.

/**
 * @param {unknown} value
 * @param {string} what Names the value in the failure.
 * @returns {Record<string, unknown>}
 */
export function asRecord(value, what) {
  assert.ok(isRecord(value), `${what} is an object`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} what Names the value in the failure.
 * @returns {unknown[]}
 */
export function asList(value, what) {
  assert.ok(Array.isArray(value), `${what} is a list`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} what Names the value in the failure.
 */
export function asString(value, what) {
  assert.ok(typeof value === 'string', `${what} is a string`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} what Names the value in the failure.
 */
export function asNumber(value, what) {
  assert.ok(typeof value === 'number', `${what} is a number`);
  return value;
}

/**
 * @param {unknown} value An object.
 * @param {string} key
 * @returns {unknown} Its field `key`.
 */
export const fieldOf = (value, key) => asRecord(value, `the object with ${key}`)[key];

/** @param {unknown} value An object. @param {string} key */
export const recordAt = (value, key) => asRecord(fieldOf(value, key), key);
/** @param {unknown} value An object. @param {string} key */
export const listAt = (value, key) => asList(fieldOf(value, key), key);
/** @param {unknown} value An object. @param {string} key */
export const stringAt = (value, key) => asString(fieldOf(value, key), key);
/** @param {unknown} value An object. @param {string} key */
export const numberAt = (value, key) => asNumber(fieldOf(value, key), key);
/** @param {unknown} value An object. @param {string} key A list of objects. */
export const recordsAt = (value, key) => listAt(value, key).map((item, i) => asRecord(item, `${key}[${i}]`));

/**
 * @param {RequestInfo | URL} input What a fake `fetch` was called with.
 * @returns {string} The URL it asks for.
 */
export const urlOf = (input) => (input instanceof Request ? input.url : String(input));

/**
 * @param {number} number Numbers the product's ids, handle and title.
 * @param {Record<string, unknown>} [over] Fields that replace the defaults.
 */
export function shopifyProduct(number, over = {}) {
  return {
    id: `gid://shopify/Product/${number}`,
    legacyResourceId: String(number),
    handle: `product-${number}`,
    title: `Product ${number}`,
    description: 'Desc',
    descriptionHtml: '<p>Desc</p>',
    vendor: 'Acme',
    productType: 'Coffee',
    tags: ['a', 'b'],
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: `2026-11-01T00:00:${String(number).padStart(2, '0')}Z`,
    publishedAt: '2026-01-01T00:00:00Z',
    onlineStoreUrl: null,
    seo: { title: null, description: null },
    priceRangeV2: {
      minVariantPrice: { amount: '12.5', currencyCode: 'EUR' },
      maxVariantPrice: { amount: '20.0', currencyCode: 'EUR' },
    },
    compareAtPriceRange: {
      minVariantCompareAtPrice: { amount: '15.0', currencyCode: 'EUR' },
      maxVariantCompareAtPrice: { amount: '15.0', currencyCode: 'EUR' },
    },
    featuredMedia: { preview: { image: { url: `https://cdn.test/${number}.jpg`, altText: 'alt' } } },
    media: {
      nodes: [
        { mediaContentType: 'IMAGE', preview: { image: { url: `https://cdn.test/${number}.jpg`, altText: 'alt' } } },
      ],
    },
    options: [{ name: 'Size', optionValues: [{ name: 'S' }] }],
    variants: {
      nodes: [
        {
          id: `gid://shopify/ProductVariant/${number}0`,
          legacyResourceId: `${number}0`,
          title: 'S',
          sku: `SKU${number}`,
          price: '12.5',
          compareAtPrice: '15.0',
          availableForSale: true,
        },
      ],
    },
    mf0: { value: 'Oak', type: 'single_line_text_field' },
    ...over,
  };
}

/** @typedef {ReturnType<typeof shopifyProduct>} MockProduct */
/**
 * @typedef {{ id: string, isArchived?: boolean | undefined, isDraft?: boolean | undefined,
 *   fieldData: Record<string, unknown> }} MockItem
 */
/** @typedef {{ products: Map<string, MockProduct>, webhooks: { id: string, topic: string, uri: string }[] }} MockShop */
/** @typedef {{ items: Map<string, MockItem>, live: Set<string>, nextId: number }} MockWebflow */

/**
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
const json = (status, body, headers = {}) =>
  new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * @param {unknown} body A request body.
 * @param {string} key A flag the body may set.
 */
function flagAt(body, key) {
  const value = fieldOf(body, key);
  assert.ok(value === undefined || typeof value === 'boolean', `${key} is a boolean`);
  return value;
}

/**
 * @param {MockShop} shop
 * @param {Record<string, unknown>} variables
 */
function productsPage(shop, variables) {
  let list = [...shop.products.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const search = variables['query'];
  const updatedSince = typeof search === 'string' ? /updated_at:>='([^']+)'/.exec(search)?.[1] : undefined;
  if (updatedSince) list = list.filter((product) => product.updatedAt >= updatedSince);
  const start = variables['after'] ? Number(variables['after']) : 0;
  const page = list.slice(start, start + numberAt(variables, 'first'));
  const end = start + page.length;
  return json(200, {
    data: { products: { nodes: page, pageInfo: { hasNextPage: end < list.length, endCursor: String(end) } } },
  });
}

/**
 * The Admin GraphQL API, by operation name.
 * @param {MockShop} shop
 * @param {unknown} body
 * @param {number} maxFirst
 */
function answerShopify(shop, body, maxFirst) {
  const op = /(?:query|mutation)\s+(\w+)/.exec(stringAt(body, 'query'))?.[1];
  const variables = asRecord(fieldOf(body, 'variables') ?? {}, 'variables');
  if (op === 'TetherSyncWebhooks') return json(200, { data: { webhookSubscriptions: { nodes: shop.webhooks } } });
  if (op === 'TetherSyncWebhookCreate') {
    const webhook = {
      id: `gid://shopify/WebhookSubscription/${shop.webhooks.length + 1}`,
      topic: stringAt(variables, 'topic'),
      uri: stringAt(recordAt(variables, 'sub'), 'uri'),
    };
    shop.webhooks.push(webhook);
    return json(200, { data: { webhookSubscriptionCreate: { webhookSubscription: webhook, userErrors: [] } } });
  }
  if (op === 'TetherSyncGetProduct')
    return json(200, { data: { product: shop.products.get(stringAt(variables, 'id')) ?? null } });
  if (op === 'TetherSyncShop')
    return json(200, { data: { shop: { name: 'Shop', myshopifyDomain: 'shop.myshopify.com' } } });
  if (op === 'TetherSyncProducts' && numberAt(variables, 'first') > maxFirst) {
    return json(200, {
      errors: [
        {
          message: 'Query cost is 1500, which exceeds the single query max cost limit (1000).',
          extensions: { code: 'MAX_COST_EXCEEDED' },
        },
      ],
    });
  }
  if (op === 'TetherSyncProducts') return productsPage(shop, variables);
  throw new Error(`unexpected Shopify op ${op}`);
}

const COLLECTION = {
  id: 'col',
  displayName: 'Products',
  fields: [
    { slug: 'name', type: 'PlainText', isRequired: true },
    { slug: 'slug', type: 'PlainText', isRequired: true },
    { slug: 'shopify-id', type: 'PlainText' },
    { slug: 'price', type: 'Number' },
    { slug: 'main-image', type: 'Image' },
    { slug: 'description', type: 'RichText' },
    { slug: 'material', type: 'PlainText' },
  ],
};

/**
 * POST /items.
 * @param {MockWebflow} wf
 * @param {unknown} body
 * @param {string | null} failCreateFor The slug whose create fails validation.
 */
function createItem(wf, body, failCreateFor) {
  const fieldData = recordAt(body, 'fieldData');
  if (failCreateFor && fieldData['slug'] === failCreateFor)
    return json(400, { message: 'Validation Error', details: [{ param: 'name' }] });
  // Webflow slugs are unique within a collection.
  if ([...wf.items.values()].some((item) => item.fieldData['slug'] === fieldData['slug'])) {
    return json(409, {
      message: 'Conflict',
      details: [{ param: 'slug', description: 'Unique value is already in database' }],
    });
  }
  const id = `item${wf.nextId++}`;
  const item = { id, isArchived: flagAt(body, 'isArchived'), isDraft: flagAt(body, 'isDraft'), fieldData };
  wf.items.set(id, item);
  return json(202, item);
}

/**
 * GET, PATCH or DELETE /items/{id}.
 * @param {MockWebflow} wf
 * @param {string} itemId
 * @param {string} method
 * @param {unknown} body
 */
function answerItem(wf, itemId, method, body) {
  const item = wf.items.get(itemId);
  if (!item) return json(404, { message: 'Item not found' });
  if (method === 'GET') return json(200, item);
  if (method === 'PATCH') {
    const patch = asRecord(body, 'the PATCH body');
    if ('isArchived' in patch) item.isArchived = flagAt(body, 'isArchived');
    if ('isDraft' in patch) item.isDraft = flagAt(body, 'isDraft');
    Object.assign(item.fieldData, asRecord(patch['fieldData'] ?? {}, 'fieldData'));
    return json(200, item);
  }
  if (method === 'DELETE') {
    wf.items.delete(itemId);
    return json(204, null);
  }
  return null;
}

/**
 * The Webflow Data API's collection routes.
 * @param {{ wf: MockWebflow, failCreateFor: string | null, failPublish: boolean }} state
 * @param {URL} target
 * @param {string} method
 * @param {unknown} body
 */
function answerWebflow({ wf, failCreateFor, failPublish }, target, method, body) {
  const path = target.pathname.replace(/^\/v2\/collections\/[^/]+/, '');
  if (path === '' && method === 'GET') return json(200, COLLECTION);
  if (path === '/items' && method === 'GET') {
    const all = [...wf.items.values()];
    const offset = Number(target.searchParams.get('offset') || 0);
    const limit = Number(target.searchParams.get('limit') || 100);
    return json(200, { items: all.slice(offset, offset + limit), pagination: { limit, offset, total: all.length } });
  }
  if (path === '/items' && method === 'POST') return createItem(wf, body, failCreateFor);
  if (path === '/items/publish' && method === 'POST') {
    if (failPublish) return json(500, { message: 'publish failed' });
    const itemIds = listAt(body, 'itemIds').map((id, i) => asString(id, `itemIds[${i}]`));
    itemIds.forEach((id) => wf.live.add(id));
    return json(202, { publishedItemIds: itemIds, errors: [] });
  }
  const liveId = /^\/items\/([^/]+)\/live$/.exec(path)?.[1];
  if (liveId && method === 'DELETE') {
    if (!wf.live.has(liveId)) return json(404, { message: 'not live' });
    wf.live.delete(liveId);
    return json(204, null);
  }
  const itemId = /^\/items\/([^/]+)$/.exec(path)?.[1];
  const answer = itemId ? answerItem(wf, itemId, method, body) : null;
  if (answer) return answer;
  throw new Error(`unexpected Webflow ${method} ${path}`);
}

/**
 * @param {{ products?: MockProduct[], items?: MockItem[], failCreateFor?: string | null, rateLimitOnce?: boolean,
 *   maxFirst?: number }} [options]
 */
export function createMockApis({
  products = [],
  items = [],
  failCreateFor = null,
  rateLimitOnce = false,
  maxFirst = Infinity,
} = {}) {
  /** @type {MockShop} */
  const shop = { products: new Map(products.map((product) => [product.id, product])), webhooks: [] };
  /** @type {MockWebflow} */
  const wf = { items: new Map(items.map((item) => [item.id, item])), live: new Set(), nextId: 1 };
  /** @type {{ host: string, method: string, path: string, body: unknown, headers: HeadersInit | undefined }[]} */
  const calls = [];
  let limited = !rateLimitOnce;
  const flags = { failPublish: false };

  /**
   * @param {RequestInfo | URL} url
   * @param {RequestInit} [init]
   */
  async function fetch(url, init = {}) {
    const target = new URL(urlOf(url));
    const method = init.method || 'GET';
    /** @type {unknown} A JSON body parsed, any other body as sent. */
    const body =
      init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    calls.push({ host: target.host, method, path: target.pathname + target.search, body, headers: init.headers });

    if (target.pathname === '/admin/oauth/access_token')
      return json(200, { access_token: 'shpat_fresh', scope: 'read_products', expires_in: 86399 });
    if (target.pathname.startsWith('/admin/api/')) return answerShopify(shop, body, maxFirst);
    if (target.host === 'api.webflow.com') {
      if (!limited) {
        limited = true;
        return json(429, { message: 'Too Many Requests' }, { 'retry-after': '2' });
      }
      return answerWebflow({ wf, failCreateFor, failPublish: flags.failPublish }, target, method, body);
    }
    throw new Error(`unexpected fetch ${target.href}`);
  }

  const webflowWrites = () => calls.filter((call) => call.host === 'api.webflow.com' && call.method !== 'GET');
  return { fetch, shop, wf, calls, webflowWrites, flags };
}

/** @type {import('../src/mapping.ts').RawConfig} */
export const baseConfig = {
  shopify: { domain: 'shop.myshopify.com' },
  webflow: { collectionId: 'col', perMinute: 0 },
  fields: {
    name: 'title',
    slug: 'handle',
    price: 'price',
    'main-image': 'image',
    description: 'descriptionHtml',
    material: 'metafield:custom.material',
  },
  webflowOwned: ['description'],
};

export const env = { SHOPIFY_ADMIN_TOKEN: 'shpat_test', WEBFLOW_TOKEN: 'wf_test', SHOPIFY_WEBHOOK_SECRET: 'whsec' };
export const instantSleep = async () => {};

/** A Worker context for requests that hand nothing to `waitUntil`. */
export const noWaitUntil = {
  waitUntil() {
    throw new Error('unexpected waitUntil');
  },
};

/**
 * @param {{ steps: import('../src/check/steps.ts').CheckStep[] }} report A `/check` report.
 * @param {string} title
 */
export function checkStep(report, title) {
  const step = report.steps.find((candidate) => candidate.title === title);
  assert.ok(step, `no "${title}" step`);
  return step;
}

/**
 * Waits until `condition` holds, for work that finishes on its own schedule (a lazy import, a timed write), instead of
 * sleeping a fixed time that a busy machine can overrun.
 *
 * @param {() => boolean} condition
 * @param {string} what Named in the failure when it never holds.
 */
export async function waitFor(condition, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
