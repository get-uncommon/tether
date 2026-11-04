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

export const DEFAULT_FIELDS = { name: 'title', slug: 'handle' };

export function normalizeConfig(raw = {}) {
  const idField = raw.match?.idField || 'shopify-id';
  const fields = { ...DEFAULT_FIELDS, [idField]: 'legacyId', ...(raw.fields || {}) };
  const cfg = {
    shopify: { apiVersion: DEFAULT_API_VERSION, metafields: [], inventory: false, ...(raw.shopify || {}) },
    webflow: { perMinute: 50, publish: true, ...(raw.webflow || {}) },
    match: { idField, bySlug: raw.match?.bySlug !== false },
    fields,
    webflowOwned: [...new Set(raw.webflowOwned || [])],
    onDelete: raw.onDelete || 'archive',     // 'archive' | 'delete' | 'unpublish'
    inactive: raw.inactive || 'archive',     // DRAFT/ARCHIVED products: 'archive' | 'unpublish' | 'keep'
    reconcile: { maxChangesPerRun: 20, lookbackMinutes: 60, pageSize: 50, ...(raw.reconcile || {}) },
  };
  // Metafields used in the mapping are fetched automatically.
  Object.values(fields).forEach((src) => {
    if (typeof src === 'string' && src.startsWith('metafield:')) {
      const ref = src.slice(10);
      if (!cfg.shopify.metafields.includes(ref)) cfg.shopify.metafields = [...cfg.shopify.metafields, ref];
    }
  });
  if (!['archive', 'delete', 'unpublish'].includes(cfg.onDelete)) throw new SyncError(`onDelete must be archive, delete or unpublish (got ${cfg.onDelete})`);
  if (!['archive', 'unpublish', 'keep'].includes(cfg.inactive)) throw new SyncError(`inactive must be archive, unpublish or keep (got ${cfg.inactive})`);
  if (cfg.webflowOwned.includes('slug') || cfg.webflowOwned.includes(idField)) {
    throw new SyncError(`"slug" and "${idField}" can't be Webflow-owned: they are how items are matched`);
  }
  return cfg;
}

export function readSource(product, src) {
  if (typeof src === 'function') return src(product);
  if (typeof src !== 'string') return src;
  if (src.startsWith('metafield:')) return product.metafields?.[src.slice(10)] ?? null;
  if (src.startsWith('=')) return src.slice(1); // constant: '=Coffee'
  return src.split('.').reduce((v, k) => (v == null ? undefined : v[k]), product);
}

/** Webflow slugs: lowercase letters, digits and hyphens. Shopify handles already are, mostly. */
export function toSlug(v) {
  return String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 256);
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
  cfg.webflowOwned.forEach((k) => { delete out[k]; });
  return out;
}

/** Checks the mapping against the Webflow collection schema. Returns a list of problems. */
export function checkMapping(cfg, collection) {
  const problems = [];
  const fields = new Map((collection?.fields || []).map((f) => [f.slug, f]));
  Object.entries(cfg.fields).forEach(([slug, src]) => {
    const f = fields.get(slug);
    if (!f) { problems.push(`Webflow field "${slug}" doesn't exist in collection "${collection?.displayName || cfg.webflow.collectionId}".`); return; }
    const type = f.type;
    const s = typeof src === 'string' ? src : '(function)';
    if (type === 'Image' && !['image', '(function)'].includes(s) && !/^images\.\d+$/.test(s)) problems.push(`"${slug}" is an Image field but maps "${s}" (use "image" or "images.0").`);
    if (type === 'MultiImage' && !['images', '(function)'].includes(s)) problems.push(`"${slug}" is a Multi-image field but maps "${s}" (use "images").`);
    if (type === 'Number' && ['tags', 'images', 'image', 'title'].includes(s)) problems.push(`"${slug}" is a Number field but maps "${s}".`);
    if (['PlainText', 'RichText'].includes(type) && ['tags', 'images', 'image', 'variants', 'options'].includes(s)) problems.push(`"${slug}" is a text field but maps "${s}" (an object/list). Use e.g. "tagsText".`);
    if (['Option', 'Reference', 'MultiReference'].includes(type) && s !== '(function)') problems.push(`"${slug}" is an ${type} field: map it with a function that returns Webflow ids.`);
  });
  (collection?.fields || []).filter((f) => f.isRequired && !(f.slug in cfg.fields)).forEach((f) => {
    problems.push(`Required Webflow field "${f.slug}" isn't mapped: creating items will fail.`);
  });
  if (!fields.has(cfg.match.idField)) problems.push(`Add a Plain text field with slug "${cfg.match.idField}" to the collection (it stores the Shopify product id).`);
  cfg.webflowOwned.forEach((k) => { if (!fields.has(k)) problems.push(`webflowOwned "${k}" isn't a field in the collection.`); });
  return problems;
}
