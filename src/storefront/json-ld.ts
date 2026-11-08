/**
 * schema.org data for search engines (Google's product rich results): a `Product`, or a `ProductGroup` with one
 * `Product` per variant, each with its price, currency, stock, sku, image and `?variant=` link. Products that are only
 * sold on a subscription are priced at their first plan.
 */
import { allPlans, allocationFor, planPrice } from '../selling-plans.ts';
import { productUrl } from '../shopify-values.ts';
import type { Product, ProductVariant } from '../fragments.ts';
import type { Money } from '../shopify-values.ts';

export interface JsonLdOptions {
  /** The product page's absolute URL; default from the storefront's `siteUrl`. */
  url?: string;
  /** Default the product's vendor. */
  brand?: string;
}

/** Where the product pages are. */
interface JsonLdSite {
  productPath: string;
  siteUrl: string | undefined;
}

/** The option names schema.org has a property for: a `ProductGroup` varies by them. */
const VARIES_BY: Readonly<Record<string, string>> = {
  size: 'https://schema.org/size',
  color: 'https://schema.org/color',
  colour: 'https://schema.org/color',
  material: 'https://schema.org/material',
};

/**
 * Text for a `<script>` tag: `<` is escaped so product text can never close the tag, and U+2028 / U+2029 so older
 * JavaScript parsers read it.
 */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/** @returns `value` without its `undefined` fields, nested ones too. */
function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  // The JSON of an object is an object.
  return copy as Record<string, unknown>;
}

const numericId = (gid: string) => gid.split('/').pop() ?? gid;

/** @returns The schema.org availability. */
function availability(variant: ProductVariant): string {
  if (!variant.availableForSale) return 'https://schema.org/OutOfStock';
  return variant.currentlyNotInStock ? 'https://schema.org/BackOrder' : 'https://schema.org/InStock';
}

/** @returns The variant's price, or its first plan's for a product sold only on a subscription. */
function offeredPrice(product: Product, variant: ProductVariant): Money {
  if (!product.requiresSellingPlan) return variant.price;
  const plan = allPlans(product).find((candidate) => allocationFor(variant, candidate.id));
  return (plan && planPrice(variant, plan.id)) ?? variant.price;
}

function offer(product: Product, variant: ProductVariant, pageUrl: string | undefined) {
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

function variantProduct(
  product: Product,
  variant: ProductVariant,
  pageUrl: string | undefined,
  images: readonly string[],
) {
  // schema.org property name → the variant's value.
  const properties = variant.selectedOptions.flatMap((option): [string, string][] => {
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

function pageUrlOf(product: Product, { url }: JsonLdOptions, site: JsonLdSite): string | undefined {
  if (url) return url;
  const path = productUrl(site.productPath, product.handle, product.id);
  if (!site.siteUrl || !path) return undefined;
  return new URL(path, site.siteUrl).toString();
}

/** @returns The schema.org object, `null` without a product. */
export function jsonLdData(
  product: Product | null | undefined,
  options: JsonLdOptions,
  site: JsonLdSite,
): Record<string, unknown> | null {
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
