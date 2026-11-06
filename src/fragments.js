/**
 * The GraphQL fragments of what Tether renders. They are built at call time because the list sizes and metafields come
 * from the config; the browser passes its validated `cfg`, the server helpers their own. Operations put these after
 * the operation, where `withContext` expects them.
 */
import { cfg, toMetafieldIdentifier } from './config.js';
/** @import { TetherConfig, MetafieldIdentifier } from './config.js' */
/** @import { Money } from './shopify-values.js' */

/** @typedef {{ url: string, altText: string | null, width: number | null, height: number | null }} Image */
/**
 * @typedef {{ __typename: 'SellingPlanPercentagePriceAdjustment', adjustmentPercentage: number }
 *   | { __typename: 'SellingPlanFixedAmountPriceAdjustment', adjustmentAmount: Money }
 *   | { __typename: 'SellingPlanFixedPriceAdjustment', price: Money }} SellingPlanAdjustmentValue
 */
/**
 * @typedef {object} SellingPlan
 * @property {string} id
 * @property {string} name
 * @property {string | null} description
 * @property {boolean} recurringDeliveries
 * @property {{ name: string, value: string }[]} options
 * @property {{ orderCount: number | null, adjustmentValue: SellingPlanAdjustmentValue }[]} priceAdjustments
 */
/**
 * @typedef {object} SellingPlanGroup
 * @property {string} name
 * @property {string | null} appName
 * @property {{ name: string, values: string[] }[]} options
 * @property {{ nodes: SellingPlan[] }} sellingPlans
 */
/**
 * @typedef {object} SellingPlanAllocation A variant's price on one plan.
 * @property {{ id: string }} sellingPlan
 * @property {Money} checkoutChargeAmount What the customer pays at checkout (more for a prepaid plan).
 * @property {Money} remainingBalanceChargeAmount
 * @property {{ price: Money, compareAtPrice: Money, perDeliveryPrice: Money, unitPrice: Money | null }[]}
 *   priceAdjustments
 */
/**
 * @typedef {object} ProductVariant
 * @property {string} id
 * @property {string} title
 * @property {boolean} availableForSale
 * @property {boolean} currentlyNotInStock
 * @property {number | null} [quantityAvailable] Absent when the store's token can't read inventory.
 * @property {string | null} sku
 * @property {string | null} barcode
 * @property {{ name: string, value: string }[]} selectedOptions
 * @property {Image | null} image
 * @property {Money} price
 * @property {Money | null} compareAtPrice
 * @property {Money | null} unitPrice
 * @property {{ nodes: SellingPlanAllocation[] }} sellingPlanAllocations
 */
/**
 * @typedef {object} Metafield
 * @property {string} namespace
 * @property {string} key
 * @property {string} type
 * @property {string} value
 * @property {{ image?: Image } | null} reference A file reference's image.
 */
/**
 * @typedef {object} Product The fields of `fragment TetherProduct`.
 * @property {string} id
 * @property {string} handle
 * @property {string} title
 * @property {string} description
 * @property {string} descriptionHtml
 * @property {string} productType
 * @property {string} vendor
 * @property {string[]} tags
 * @property {boolean} availableForSale
 * @property {string | null} publishedAt
 * @property {string | null} onlineStoreUrl
 * @property {boolean} requiresSellingPlan
 * @property {{ title: string | null, description: string | null }} seo
 * @property {Image | null} featuredImage
 * @property {{ nodes: Image[] }} images
 * @property {{ name: string, optionValues: { name: string, swatch: unknown }[] }[]} options
 * @property {{ minVariantPrice: Money, maxVariantPrice: Money }} priceRange
 * @property {{ minVariantPrice: Money, maxVariantPrice: Money }} compareAtPriceRange
 * @property {(Metafield | null)[]} [metafields] Present when metafields are configured; `null` for one that isn't set.
 * @property {{ nodes: SellingPlanGroup[] }} sellingPlanGroups
 * @property {{ nodes: ProductVariant[] }} variants
 */

/**
 * @typedef {Pick<TetherConfig, 'imagesFirst' | 'variantsFirst' | 'sellingPlanGroupsFirst' | 'sellingPlansFirst'
 *   | 'metafields'>} ProductFragmentConfig
 */

const MONEY = 'amount currencyCode';
const IMAGE = 'url altText width height';

/**
 * The `metafields(identifiers:)` field. A fragment can't declare variables, so the identifiers are written into the
 * text: only valid ones (`toMetafieldIdentifier`), each quoted as a string literal.
 *
 * @param {ProductFragmentConfig['metafields']} metafields
 */
function metafieldsField(metafields) {
  /** @type {MetafieldIdentifier[]} */
  const identifiers = [];
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
 * @param {ProductFragmentConfig} [o] The list sizes and metafields.
 * @returns {string} `fragment TetherProduct on Product`.
 */
export function productFragment(o = cfg) {
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
      id title availableForSale currentlyNotInStock quantityAvailable sku barcode
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

/** @returns {string} `fragment TetherCart on Cart`. */
export function cartFragment() {
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
          id title sku availableForSale requiresShipping quantityAvailable
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

/** @returns {string} The collection fields Tether renders, for inside a `collection { }` selection. */
export function collectionFields() {
  return `
  id handle title description descriptionHtml
  image { ${IMAGE} }
  seo { title description }`;
}
