/**
 * The GraphQL fragments of what Tether renders. They are built at call time because the list sizes and metafields come
 * from the config; the browser passes its validated `cfg`, the server helpers their own. Operations put these after
 * the operation, where `withContext` expects them.
 */
import { cfg } from './config.ts';
import { toMetafieldIdentifier } from './config-sections.ts';
import type { TetherConfig, MetafieldIdentifier } from './config.ts';
import type { Money } from './shopify-values.ts';
import type { StoreAccess } from './client.ts';

export interface Image {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export type SellingPlanAdjustmentValue =
  | { __typename: 'SellingPlanPercentagePriceAdjustment'; adjustmentPercentage: number }
  | { __typename: 'SellingPlanFixedAmountPriceAdjustment'; adjustmentAmount: Money }
  | { __typename: 'SellingPlanFixedPriceAdjustment'; price: Money };

export interface SellingPlan {
  id: string;
  name: string;
  description: string | null;
  recurringDeliveries: boolean;
  options: { name: string; value: string }[];
  priceAdjustments: { orderCount: number | null; adjustmentValue: SellingPlanAdjustmentValue }[];
}

export interface SellingPlanGroup {
  name: string;
  appName: string | null;
  options: { name: string; values: string[] }[];
  sellingPlans: { nodes: SellingPlan[] };
}

/** A variant's price on one plan. */
export interface SellingPlanAllocation {
  sellingPlan: { id: string };
  /** What the customer pays at checkout (more for a prepaid plan). */
  checkoutChargeAmount: Money;
  remainingBalanceChargeAmount: Money;
  priceAdjustments: { price: Money; compareAtPrice: Money; perDeliveryPrice: Money; unitPrice: Money | null }[];
}

export interface ProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  currentlyNotInStock: boolean;
  /** Absent when the store's token can't read inventory. */
  quantityAvailable?: number | null;
  sku: string | null;
  barcode: string | null;
  selectedOptions: { name: string; value: string }[];
  image: Image | null;
  price: Money;
  compareAtPrice: Money | null;
  unitPrice: Money | null;
  sellingPlanAllocations: { nodes: SellingPlanAllocation[] };
}

export interface Metafield {
  namespace: string;
  key: string;
  type: string;
  value: string;
  /** A file reference's image. */
  reference: { image?: Image } | null;
}

/** The fields of `fragment TetherProduct`. */
export interface Product {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  availableForSale: boolean;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  requiresSellingPlan: boolean;
  seo: { title: string | null; description: string | null };
  featuredImage: Image | null;
  images: { nodes: Image[] };
  options: { name: string; optionValues: { name: string; swatch: unknown }[] }[];
  priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  compareAtPriceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  /** Present when metafields are configured; `null` for one that isn't set. */
  metafields?: (Metafield | null)[];
  sellingPlanGroups: { nodes: SellingPlanGroup[] };
  variants: { nodes: ProductVariant[] };
}

export type ProductFragmentConfig = Pick<
  TetherConfig,
  'imagesFirst' | 'variantsFirst' | 'sellingPlanGroupsFirst' | 'sellingPlansFirst' | 'metafields'
>;

const MONEY = 'amount currencyCode';
/** What a token reads unless the store turned out to refuse more (client.ts). */
const FULL_ACCESS: StoreAccess = { inventory: true };

/** The stock field, for a token that may read inventory. */
const inventoryField = (access: StoreAccess): string => (access.inventory ? 'quantityAvailable' : '');
const IMAGE = 'url altText width height';

/**
 * The `metafields(identifiers:)` field. A fragment can't declare variables, so the identifiers are written into the
 * text: only valid ones (`toMetafieldIdentifier`), each quoted as a string literal.
 */
function metafieldsField(metafields: ProductFragmentConfig['metafields']) {
  const identifiers: MetafieldIdentifier[] = [];
  for (const ref of metafields) {
    const identifier = toMetafieldIdentifier(ref);
    if (identifier) identifiers.push(identifier);
  }
  if (!identifiers.length) return '';
  const list = identifiers
    .map(({ namespace, key }) => `{namespace: ${JSON.stringify(namespace)}, key: ${JSON.stringify(key)}}`)
    .join(', ');
  return `metafields(identifiers: [${list}]) {
    namespace key type value
    reference { ... on MediaImage { image { ${IMAGE} } } }
  }`;
}

const SELLING_PLAN_FIELDS = `
  id name description recurringDeliveries
  options { name value }
  priceAdjustments {
    orderCount
    adjustmentValue {
      __typename
      ... on SellingPlanPercentagePriceAdjustment { adjustmentPercentage }
      ... on SellingPlanFixedAmountPriceAdjustment { adjustmentAmount { ${MONEY} } }
      ... on SellingPlanFixedPriceAdjustment { price { ${MONEY} } }
    }
  }`;

const ALLOCATION_FIELDS = `
  sellingPlan { id }
  checkoutChargeAmount { ${MONEY} }
  remainingBalanceChargeAmount { ${MONEY} }
  priceAdjustments {
    price { ${MONEY} }
    compareAtPrice { ${MONEY} }
    perDeliveryPrice { ${MONEY} }
    unitPrice { ${MONEY} }
  }`;

/**
 * @param o The list sizes and metafields.
 * @param access What the token may read.
 * @returns `fragment TetherProduct on Product`.
 */
export function productFragment(o: ProductFragmentConfig = cfg, access: StoreAccess = FULL_ACCESS): string {
  return `
fragment TetherProduct on Product {
  id handle title description descriptionHtml productType vendor tags
  availableForSale publishedAt onlineStoreUrl requiresSellingPlan
  seo { title description }
  featuredImage { ${IMAGE} }
  images(first: ${o.imagesFirst}) { nodes { ${IMAGE} } }
  options { name optionValues { name swatch { color image { previewImage { ${IMAGE} } } } } }
  priceRange { minVariantPrice { ${MONEY} } maxVariantPrice { ${MONEY} } }
  compareAtPriceRange { minVariantPrice { ${MONEY} } maxVariantPrice { ${MONEY} } }
  ${metafieldsField(o.metafields)}
  sellingPlanGroups(first: ${o.sellingPlanGroupsFirst}) {
    nodes {
      name appName
      options { name values }
      sellingPlans(first: ${o.sellingPlansFirst}) { nodes { ${SELLING_PLAN_FIELDS} } }
    }
  }
  variants(first: ${o.variantsFirst}) {
    nodes {
      id title availableForSale currentlyNotInStock ${inventoryField(access)} sku barcode
      selectedOptions { name value }
      image { ${IMAGE} }
      price { ${MONEY} }
      compareAtPrice { ${MONEY} }
      unitPrice { ${MONEY} }
      sellingPlanAllocations(first: ${o.sellingPlansFirst}) { nodes { ${ALLOCATION_FIELDS} } }
    }
  }
}`;
}

/**
 * @param access What the token may read.
 * @returns `fragment TetherCart on Cart`.
 */
export function cartFragment(access: StoreAccess = FULL_ACCESS): string {
  return `
fragment TetherCart on Cart {
  id checkoutUrl totalQuantity note createdAt updatedAt
  attributes { key value }
  buyerIdentity { countryCode email }
  discountCodes { code applicable }
  cost {
    subtotalAmount { ${MONEY} }
    totalAmount { ${MONEY} }
    checkoutChargeAmount { ${MONEY} }
  }
  lines(first: 100) {
    nodes {
      id quantity
      attributes { key value }
      cost {
        totalAmount { ${MONEY} }
        subtotalAmount { ${MONEY} }
        amountPerQuantity { ${MONEY} }
        compareAtAmountPerQuantity { ${MONEY} }
      }
      discountAllocations { discountedAmount { ${MONEY} } }
      sellingPlanAllocation {
        sellingPlan { id name description recurringDeliveries options { name value } }
        checkoutChargeAmount { ${MONEY} }
        priceAdjustments { price { ${MONEY} } compareAtPrice { ${MONEY} } perDeliveryPrice { ${MONEY} } }
      }
      merchandise {
        ... on ProductVariant {
          id title sku availableForSale requiresShipping ${inventoryField(access)}
          image { ${IMAGE} }
          price { ${MONEY} }
          compareAtPrice { ${MONEY} }
          selectedOptions { name value }
          product { id title handle vendor featuredImage { ${IMAGE} } }
        }
      }
      ... on ComponentizableCartLine {
        lineComponents {
          id quantity
          merchandise { ... on ProductVariant { id title product { title handle } } }
        }
      }
    }
  }
}`;
}

/** The collection fields Tether renders, for inside a `collection { }` selection. */
export function collectionFields(): string {
  return `
  id handle title description descriptionHtml
  image { ${IMAGE} }
  seo { title description }`;
}
