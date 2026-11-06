// In-memory fake Shopify Admin API + Webflow Data API v2 behind one fetch().

export function shopifyProduct(n, over = {}) {
  return {
    id: `gid://shopify/Product/${n}`,
    legacyResourceId: String(n),
    handle: `product-${n}`,
    title: `Product ${n}`,
    description: 'Desc',
    descriptionHtml: '<p>Desc</p>',
    vendor: 'Acme',
    productType: 'Coffee',
    tags: ['a', 'b'],
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`,
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
    featuredMedia: { preview: { image: { url: `https://cdn.test/${n}.jpg`, altText: 'alt' } } },
    media: {
      nodes: [{ mediaContentType: 'IMAGE', preview: { image: { url: `https://cdn.test/${n}.jpg`, altText: 'alt' } } }],
    },
    options: [{ name: 'Size', optionValues: [{ name: 'S' }] }],
    variants: {
      nodes: [
        {
          id: `gid://shopify/ProductVariant/${n}0`,
          legacyResourceId: `${n}0`,
          title: 'S',
          sku: `SKU${n}`,
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

export function createMockApis({
  products = [],
  items = [],
  failCreateFor = null,
  rateLimitOnce = false,
  maxFirst = Infinity,
} = {}) {
  const shop = { products: new Map(products.map((p) => [p.id, p])), webhooks: [] };
  const wf = { items: new Map(items.map((it) => [it.id, it])), live: new Set(), nextId: 1 };
  const calls = [];
  let limited = !rateLimitOnce;
  const flags = { failPublish: false };

  const json = (status, body, headers = {}) =>
    new Response(body == null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body =
      init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    calls.push({ host: u.host, method, path: u.pathname + u.search, body, headers: init.headers });

    if (u.pathname === '/admin/oauth/access_token')
      return json(200, { access_token: 'shpat_fresh', scope: 'read_products', expires_in: 86399 });

    if (u.pathname.startsWith('/admin/api/')) {
      const op = body.query.match(/(?:query|mutation)\s+(\w+)/)[1];
      if (op === 'TetherSyncWebhooks') return json(200, { data: { webhookSubscriptions: { nodes: shop.webhooks } } });
      if (op === 'TetherSyncWebhookCreate') {
        const w = {
          id: `gid://shopify/WebhookSubscription/${shop.webhooks.length + 1}`,
          topic: body.variables.topic,
          uri: body.variables.sub.uri,
        };
        shop.webhooks.push(w);
        return json(200, { data: { webhookSubscriptionCreate: { webhookSubscription: w, userErrors: [] } } });
      }
      if (op === 'TetherSyncGetProduct')
        return json(200, { data: { product: shop.products.get(body.variables.id) || null } });
      if (op === 'TetherSyncShop')
        return json(200, { data: { shop: { name: 'Shop', myshopifyDomain: 'shop.myshopify.com' } } });
      if (op === 'TetherSyncProducts' && body.variables.first > maxFirst) {
        return json(200, {
          errors: [
            {
              message: 'Query cost is 1500, which exceeds the single query max cost limit (1000).',
              extensions: { code: 'MAX_COST_EXCEEDED' },
            },
          ],
        });
      }
      if (op === 'TetherSyncProducts') {
        let list = [...shop.products.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        const q = body.variables.query;
        const m = q && q.match(/updated_at:>='([^']+)'/);
        if (m) list = list.filter((p) => p.updatedAt >= m[1]);
        const start = body.variables.after ? Number(body.variables.after) : 0;
        const page = list.slice(start, start + body.variables.first);
        const end = start + page.length;
        return json(200, {
          data: { products: { nodes: page, pageInfo: { hasNextPage: end < list.length, endCursor: String(end) } } },
        });
      }
      throw new Error(`unexpected Shopify op ${op}`);
    }

    if (u.host === 'api.webflow.com') {
      if (!limited) {
        limited = true;
        return json(429, { message: 'Too Many Requests' }, { 'retry-after': '2' });
      }
      const p = u.pathname.replace(/^\/v2\/collections\/[^/]+/, '');
      if (p === '' && method === 'GET')
        return json(200, {
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
        });
      if (p === '/items' && method === 'GET') {
        const all = [...wf.items.values()];
        const offset = Number(u.searchParams.get('offset') || 0);
        const limit = Number(u.searchParams.get('limit') || 100);
        return json(200, {
          items: all.slice(offset, offset + limit),
          pagination: { limit, offset, total: all.length },
        });
      }
      if (p === '/items' && method === 'POST') {
        if (failCreateFor && body.fieldData.slug === failCreateFor)
          return json(400, { message: 'Validation Error', details: [{ param: 'name' }] });
        // Webflow slugs are unique within a collection.
        if ([...wf.items.values()].some((it) => it.fieldData.slug === body.fieldData.slug)) {
          return json(409, {
            message: 'Conflict',
            details: [{ param: 'slug', description: 'Unique value is already in database' }],
          });
        }
        const id = `item${wf.nextId++}`;
        const item = { id, isArchived: body.isArchived, isDraft: body.isDraft, fieldData: body.fieldData };
        wf.items.set(id, item);
        return json(202, item);
      }
      if (p === '/items/publish' && method === 'POST') {
        if (flags.failPublish) return json(500, { message: 'publish failed' });
        body.itemIds.forEach((id) => wf.live.add(id));
        return json(202, { publishedItemIds: body.itemIds, errors: [] });
      }
      let m = p.match(/^\/items\/([^/]+)\/live$/);
      if (m && method === 'DELETE') {
        if (!wf.live.has(m[1])) return json(404, { message: 'not live' });
        wf.live.delete(m[1]);
        return json(204, null);
      }
      m = p.match(/^\/items\/([^/]+)$/);
      if (m) {
        const it = wf.items.get(m[1]);
        if (!it) return json(404, { message: 'Item not found' });
        if (method === 'GET') return json(200, it);
        if (method === 'PATCH') {
          if ('isArchived' in body) it.isArchived = body.isArchived;
          if ('isDraft' in body) it.isDraft = body.isDraft;
          Object.assign(it.fieldData, body.fieldData);
          return json(200, it);
        }
        if (method === 'DELETE') {
          wf.items.delete(m[1]);
          return json(204, null);
        }
      }
      throw new Error(`unexpected Webflow ${method} ${p}`);
    }
    throw new Error(`unexpected fetch ${url}`);
  }

  const webflowWrites = () => calls.filter((c) => c.host === 'api.webflow.com' && c.method !== 'GET');
  return { fetch, shop, wf, calls, webflowWrites, flags };
}

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
