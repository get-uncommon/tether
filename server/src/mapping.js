// @ts-nocheck
/**
 * Field mapping: Shopify product (normalized, see shopify.js) -> Webflow fieldData.
 *
 *   fields: {
 *     name: 'title',                      // Webflow field slug: source
 *     slug: 'handle',
 *     'shopify-id': 'legacyId',
 *     price: 'price',
 *     'main-image': 'image',              // { url, alt } -> Image field
 *     gallery: 'images',                  // Multi-image field
 *     material: 'metafield:custom.material',
 *     'first-sku': 'variants.0.sku',      // dotted paths work
 *     badge: (p) => (p.compareAtPrice ? 'Sale' : ''),  // or a function (JS config only)
 *   },
 *   webflowOwned: ['description'],        // written when the item is created, never overwritten
 */
import { SyncError } from './util.js';
import { DEFAULT_API_VERSION } from './shopify.js';

const DEFAULT_FIELDS = { name: 'title', slug: 'handle' };

export function normalizeConfig(raw = {}) {
  const idField = raw.match?.idField || 'shopify-id';
  const fields = { ...DEFAULT_FIELDS, [idField]: 'legacyId', ...(raw.fields || {}) };
  const cfg = {
    shopify: { apiVersion: DEFAULT_API_VERSION, metafields: [], inventory: false, ...(raw.shopify || {}) },
    webflow: { perMinute: 50, publish: true, skipMissingFields: false, ...(raw.webflow || {}) },
    match: { idField, bySlug: raw.match?.bySlug !== false, indexTtlMinutes: raw.match?.indexTtlMinutes ?? 24 * 60 },
    fields,
    webflowOwned: [...new Set(raw.webflowOwned || [])],
    onDelete: raw.onDelete || 'archive', // 'archive' | 'delete' | 'unpublish'
    inactive: raw.inactive || 'archive', // DRAFT/ARCHIVED products: 'archive' | 'unpublish' | 'keep'
    reconcile: {
      maxChangesPerRun: 20, // Webflow writes
      maxProductsPerRun: 200, // products checked (KV reads)
      maxPagesPerRun: 10, // Shopify pages
      reserveSubrequests: 8, // stop while this many subrequests are left (Worker budget)
      overlapMinutes: 5, // re-read the end of the previous window (Shopify's search index lags)
      lookbackMinutes: 60,
      ...(raw.reconcile || {}),
    },
  };
  // Metafields used in the mapping are fetched automatically.
  Object.values(fields).forEach((src) => {
    if (typeof src === 'string' && src.startsWith('metafield:')) {
      const ref = src.slice(10);
      if (!cfg.shopify.metafields.includes(ref)) cfg.shopify.metafields = [...cfg.shopify.metafields, ref];
    }
  });
  if (!['archive', 'delete', 'unpublish'].includes(cfg.onDelete))
    throw new SyncError(`onDelete must be archive, delete or unpublish (got ${cfg.onDelete})`);
  if (!['archive', 'unpublish', 'keep'].includes(cfg.inactive))
    throw new SyncError(`inactive must be archive, unpublish or keep (got ${cfg.inactive})`);
  if (cfg.webflowOwned.includes('slug') || cfg.webflowOwned.includes(idField)) {
    throw new SyncError(`"slug" and "${idField}" can't be Webflow-owned: they are how items are matched`);
  }
  return cfg;
}

/**
 * Environment overrides on top of the config file:
 *   FIELD_MAP='{"material":"metafield:custom.material","gallery":null}'  (null removes a field)
 *   WEBFLOW_OWNED='description,intro'
 */
export function applyEnv(raw = {}, env = {}) {
  const out = {
    ...raw,
    shopify: { ...(raw.shopify || {}) },
    webflow: { ...(raw.webflow || {}) },
    fields: { ...(raw.fields || {}) },
  };
  if (env.SHOPIFY_DOMAIN) out.shopify.domain = env.SHOPIFY_DOMAIN;
  if (env.SHOPIFY_API_VERSION) out.shopify.apiVersion = env.SHOPIFY_API_VERSION;
  if (env.WEBFLOW_COLLECTION_ID) out.webflow.collectionId = env.WEBFLOW_COLLECTION_ID;
  if (env.FIELD_MAP) {
    let map;
    try {
      map = JSON.parse(env.FIELD_MAP);
    } catch (err) {
      throw new SyncError(`FIELD_MAP is not valid JSON: ${err.message}`, { code: 'FIELD_MAP' });
    }
    if (!map || typeof map !== 'object' || Array.isArray(map))
      throw new SyncError('FIELD_MAP must be a JSON object like {"webflow-field":"shopifySource"}', {
        code: 'FIELD_MAP',
      });
    Object.entries(map).forEach(([k, v]) => {
      if (v === null) delete out.fields[k];
      else out.fields[k] = v;
    });
  }
  if (env.WEBFLOW_OWNED)
    out.webflowOwned = env.WEBFLOW_OWNED.split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return out;
}

function readSource(product, src) {
  if (typeof src === 'function') return src(product);
  if (typeof src !== 'string') return src;
  if (src.startsWith('metafield:')) return product.metafields?.[src.slice(10)] ?? null;
  if (src.startsWith('=')) return src.slice(1); // constant: '=Coffee'
  return src.split('.').reduce((v, k) => (v == null ? undefined : v[k]), product);
}

/** Webflow slugs: lowercase letters, digits and hyphens. Shopify handles already are, mostly. */
export function toSlug(v) {
  return String(v || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 256);
}

/** Full fieldData for a product (owned fields included; strip them for updates). */
export function mapProduct(product, cfg) {
  const out = {};
  Object.entries(cfg.fields).forEach(([slug, src]) => {
    let v = readSource(product, src);
    if (v === undefined) return;
    if (slug === 'slug') v = toSlug(v);
    else if (slug === cfg.match.idField && v != null) v = String(v);
    out[slug] = v;
  });
  if (!out.name) out.name = product.title || product.handle;
  if (!out.slug) out.slug = toSlug(product.handle);
  return out;
}

export function withoutOwned(fieldData, cfg) {
  const out = { ...fieldData };
  cfg.webflowOwned.forEach((k) => {
    delete out[k];
  });
  return out;
}

/**
 * Checks the mapping against the Webflow collection schema.
 * Returns [{ level: 'error' | 'warn', message, fix }].
 */
export function checkMapping(cfg, collection) {
  const problems = [];
  const add = (level, message, fix) => problems.push({ level, message, fix });
  const fields = new Map((collection?.fields || []).map((f) => [f.slug, f]));
  const name = collection?.displayName || cfg.webflow.collectionId;
  const skip = cfg.webflow.skipMissingFields;
  Object.entries(cfg.fields).forEach(([slug, src]) => {
    const f = fields.get(slug);
    if (!f) {
      if (skip)
        add(
          'warn',
          `Webflow field "${slug}" doesn't exist in "${name}": it is skipped.`,
          `Add a field with slug "${slug}" to sync it, or remove it from the mapping.`,
        );
      else
        add(
          'error',
          `Webflow field "${slug}" doesn't exist in "${name}".`,
          `Add the field, or remove it from the mapping (or set webflow.skipMissingFields).`,
        );
      return;
    }
    const type = f.type;
    const s = typeof src === 'string' ? src : '(function)';
    const bad = (msg, fix) => add('error', msg, fix);
    if (type === 'Image' && !['image', '(function)'].includes(s) && !/^images\.\d+$/.test(s))
      bad(`"${slug}" is an Image field but maps "${s}".`, 'Map it to "image" or "images.0".');
    if (type === 'MultiImage' && !['images', '(function)'].includes(s))
      bad(`"${slug}" is a Multi-image field but maps "${s}".`, 'Map it to "images".');
    if (type === 'Number' && ['tags', 'tagsText', 'images', 'image', 'title', 'handle', 'vendor'].includes(s))
      bad(`"${slug}" is a Number field but maps "${s}".`, 'Map a number such as "price", or change the field type.');
    if (type === 'Switch' && !['available', '(function)'].includes(s) && !s.startsWith('metafield:'))
      bad(
        `"${slug}" is a Switch field but maps "${s}".`,
        'Map a true/false source such as "available", or a function.',
      );
    if (['PlainText', 'RichText'].includes(type) && ['tags', 'images', 'image', 'variants', 'options'].includes(s))
      bad(
        `"${slug}" is a text field but maps "${s}" (an object/list).`,
        'Use "tagsText" for tags, or a function that returns text.',
      );
    if (['Option', 'Reference', 'MultiReference'].includes(type) && s !== '(function)')
      bad(`"${slug}" is an ${type} field.`, 'Map it with a function that returns Webflow ids.');
  });
  (collection?.fields || [])
    .filter((f) => f.isRequired && !(f.slug in cfg.fields))
    .forEach((f) => {
      add(
        'error',
        `Required Webflow field "${f.slug}" isn't mapped: creating items will fail.`,
        `Map "${f.slug}" in the config (or FIELD_MAP), or make it optional in Webflow.`,
      );
    });
  if (!fields.has(cfg.match.idField))
    add(
      'error',
      `The collection has no "${cfg.match.idField}" field.`,
      `Add a Plain text field named "Shopify ID" (slug "${cfg.match.idField}"): it stores the Shopify product id.`,
    );
  cfg.webflowOwned.forEach((k) => {
    if (!fields.has(k))
      add(
        'warn',
        `webflowOwned "${k}" isn't a field in the collection.`,
        'Remove it from webflowOwned or add the field.',
      );
  });
  return problems;
}

/** Drops mapped fields the collection doesn't have (webflow.skipMissingFields). */
export function onlyExisting(fieldData, fieldSlugs) {
  if (!fieldSlugs) return fieldData;
  const out = {};
  Object.entries(fieldData).forEach(([k, v]) => {
    if (k === 'name' || k === 'slug' || fieldSlugs.has(k)) out[k] = v;
  });
  return out;
}
