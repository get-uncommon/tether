/**
 * The catalog reads of `createStorefront()`: products, collections and recommendations, with the browser script's own
 * product fragment, so what the server renders and hands over has the shape the script expects. Runs in Node and
 * Workers: no DOM, no shared config.
 */
import { orNull, request, shaped, TetherError } from '../client.ts';
import { productFragment, collectionFields } from '../fragments.ts';
import { productKey } from '../shopify-values.ts';
import {
  PRODUCT,
  PRODUCT_NODE,
  isCollectionAnswer,
  isRecommendationsAnswer,
  isSearchAnswer,
} from '../product-shape.ts';
import type { DataCheck, StorefrontConfig } from '../client.ts';
import type { ProductFragmentConfig, Product } from '../fragments.ts';
import type { ProductRef, RecommendationIntent } from '../shopify-values.ts';
import type { Collection, PageInfo, ProductPage } from '../loader.ts';

/** What the catalog needs of a storefront's config. */
type CatalogConfig = StorefrontConfig & ProductFragmentConfig;

/** A page of a collection's products, or of a search. */
export interface CatalogQuery {
  /** A collection handle; without one, a search. */
  collection?: string;
  /** Storefront search syntax; `null` or `''` is every product. */
  query?: string | null;
  /** Default the storefront's `pageSize`. */
  first?: number;
  /** The cursor of the page before. */
  after?: string | null;
  /** `ProductCollectionSortKeys` for a collection, `ProductSortKeys` for a search. */
  sortKey?: string;
  reverse?: boolean;
  /** `ProductFilter` values, for a collection. */
  filters?: unknown[];
}

type CollectionWithProducts = Collection & { products: Product[]; pageInfo: PageInfo };

/** A page of a GraphQL connection. */
interface Connection<Node> {
  nodes: Node[];
  pageInfo: PageInfo;
}

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

const recommendationsQuery = (
  byId: boolean,
) => `query TetherServerRecs(${byId ? '$id: ID!' : '$handle: String!'}, $intent: ProductRecommendationIntent) {
  productRecommendations(${byId ? 'productId: $id' : 'productHandle: $handle'}, intent: $intent) { ...TetherProduct }
}`;

const isProductAnswer = shaped<{ product: Product | null }>({ product: orNull(PRODUCT) });
const isNodeAnswer = shaped<{ node: Product | { id?: undefined } | null }>({ node: orNull(PRODUCT_NODE) });
const isCollectionsAnswer = shaped<{ collections: Connection<Collection> }>({
  collections: { nodes: [{ handle: 'string' }], pageInfo: { hasNextPage: 'boolean' } },
});

async function allCollectionsOf(conf: StorefrontConfig): Promise<Collection[]> {
  const collections: Collection[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_COLLECTION_PAGES; page++) {
    const data: { collections: Connection<Collection> } = await request(
      conf,
      collectionsQuery(),
      { first: COLLECTIONS_PER_PAGE, after },
      isCollectionsAnswer,
    );
    collections.push(...data.collections.nodes);
    if (!data.collections.pageInfo.hasNextPage) break;
    after = data.collections.pageInfo.endCursor;
  }
  return collections;
}

/** @param pageSize Products per page when a query doesn't say. */
export function createCatalog(conf: CatalogConfig, pageSize: number) {
  /** @param operation The query, without the product fragment. */
  const send = <T>(operation: string, variables: Record<string, unknown>, isData: DataCheck<T>): Promise<T> =>
    request(conf, (access) => `${operation}\n${productFragment(conf, access)}`, variables, isData);

  /**
   * @param raw A handle, numeric id, gid or product URL.
   * @returns `null` when the store has no such product.
   */
  async function getProduct(raw: string | number | null | undefined): Promise<Product | null> {
    const key = productKey(raw);
    if (!key) return null;
    if (key.startsWith('gid://')) {
      const { node } = await send(PRODUCT_BY_ID, { id: key }, isNodeAnswer);
      return node?.id ? node : null;
    }
    const data = await send(PRODUCT_BY_HANDLE, { handle: key }, isProductAnswer);
    return data.product;
  }

  /** @returns No collection and no products for a handle the store doesn't have. */
  async function getCollectionPage(
    handle: string,
    { first = pageSize, after = null, sortKey, reverse = false, filters }: Omit<CatalogQuery, 'collection' | 'query'>,
  ): Promise<ProductPage> {
    const data = await send(
      collectionQuery(),
      {
        handle,
        first,
        after,
        sortKey: sortKey || undefined,
        reverse,
        filters: filters ?? undefined,
      },
      isCollectionAnswer,
    );
    if (!data.collection) return { collection: null, products: [], pageInfo: { hasNextPage: false, endCursor: null } };
    const { products, ...collection } = data.collection;
    return { collection, products: products.nodes, pageInfo: products.pageInfo };
  }

  async function getProducts(options: CatalogQuery = {}): Promise<ProductPage> {
    const { collection, query, first = pageSize, after = null, sortKey, reverse = false } = options;
    if (collection) return getCollectionPage(collection, options);
    const data = await send(
      SEARCH_QUERY,
      { first, after, query: query || undefined, sortKey: sortKey || undefined, reverse },
      isSearchAnswer,
    );
    return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
  }

  /** Every product of a collection or a search, page by page: for `getStaticPaths()`. */
  async function allProducts(options: Omit<CatalogQuery, 'first' | 'after'> = {}): Promise<Product[]> {
    const products: Product[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PRODUCT_PAGES; page++) {
      const result = await getProducts({ ...options, first: pageSize, after });
      products.push(...result.products);
      if (!result.pageInfo.hasNextPage) break;
      after = result.pageInfo.endCursor;
    }
    return products;
  }

  /** @returns `null` for a handle the store doesn't have. */
  async function getCollection(
    handle: string,
    options: Omit<CatalogQuery, 'collection'> = {},
  ): Promise<CollectionWithProducts | null> {
    const page = await getProducts({ ...options, collection: handle });
    return page.collection ? { ...page.collection, products: page.products, pageInfo: page.pageInfo } : null;
  }

  /**
   * By product id (gid or numeric) or handle, so it can run next to `getProduct(handle)`.
   *
   * @throws {TetherError} `NOT_FOUND` when `product` names no product (empty, `null` or `undefined`).
   */
  async function getRecommendations(
    product: ProductRef | null | undefined,
    intent: RecommendationIntent = 'RELATED',
  ): Promise<Product[]> {
    const key = productKey(typeof product === 'object' ? product?.id : product);
    if (!key) throw new TetherError('No product for recommendations', { code: 'NOT_FOUND' });
    const byId = key.startsWith('gid://');
    const data = await send(
      recommendationsQuery(byId),
      byId ? { id: key, intent } : { handle: key, intent },
      isRecommendationsAnswer,
    );
    return data.productRecommendations ?? [];
  }

  const allCollections = () => allCollectionsOf(conf);
  return { getProduct, getProducts, allProducts, getCollection, allCollections, getRecommendations };
}
