/**
 * The product shape the field mapping reads: Shopify's `TetherSyncProduct` fragment (see shopify.js), parsed and
 * flattened. Every key can be a source in the mapping, e.g. `fields: { price: 'price', 'main-image': 'image' }`.
 */
import { SyncError } from './util.js';
import { asList, asRecord, numberOrNull, stringOrNull, textOrNull } from './json.js';

/** @typedef {{ url: string, alt: string | null }} ProductImage */

/**
 * @typedef {object} ProductVariant
 * @property {string} id
 * @property {string} legacyId
 * @property {string} title
 * @property {string | null} sku
 * @property {number | null} price
 * @property {number | null} compareAtPrice
 * @property {boolean} available
 * @property {number | null} inventory Only when the config maps inventory.
 */

/**
 * @typedef {object} Product
 * @property {string} id The product's gid.
 * @property {string} legacyId The numeric id, as a string.
 * @property {string} handle
 * @property {string} title
 * @property {string} description
 * @property {string} descriptionHtml
 * @property {string} vendor
 * @property {string} productType
 * @property {string[]} tags
 * @property {string} tagsText
 * @property {string} status `ACTIVE`, `DRAFT` or `ARCHIVED`.
 * @property {string} createdAt
 * @property {string} updatedAt ISO time; the reconcile cursor compares these as strings.
 * @property {string | null} publishedAt
 * @property {string | null} onlineStoreUrl
 * @property {string | null} seoTitle
 * @property {string | null} seoDescription
 * @property {number | null} price The lowest variant price.
 * @property {number | null} maxPrice
 * @property {number | null} compareAtPrice Only when it is above `price`.
 * @property {string | null} currency
 * @property {ProductImage | null} image
 * @property {ProductImage[]} images
 * @property {boolean} available
 * @property {number | null} totalInventory
 * @property {number} variantCount
 * @property {string | null} sku The first variant's.
 * @property {{ name: string, values: string[] }[]} options
 * @property {ProductVariant[]} variants
 * @property {Record<string, string | null>} metafields By `namespace.key`.
 */

/**
 * @param {unknown} raw A `MediaPreviewImage.image`.
 * @returns {ProductImage | null}
 */
function imageOf(raw) {
  const { url, altText } = asRecord(raw);
  return typeof url === 'string' && url ? { url, alt: textOrNull(altText) } : null;
}

/** @param {unknown} raw A `MoneyV2`. */
function amountOf(raw) {
  return numberOrNull(asRecord(raw)['amount']);
}

/** @param {unknown} raw A `{ preview { image } }` selection. */
function previewImage(raw) {
  return asRecord(asRecord(raw)['preview'])['image'];
}

/** @param {unknown} value */
function idText(value) {
  return typeof value === 'number' ? String(value) : (stringOrNull(value) ?? '');
}

/**
 * @param {unknown} raw
 * @returns {ProductVariant}
 */
function variantOf(raw) {
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

/** @param {unknown} raw */
function imagesOf(raw) {
  /** @type {ProductImage[]} */
  const images = [];
  for (const media of asList(asRecord(raw)['nodes'])) {
    const image = imageOf(previewImage(media));
    if (image) images.push(image);
  }
  return images;
}

/** @param {unknown} raw */
function optionsOf(raw) {
  return asList(raw).map((option) => {
    const { name, optionValues } = asRecord(option);
    return {
      name: stringOrNull(name) ?? '',
      values: asList(optionValues).map((value) => stringOrNull(asRecord(value)['name']) ?? ''),
    };
  });
}

/**
 * @param {Record<string, unknown>} product
 * @param {string[]} refs The metafields the fragment asked for, in order: `mf0` is `refs[0]`.
 */
function metafieldsOf(product, refs) {
  /** @type {Record<string, string | null>} */
  const metafields = {};
  refs.forEach((ref, index) => {
    metafields[ref] = stringOrNull(asRecord(product[`mf${String(index)}`])['value']);
  });
  return metafields;
}

/** @param {Record<string, unknown>} product */
function pricesOf(product) {
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
 * @param {unknown} raw
 * @param {string[]} [metafieldRefs]
 * @returns {Product}
 * @throws {SyncError} When the node has no id: nothing could be matched or synced.
 */
export function normalizeProduct(raw, metafieldRefs = []) {
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
