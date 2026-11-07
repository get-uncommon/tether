/**
 * The checks on the Storefront answers that hold products by the page: a collection, a search and recommendations.
 * The lists part and the server's catalog read them; they are a module of their own because `shaped()` at the top
 * level isn't provably pure, so the core, which never sends these queries, would otherwise bundle them.
 */
import { orNull, shaped } from './client.ts';
import { PRODUCT } from './product-shape.ts';
import type { ShapeOf } from './client.ts';
import type { Product } from './fragments.ts';
import type { Collection, PageInfo } from './loader.ts';

/** A page of a GraphQL connection of products. */
interface ProductConnection {
  nodes: Product[];
  pageInfo: PageInfo;
}

/** A page of products, with the `pageInfo` paging reads. */
const PRODUCT_CONNECTION = {
  nodes: [PRODUCT],
  pageInfo: { hasNextPage: 'boolean' },
} as const satisfies ShapeOf<ProductConnection>;

/** A collection's answer: `null` for a handle the store doesn't have. Its other fields are written as text. */
export const isCollectionAnswer = shaped<{ collection: (Collection & { products: ProductConnection }) | null }>({
  collection: orNull({ handle: 'string', products: PRODUCT_CONNECTION }),
});
export const isSearchAnswer = shaped<{ products: ProductConnection }>({ products: PRODUCT_CONNECTION });
export const isRecommendationsAnswer = shaped<{ productRecommendations: Product[] | null }>({
  productRecommendations: orNull([PRODUCT]),
});
