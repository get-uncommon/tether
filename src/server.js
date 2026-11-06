// @ts-nocheck
/**
 * @occluze/tether/server: Shopify product data at build time or on the server (Astro, Eleventy,
 * Node, Cloudflare Workers). No browser APIs. Uses the same queries as the browser script, so
 * products handed over with hydrate() are exactly what Tether expects and need no extra request.
 *
 *   import { createStorefront } from '@occluze/tether/server';
 *   const shop = createStorefront({ domain, token, country: 'NL' });
 *   const product = await shop.getProduct('coffee-box');
 *   const all = await shop.allProducts();
 */
import { DEFAULTS } from './config.js';
import { request, withContext, TetherError } from './client.js';
import { productFragment, collectionFields } from './fragments.js';
import * as plans from './selling-plans.js';
import { imageUrl, formatPercent } from './dom.js';
import { initialState } from './initial.js';

export { imageUrl, initialState, formatPercent };

export { TetherError, plans, withContext };

const isGid = (v) => typeof v === 'string' && v.startsWith('gid://');

/** Handle, numeric id, gid or product URL -> handle or gid. */
export function productKey(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (isGid(v)) return v;
  if (/^\d+$/.test(v)) return `gid://shopify/Product/${v}`;
  const m = v.match(/\/products\/([^/?#]+)/);
  return m ? m[1] : v;
}

/** Money as text, e.g. formatMoney({ amount: '30.0', currencyCode: 'EUR' }, 'nl-NL') -> "€ 30,00". */
export function formatMoney(money, locale) {
  if (!money) return '';
  const amount = parseFloat(money.amount);
  if (Number.isNaN(amount)) return '';
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency: money.currencyCode }).format(
      amount,
    );
  } catch {
    return `${money.currencyCode} ${amount.toFixed(2)}`;
  }
}

/** productPath '/products' -> /products/<handle>; templates '/p?handle={handle}' and '{id}' work too. */
export function productUrl(handle, { productPath = '/product', id } = {}) {
  if (!/\{(handle|id)\}/.test(productPath)) return `${productPath.replace(/\/$/, '')}/${handle}`;
  return productPath
    .replace(/\{handle\}/g, encodeURIComponent(handle || ''))
    .replace(/\{id\}/g, encodeURIComponent(id ? String(id).split('/').pop() : ''));
}

/** JSON for a <script> tag: escapes < so product text can never close the tag. */
const safeJson = (v) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

// createStorefront(import.meta.env) works too: these env names map to domain and token.
const ENV = {
  domain: ['PUBLIC_SHOPIFY_DOMAIN', 'PUBLIC_SHOPIFY_STORE_DOMAIN', 'SHOPIFY_DOMAIN'],
  token: ['PUBLIC_SHOPIFY_STOREFRONT_TOKEN', 'PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN', 'SHOPIFY_STOREFRONT_TOKEN'],
};

export function createStorefront(options = {}) {
  const known = Object.fromEntries(
    Object.entries(options).filter(([k]) => k in DEFAULTS || k === 'fetch' || k === 'pageSize' || k === 'siteUrl'),
  );
  const conf = { ...DEFAULTS, ...known };
  for (const [key, names] of Object.entries(ENV))
    if (!conf[key]) conf[key] = names.map((n) => options[n]).find(Boolean) || '';
  conf.domain = String(conf.domain || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!conf.domain || !conf.token) {
    throw new TetherError(
      'createStorefront needs domain and token: pass them, or import.meta.env with PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN',
      { code: 'NOT_CONFIGURED' },
    );
  }
  const pageSize = options.pageSize || 25;
  const q = (query, variables, opts) => request(conf, query, variables, opts);
  const fragment = () => productFragment(conf);

  async function getProduct(raw) {
    const key = productKey(raw);
    if (!key) return null;
    const data = isGid(key)
      ? await q(
          `query TetherServerProductById($id: ID!) { node(id: $id) { ... on Product { ...TetherProduct } } }\n${fragment()}`,
          { id: key },
        )
      : await q(
          `query TetherServerProduct($handle: String!) { product(handle: $handle) { ...TetherProduct } }\n${fragment()}`,
          { handle: key },
        );
    const p = isGid(key) ? data.node : data.product;
    return p && p.id ? p : null;
  }

  async function getProducts({
    collection,
    query,
    first = pageSize,
    after = null,
    sortKey,
    reverse = false,
    filters,
  } = {}) {
    if (collection) {
      const data = await q(
        `query TetherServerCollection($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean, $filters: [ProductFilter!]) {
  collection(handle: $handle) {
    ${collectionFields()}
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
      nodes { ...TetherProduct }
      pageInfo { hasNextPage endCursor }
    }
  }
}
${fragment()}`,
        { handle: collection, first, after, sortKey: sortKey || undefined, reverse, filters: filters || undefined },
      );
      if (!data.collection)
        return { collection: null, products: [], pageInfo: { hasNextPage: false, endCursor: null } };
      const { products, ...rest } = data.collection;
      return { collection: rest, products: products.nodes, pageInfo: products.pageInfo };
    }
    const data = await q(
      `query TetherServerProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
  products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
    nodes { ...TetherProduct }
    pageInfo { hasNextPage endCursor }
  }
}
${fragment()}`,
      { first, after, query: query || undefined, sortKey: sortKey || undefined, reverse },
    );
    return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
  }

  /** Every product (of a collection or a search), page by page. For getStaticPaths(). */
  async function allProducts(opts = {}) {
    const out = [];
    let after = null;
    for (let i = 0; i < 500; i++) {
      const page = await getProducts({ ...opts, first: pageSize, after });
      out.push(...page.products);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return out;
  }

  async function getCollection(handle, opts = {}) {
    const page = await getProducts({ ...opts, collection: handle });
    return page.collection ? { ...page.collection, products: page.products, pageInfo: page.pageInfo } : null;
  }

  async function allCollections() {
    const out = [];
    let after = null;
    for (let i = 0; i < 100; i++) {
      const data = await q(
        `query TetherServerCollections($first: Int!, $after: String) {
  collections(first: $first, after: $after) { nodes { ${collectionFields()} } pageInfo { hasNextPage endCursor } }
}`,
        { first: 100, after },
      );
      out.push(...data.collections.nodes);
      if (!data.collections.pageInfo.hasNextPage) break;
      after = data.collections.pageInfo.endCursor;
    }
    return out;
  }

  /** By product id (gid or numeric) or handle, so it can run next to getProduct(handle). */
  async function getRecommendations(product, intent = 'RELATED') {
    const key = productKey(typeof product === 'object' ? product?.id : product);
    const byId = key?.startsWith('gid://');
    const data = await q(
      `query TetherServerRecs(${byId ? '$id: ID!' : '$handle: String!'}, $intent: ProductRecommendationIntent) {
  productRecommendations(${byId ? 'productId: $id' : 'productHandle: $handle'}, intent: $intent) { ...TetherProduct }
}
${fragment()}`,
      byId ? { id: key, intent } : { handle: key, intent },
    );
    return data.productRecommendations || [];
  }

  /**
   * A <script> tag that hands products to the browser script: Tether renders them at once,
   * without its own request, then refreshes prices and stock in the background.
   * Put it anywhere in the page (Astro: <Fragment set:html={shop.hydrate(products)} />).
   */
  /**
   * { card: true } for lists (home, collections, recommendations): about 40% smaller, without
   * descriptions, variant images and images after the first two (a hover image, tether-bind="image:2";
   * more with { card: true, images: 3 }). Price, stock and plans per variant stay. The full
   * product comes with the background refresh.
   */
  function hydrate(products, { card = false, images = 2 } = {}) {
    let list = (Array.isArray(products) ? products : [products]).filter(Boolean);
    if (card) list = list.map((p) => slim(p, images));
    const payload = {
      v: 1,
      at: new Date().toISOString(),
      country: conf.country || null,
      language: conf.language || null,
      products: list,
    };
    return `<script type="application/json" data-tether-hydrate>${safeJson(payload)}</script>`;
  }

  /**
   * schema.org data for search engines (Google's product rich results): a Product, or a ProductGroup
   * with one Product per variant (price, currency, stock, sku, image, link to ?variant=).
   * jsonLd(product, { url: 'https://shop.example/products/x' }) -> the <script> tag; jsonLdData() -> the object.
   */
  function jsonLdData(p, { url, brand } = {}) {
    if (!p) return null;
    const pageUrl =
      url ||
      (conf.siteUrl
        ? new URL(productUrl(p.handle, { productPath: conf.productPath, id: p.id }), conf.siteUrl).toString()
        : undefined);
    const vid = (v) => String(v.id).split('/').pop();
    const withVariant = (v) =>
      pageUrl ? `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}variant=${vid(v)}` : undefined;
    const text = (p.description || '').trim() || undefined;
    const images = (p.images?.nodes || []).map((i) => i.url).filter(Boolean);
    const brandName = brand || p.vendor;
    // Only buyable on a subscription: the plan price is the price (the first plan the variant has).
    const priceOf = (v) => {
      if (!p.requiresSellingPlan) return v.price;
      const plan = plans.allPlans(p).find((pl) => plans.allocationFor(v, pl.id));
      return plan ? plans.planPrice(v, plan.id) : v.price;
    };
    const offer = (v) => ({
      '@type': 'Offer',
      price: priceOf(v)?.amount,
      priceCurrency: priceOf(v)?.currencyCode,
      availability: `https://schema.org/${v.availableForSale ? (v.currentlyNotInStock ? 'BackOrder' : 'InStock') : 'OutOfStock'}`,
      url: withVariant(v),
    });
    const vs = p.variants?.nodes || [];
    const clean = (o) => JSON.parse(JSON.stringify(o)); // drops undefined
    if (vs.length <= 1) {
      const v = vs[0];
      return clean({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.title,
        description: text,
        url: pageUrl,
        image: images,
        sku: v?.sku || undefined,
        brand: brandName ? { '@type': 'Brand', name: brandName } : undefined,
        offers: v ? offer(v) : undefined,
      });
    }
    const varies = {
      size: 'https://schema.org/size',
      color: 'https://schema.org/color',
      colour: 'https://schema.org/color',
      material: 'https://schema.org/material',
    };
    return clean({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: p.title,
      description: text,
      url: pageUrl,
      productGroupID: String(p.id).split('/').pop(),
      image: images,
      brand: brandName ? { '@type': 'Brand', name: brandName } : undefined,
      variesBy: [...new Set((p.options || []).map((o) => varies[o.name.toLowerCase()]).filter(Boolean))],
      hasVariant: vs.map((v) => ({
        '@type': 'Product',
        name: `${p.title} - ${v.title}`,
        sku: v.sku || undefined,
        image: v.image?.url || images[0],
        ...Object.fromEntries(
          (v.selectedOptions || [])
            .filter((o) => varies[o.name.toLowerCase()])
            .map((o) => [varies[o.name.toLowerCase()].split('/').pop(), o.value]),
        ),
        offers: offer(v),
      })),
    });
  }
  const jsonLd = (p, opts) => (p ? `<script type="application/ld+json">${safeJson(jsonLdData(p, opts))}</script>` : '');

  function slim(p, keep = 2) {
    return {
      ...p,
      description: '',
      descriptionHtml: '',
      images: { nodes: (p.images?.nodes || []).slice(0, Math.max(1, keep)) },
      variants: { nodes: (p.variants?.nodes || []).map((v) => ({ ...v, image: null })) },
    };
  }

  return {
    config: conf,
    query: q,
    getProduct,
    getProducts,
    allProducts,
    getCollection,
    allCollections,
    getRecommendations,
    hydrate,
    formatMoney: (money, locale = conf.locale) => formatMoney(money, locale),
    formatPercent: (n, locale = conf.locale) => formatPercent(n, locale),
    imageUrl,
    jsonLd,
    jsonLdData,
    initialState: (product, opts = {}) =>
      initialState(product, { defaultPurchase: conf.defaultPurchase, lowStock: conf.lowStock, ...opts }),
    productUrl: (handle, opts = {}) => productUrl(handle, { productPath: conf.productPath, ...opts }),
    plans,
  };
}
