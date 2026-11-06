/**
 * The catalog reads of `createStorefront()`: products, collections and recommendations, with the browser script's own
 * product fragment, so what the server renders and hands over has the shape the script expects. Runs in Node and
 * Workers: no DOM, no shared config.
 */
import { request } from '../client.js';
import { productFragment, collectionFields } from '../fragments.js';
import { productKey } from '../shopify-values.js';
/** @import { StorefrontConfig } from '../client.js' */
/** @import { ProductFragmentConfig, Product } from '../fragments.js' */
/** @import { Collection, PageInfo, ProductPage } from '../loader.js' */

/**
 * @typedef {StorefrontConfig & ProductFragmentConfig} CatalogConfig What the catalog needs of a storefront's config.
 */

/**
 * @typedef {object} CatalogQuery A page of a collection's products, or of a search.
 * @property {string} [collection] A collection handle; without one, a search.
 * @property {string | null} [query] Storefront search syntax; `null` or `''` is every product.
 * @property {number} [first] Default the storefront's `pageSize`.
 * @property {string | null} [after] The cursor of the page before.
 * @property {string} [sortKey] `ProductCollectionSortKeys` for a collection, `ProductSortKeys` for a search.
 * @property {boolean} [reverse]
 * @property {unknown[]} [filters] `ProductFilter` values, for a collection.
 */

/** @typedef {Collection & { products: Product[], pageInfo: PageInfo }} CollectionWithProducts */
/** @typedef {'RELATED' | 'COMPLEMENTARY'} RecommendationIntent */

/** Stops a paging loop on a store that keeps answering `hasNextPage` (500 pages of 25 is 12,500 products). */
const MAX_PRODUCT_PAGES = 500;
const COLLECTIONS_PER_PAGE = 100;
const MAX_COLLECTION_PAGES = 100;

const PRODUCT_BY_ID = `query TetherServerProductById($id: ID!) { node(id: $id) { ... on Product { ...TetherProduct } } }`;
const PRODUCT_BY_HANDLE = `query TetherServerProduct($handle: String!) { product(handle: $handle) { ...TetherProduct } }`;

const collectionQuery =
  () => `query TetherServerCollection($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean, $filters: [ProductFilter!]) {
  collection(handle: $handle) {
    ${collectionFields()}
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
      nodes { ...TetherProduct }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const SEARCH_QUERY = `query TetherServerProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
  products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
    nodes { ...TetherProduct }
    pageInfo { hasNextPage endCursor }
  }
}`;

const collectionsQuery = () => `query TetherServerCollections($first: Int!, $after: String) {
  collections(first: $first, after: $after) { nodes { ${collectionFields()} } pageInfo { hasNextPage endCursor } }
}`;

/** @param {boolean} byId */
const recommendationsQuery = (
  byId,
) => `query TetherServerRecs(${byId ? '$id: ID!' : '$handle: String!'}, $intent: ProductRecommendationIntent) {
  productRecommendations(${byId ? 'productId: $id' : 'productHandle: $handle'}, intent: $intent) { ...TetherProduct }
}`;

/**
 * @param {CatalogConfig} conf
 * @param {number} pageSize Products per page when a query doesn't say.
 */
export function createCatalog(conf, pageSize) {
  /**
   * @template T The shape of the query's `data`.
   * @param {string} operation The query, without the product fragment.
   * @param {Record<string, unknown>} variables
   * @returns {Promise<T>}
   */
  const send = (operation, variables) => request(conf, `${operation}\n${productFragment(conf)}`, variables);

  /**
   * @param {string | number | null | undefined} raw A handle, numeric id, gid or product URL.
   * @returns {Promise<Product | null>} `null` when the store has no such product.
   */
  async function getProduct(raw) {
    const key = productKey(raw);
    if (!key) return null;
    if (key.startsWith('gid://')) {
      /** @type {{ node: Partial<Product> | null }} */
      const data = await send(PRODUCT_BY_ID, { id: key });
      // A gid of another type answers with a node that isn't a product: no fields of the fragment.
      return data.node?.id ? /** @type {Product} */ (data.node) : null;
    }
    /** @type {{ product: Product | null }} */
    const data = await send(PRODUCT_BY_HANDLE, { handle: key });
    return data.product;
  }

  /**
   * @param {string} handle
   * @param {Omit<CatalogQuery, 'collection' | 'query'>} options
   * @returns {Promise<ProductPage>} No collection and no products for a handle the store doesn't have.
   */
  async function getCollectionPage(handle, { first = pageSize, after = null, sortKey, reverse = false, filters }) {
    /** @type {{ collection: (Collection & { products: { nodes: Product[], pageInfo: PageInfo } }) | null }} */
    const data = await send(collectionQuery(), {
      handle,
      first,
      after,
      sortKey: sortKey || undefined,
      reverse,
      filters: filters ?? undefined,
    });
    if (!data.collection) return { collection: null, products: [], pageInfo: { hasNextPage: false, endCursor: null } };
    const { products, ...collection } = data.collection;
    return { collection, products: products.nodes, pageInfo: products.pageInfo };
  }

  /**
   * @param {CatalogQuery} [options]
   * @returns {Promise<ProductPage>}
   */
  async function getProducts(options = {}) {
    const { collection, query, first = pageSize, after = null, sortKey, reverse = false } = options;
    if (collection) return getCollectionPage(collection, options);
    /** @type {{ products: { nodes: Product[], pageInfo: PageInfo } }} */
    const data = await send(SEARCH_QUERY, {
      first,
      after,
      query: query || undefined,
      sortKey: sortKey || undefined,
      reverse,
    });
    return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
  }

  /**
   * Every product of a collection or a search, page by page: for `getStaticPaths()`.
   *
   * @param {Omit<CatalogQuery, 'first' | 'after'>} [options]
   * @returns {Promise<Product[]>}
   */
  async function allProducts(options = {}) {
    /** @type {Product[]} */
    const products = [];
    /** @type {string | null} */
    let after = null;
    for (let page = 0; page < MAX_PRODUCT_PAGES; page++) {
      const result = await getProducts({ ...options, first: pageSize, after });
      products.push(...result.products);
      if (!result.pageInfo.hasNextPage) break;
      after = result.pageInfo.endCursor;
    }
    return products;
  }

  /**
   * @param {string} handle
   * @param {Omit<CatalogQuery, 'collection'>} [options]
   * @returns {Promise<CollectionWithProducts | null>} `null` for a handle the store doesn't have.
   */
  async function getCollection(handle, options = {}) {
    const page = await getProducts({ ...options, collection: handle });
    return page.collection ? { ...page.collection, products: page.products, pageInfo: page.pageInfo } : null;
  }

  /** @returns {Promise<Collection[]>} */
  async function allCollections() {
    /** @type {Collection[]} */
    const collections = [];
    /** @type {string | null} */
    let after = null;
    for (let page = 0; page < MAX_COLLECTION_PAGES; page++) {
      /** @type {{ collections: { nodes: Collection[], pageInfo: PageInfo } }} */
      const data = await request(conf, collectionsQuery(), { first: COLLECTIONS_PER_PAGE, after });
      collections.push(...data.collections.nodes);
      if (!data.collections.pageInfo.hasNextPage) break;
      after = data.collections.pageInfo.endCursor;
    }
    return collections;
  }

  /**
   * By product id (gid or numeric) or handle, so it can run next to `getProduct(handle)`.
   *
   * @param {string | number | { id: string } | null | undefined} product
   * @param {RecommendationIntent} [intent]
   * @returns {Promise<Product[]>}
   */
  async function getRecommendations(product, intent = 'RELATED') {
    const key = productKey(typeof product === 'object' ? product?.id : product);
    const byId = key?.startsWith('gid://') ?? false;
    /** @type {{ productRecommendations: Product[] | null }} */
    const data = await send(recommendationsQuery(byId), byId ? { id: key, intent } : { handle: key, intent });
    return data.productRecommendations ?? [];
  }

  return { getProduct, getProducts, allProducts, getCollection, allCollections, getRecommendations };
}
