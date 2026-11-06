/**
 * schema.org data for search engines (Google's product rich results): a `Product`, or a `ProductGroup` with one
 * `Product` per variant, each with its price, currency, stock, sku, image and `?variant=` link. Products that are only
 * sold on a subscription are priced at their first plan.
 */
import { allPlans, allocationFor, planPrice } from '../selling-plans.js';
import { productUrl } from '../shopify-values.js';
/** @import { Product, ProductVariant } from '../fragments.js' */
/** @import { Money } from '../shopify-values.js' */

/**
 * @typedef {object} JsonLdOptions
 * @property {string} [url] The product page's absolute URL; default from the storefront's `siteUrl`.
 * @property {string} [brand] Default the product's vendor.
 */

/** @typedef {{ productPath: string, siteUrl: string | undefined }} JsonLdSite Where the product pages are. */

/** The option names schema.org has a property for: a `ProductGroup` varies by them. */
/** @type {Readonly<Record<string, string>>} */
const VARIES_BY = {
  size: 'https://schema.org/size',
  color: 'https://schema.org/color',
  colour: 'https://schema.org/color',
  material: 'https://schema.org/material',
};

/**
 * Text for a `<script>` tag: `<` is escaped so product text can never close the tag, and U+2028 / U+2029 so older
 * JavaScript parsers read it.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/**
 * @param {Record<string, unknown>} value
 * @returns {Record<string, unknown>} `value` without its `undefined` fields, nested ones too.
 */
function withoutUndefined(value) {
  /** @type {unknown} */
  const copy = JSON.parse(JSON.stringify(value));
  // The JSON of an object is an object.
  return /** @type {Record<string, unknown>} */ (copy);
}

/** @param {string} gid */
const numericId = (gid) => gid.split('/').pop() ?? gid;

/**
 * @param {ProductVariant} variant
 * @returns {string} The schema.org availability.
 */
function availability(variant) {
  if (!variant.availableForSale) return 'https://schema.org/OutOfStock';
  return variant.currentlyNotInStock ? 'https://schema.org/BackOrder' : 'https://schema.org/InStock';
}

/**
 * @param {Product} product
 * @param {ProductVariant} variant
 * @returns {Money} The variant's price, or its first plan's for a product sold only on a subscription.
 */
function offeredPrice(product, variant) {
  if (!product.requiresSellingPlan) return variant.price;
  const plan = allPlans(product).find((candidate) => allocationFor(variant, candidate.id));
  return (plan && planPrice(variant, plan.id)) ?? variant.price;
}

/**
 * @param {Product} product
 * @param {ProductVariant} variant
 * @param {string | undefined} pageUrl
 */
function offer(product, variant, pageUrl) {
  const price = offeredPrice(product, variant);
  const separator = pageUrl?.includes('?') ? '&' : '?';
  return {
    '@type': 'Offer',
    price: price.amount,
    priceCurrency: price.currencyCode,
    availability: availability(variant),
    url: pageUrl ? `${pageUrl}${separator}variant=${numericId(variant.id)}` : undefined,
  };
}

/**
 * @param {Product} product
 * @param {ProductVariant} variant
 * @param {string | undefined} pageUrl
 * @param {readonly string[]} images
 */
function variantProduct(product, variant, pageUrl, images) {
  /** @type {[string, string][]} schema.org property name → the variant's value. */
  const properties = variant.selectedOptions.flatMap((option) => {
    const property = VARIES_BY[option.name.toLowerCase()];
    return property ? [[property.split('/').pop() ?? property, option.value]] : [];
  });
  return {
    '@type': 'Product',
    name: `${product.title} - ${variant.title}`,
    sku: variant.sku || undefined,
    image: variant.image?.url || images[0],
    ...Object.fromEntries(properties),
    offers: offer(product, variant, pageUrl),
  };
}

/**
 * @param {Product} product
 * @param {JsonLdOptions} options
 * @param {JsonLdSite} site
 * @returns {string | undefined}
 */
function pageUrlOf(product, { url }, site) {
  if (url) return url;
  const path = productUrl(site.productPath, product.handle, product.id);
  if (!site.siteUrl || !path) return undefined;
  return new URL(path, site.siteUrl).toString();
}

/**
 * @param {Product | null | undefined} product
 * @param {JsonLdOptions} options
 * @param {JsonLdSite} site
 * @returns {Record<string, unknown> | null} The schema.org object, `null` without a product.
 */
export function jsonLdData(product, options, site) {
  if (!product) return null;
  const pageUrl = pageUrlOf(product, options, site);
  const images = product.images.nodes.map((image) => image.url).filter(Boolean);
  const brandName = options.brand || product.vendor;
  const brand = brandName ? { '@type': 'Brand', name: brandName } : undefined;
  const description = product.description.trim() || undefined;
  const variants = product.variants.nodes;
  if (variants.length <= 1) {
    const [variant] = variants;
    return withoutUndefined({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description,
      url: pageUrl,
      image: images,
      sku: variant?.sku || undefined,
      brand,
      offers: variant ? offer(product, variant, pageUrl) : undefined,
    });
  }
  const variesBy = product.options.map((option) => VARIES_BY[option.name.toLowerCase()]).filter(Boolean);
  return withoutUndefined({
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: product.title,
    description,
    url: pageUrl,
    productGroupID: numericId(product.id),
    image: images,
    brand,
    variesBy: [...new Set(variesBy)],
    hasVariant: variants.map((variant) => variantProduct(product, variant, pageUrl, images)),
  });
}
