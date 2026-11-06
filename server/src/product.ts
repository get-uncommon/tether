/**
 * The product shape the field mapping reads: Shopify's `TetherSyncProduct` fragment (see shopify.ts), parsed and
 * flattened. Every key can be a source in the mapping, e.g. `fields: { price: 'price', 'main-image': 'image' }`.
 */
import { SyncError } from './util.ts';
import { asList, asRecord, numberOrNull, stringOrNull, textOrNull } from './json.ts';

interface ProductImage {
  url: string;
  alt: string | null;
}

interface ProductVariant {
  id: string;
  legacyId: string;
  title: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  available: boolean;
  /** Only when the config maps inventory. */
  inventory: number | null;
}

export interface Product {
  /** The product's gid. */
  id: string;
  /** The numeric id, as a string. */
  legacyId: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  tagsText: string;
  /** `ACTIVE`, `DRAFT` or `ARCHIVED`. */
  status: string;
  createdAt: string;
  /** ISO time; the reconcile cursor compares these as strings. */
  updatedAt: string;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** The lowest variant price. */
  price: number | null;
  maxPrice: number | null;
  /** Only when it is above `price`. */
  compareAtPrice: number | null;
  currency: string | null;
  image: ProductImage | null;
  images: ProductImage[];
  available: boolean;
  totalInventory: number | null;
  variantCount: number;
  /** The first variant's. */
  sku: string | null;
  options: { name: string; values: string[] }[];
  variants: ProductVariant[];
  /** By `namespace.key`. */
  metafields: Record<string, string | null>;
}

/** @param raw A `MediaPreviewImage.image`. */
function imageOf(raw: unknown): ProductImage | null {
  const { url, altText } = asRecord(raw);
  return typeof url === 'string' && url ? { url, alt: textOrNull(altText) } : null;
}

/** @param raw A `MoneyV2`. */
function amountOf(raw: unknown): number | null {
  return numberOrNull(asRecord(raw)['amount']);
}

/** @param raw A `{ preview { image } }` selection. */
function previewImage(raw: unknown): unknown {
  return asRecord(asRecord(raw)['preview'])['image'];
}

function idText(value: unknown): string {
  return typeof value === 'number' ? String(value) : (stringOrNull(value) ?? '');
}

function variantOf(raw: unknown): ProductVariant {
  const variant = asRecord(raw);
  return {
    id: stringOrNull(variant['id']) ?? '',
    legacyId: idText(variant['legacyResourceId']),
    title: stringOrNull(variant['title']) ?? '',
    sku: textOrNull(variant['sku']),
    price: numberOrNull(variant['price']),
    compareAtPrice: numberOrNull(variant['compareAtPrice']),
    available: variant['availableForSale'] === true,
    inventory: numberOrNull(variant['inventoryQuantity']),
  };
}

function imagesOf(raw: unknown): ProductImage[] {
  const images: ProductImage[] = [];
  for (const media of asList(asRecord(raw)['nodes'])) {
    const image = imageOf(previewImage(media));
    if (image) images.push(image);
  }
  return images;
}

function optionsOf(raw: unknown): Product['options'] {
  return asList(raw).map((option) => {
    const { name, optionValues } = asRecord(option);
    return {
      name: stringOrNull(name) ?? '',
      values: asList(optionValues).map((value) => stringOrNull(asRecord(value)['name']) ?? ''),
    };
  });
}

/** @param refs The metafields the fragment asked for, in order: `mf0` is `refs[0]`. */
function metafieldsOf(product: Record<string, unknown>, refs: string[]): Record<string, string | null> {
  const metafields: Record<string, string | null> = {};
  refs.forEach((ref, index) => {
    metafields[ref] = stringOrNull(asRecord(product[`mf${String(index)}`])['value']);
  });
  return metafields;
}

function pricesOf(product: Record<string, unknown>) {
  const priceRange = asRecord(product['priceRangeV2']);
  const minPrice = asRecord(priceRange['minVariantPrice']);
  const price = amountOf(minPrice);
  const compareAt = amountOf(asRecord(product['compareAtPriceRange'])['minVariantCompareAtPrice']);
  return {
    price,
    maxPrice: amountOf(priceRange['maxVariantPrice']),
    compareAtPrice: compareAt && price !== null && compareAt > price ? compareAt : null,
    currency: textOrNull(minPrice['currencyCode']),
  };
}

/**
 * Parses one product node of Shopify's answer.
 *
 * @throws {SyncError} When the node has no id: nothing could be matched or synced.
 */
export function normalizeProduct(raw: unknown, metafieldRefs: string[] = []): Product {
  const product = asRecord(raw);
  const id = stringOrNull(product['id']);
  if (!id) throw new SyncError('Shopify returned a product without an id');
  const images = imagesOf(product['media']);
  const variants = asList(asRecord(product['variants'])['nodes']).map(variantOf);
  const tags = asList(product['tags']).filter((tag) => typeof tag === 'string');
  const seo = asRecord(product['seo']);

  return {
    id,
    legacyId: idText(product['legacyResourceId']) || (id.split('/').pop() ?? id),
    handle: stringOrNull(product['handle']) ?? '',
    title: stringOrNull(product['title']) ?? '',
    description: stringOrNull(product['description']) ?? '',
    descriptionHtml: stringOrNull(product['descriptionHtml']) ?? '',
    vendor: stringOrNull(product['vendor']) ?? '',
    productType: stringOrNull(product['productType']) ?? '',
    tags,
    tagsText: tags.join(', '),
    status: stringOrNull(product['status']) ?? '',
    createdAt: stringOrNull(product['createdAt']) ?? '',
    updatedAt: stringOrNull(product['updatedAt']) ?? '',
    publishedAt: textOrNull(product['publishedAt']),
    onlineStoreUrl: textOrNull(product['onlineStoreUrl']),
    seoTitle: textOrNull(seo['title']),
    seoDescription: textOrNull(seo['description']),
    ...pricesOf(product),
    image: imageOf(previewImage(product['featuredMedia'])) ?? images[0] ?? null,
    images,
    available: variants.some((variant) => variant.available),
    totalInventory: numberOrNull(product['totalInventory']),
    variantCount: variants.length,
    sku: variants[0]?.sku ?? null,
    options: optionsOf(product['options']),
    variants,
    metafields: metafieldsOf(product, metafieldRefs),
  };
}
