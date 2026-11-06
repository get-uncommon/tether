/**
 * GraphQL fragments. Built at call time because counts and metafields come
 * from config. Operations put these AFTER the operation (see withContext).
 */
import { cfg } from './config.js';

const MONEY = 'amount currencyCode';
const IMAGE = 'url altText width height';

function metafieldIdentifiers(o = cfg) {
  return (o.metafields || []).map((m) => {
    if (typeof m === 'string') {
      const i = m.indexOf('.');
      return { namespace: m.slice(0, i), key: m.slice(i + 1) };
    }
    return m;
  }).filter((m) => m.namespace && m.key);
}

function metafieldsField(o = cfg) {
  const ids = metafieldIdentifiers(o);
  if (!ids.length) return '';
  const list = ids
    .map((m) => `{namespace: ${JSON.stringify(m.namespace)}, key: ${JSON.stringify(m.key)}}`)
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

/** The product fields Tether renders. `o` = config (counts, metafields); the server module passes its own. */
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
  ${metafieldsField(o)}
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

export function collectionFields() {
  return `
  id handle title description descriptionHtml
  image { ${IMAGE} }
  seo { title description }`;
}
