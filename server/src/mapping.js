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
import { isRecord, SyncError, scalarText } from './util.js';
import { DEFAULT_API_VERSION } from './shopify.js';

/** @typedef {import('./env.js').CleanEnv} CleanEnv */
/** @typedef {import('./webflow.js').WebflowCollection} WebflowCollection */

/** @typedef {import('./product.js').Product} Product */

/** @typedef {(product: Product) => unknown} FieldFunction */
/** A value written as-is: any JSON value a FIELD_MAP or a config file can hold other than a string. */
/** @typedef {number | boolean | readonly unknown[] | { readonly [key: string]: unknown }} FieldConstant */
/**
 * A source path (`'title'`, `'variants.0.sku'`, `'metafield:custom.material'`, `'=constant'`), a function of the
 * product, or a constant.
 *
 * @typedef {string | FieldFunction | FieldConstant} FieldSource
 */

/** @typedef {Record<string, unknown>} FieldData A Webflow item's fieldData, keyed by field slug. */

/**
 * @typedef {object} ShopifySettings
 * @property {string} [domain]
 * @property {string} apiVersion
 * @property {string[]} metafields `namespace.key` references fetched with every product.
 * @property {boolean} inventory
 * @property {string} [query] A product search that limits `import`.
 */

/**
 * @typedef {object} WebflowSettings
 * @property {string} [collectionId]
 * @property {number} perMinute
 * @property {boolean} publish
 * @property {boolean} skipMissingFields
 */

/**
 * @typedef {object} MatchSettings
 * @property {string} idField The collection field that stores the Shopify product id.
 * @property {boolean} bySlug Adopt a hand-made item whose slug is the product's handle.
 * @property {number} indexTtlMinutes
 */

/**
 * @typedef {object} ReconcileSettings
 * @property {number} maxChangesPerRun Webflow writes.
 * @property {number} maxProductsPerRun Products checked (one store read each).
 * @property {number} maxPagesPerRun Shopify pages.
 * @property {number} reserveSubrequests A Worker run stops while this many subrequests are left.
 * @property {number} overlapMinutes How far each window re-reads the previous one: Shopify's search index lags.
 * @property {number} lookbackMinutes How far back the first reconcile without a cursor looks.
 */

/** @typedef {'archive' | 'delete' | 'unpublish'} OnDelete What a product deleted in Shopify does to its item. */
/** @typedef {'archive' | 'unpublish' | 'keep'} InactiveAction What a DRAFT or ARCHIVED product does to its item. */

/**
 * The config file (tether-sync.config.js or .json) as written: every key is optional.
 *
 * @typedef {object} RawConfig
 * @property {Partial<ShopifySettings>} [shopify]
 * @property {Partial<WebflowSettings>} [webflow]
 * @property {Partial<MatchSettings>} [match]
 * @property {Record<string, FieldSource>} [fields]
 * @property {string[]} [webflowOwned]
 * @property {string} [onDelete]
 * @property {string} [inactive]
 * @property {Partial<ReconcileSettings>} [reconcile]
 */

/**
 * The config with every default filled in and checked.
 *
 * @typedef {object} SyncConfig
 * @property {ShopifySettings} shopify
 * @property {WebflowSettings} webflow
 * @property {MatchSettings} match
 * @property {Record<string, FieldSource>} fields
 * @property {string[]} webflowOwned Written when an item is created, never overwritten.
 * @property {OnDelete} onDelete
 * @property {InactiveAction} inactive
 * @property {ReconcileSettings} reconcile
 */

/** @typedef {{ level: 'error' | 'warn', message: string, fix: string }} MappingProblem */

const DEFAULT_FIELDS = { name: 'title', slug: 'handle' };
const METAFIELD_PREFIX = 'metafield:';
const MINUTES_PER_DAY = 24 * 60;
/** @type {readonly OnDelete[]} */
const ON_DELETE = ['archive', 'delete', 'unpublish'];
/** @type {readonly InactiveAction[]} */
const INACTIVE = ['archive', 'unpublish', 'keep'];

/**
 * @template {string} T
 * @param {string} value
 * @param {readonly T[]} allowed
 * @returns {value is T}
 */
function isOneOf(value, allowed) {
  return /** @type {readonly string[]} */ (allowed).includes(value);
}

/**
 * The `namespace.key` references the mapping reads, added to the configured ones: they are fetched automatically.
 *
 * @param {readonly string[]} configured
 * @param {Record<string, FieldSource>} fields
 */
function metafieldsFor(configured, fields) {
  const refs = [...configured];
  for (const source of Object.values(fields)) {
    if (typeof source !== 'string' || !source.startsWith(METAFIELD_PREFIX)) continue;
    const ref = source.slice(METAFIELD_PREFIX.length);
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * Fills in the defaults and checks the choices. Normalizing a config twice gives the same config.
 *
 * @param {RawConfig} [raw]
 * @returns {SyncConfig}
 * @throws {SyncError} When `onDelete` or `inactive` is not one of its values, or `slug` or the id field is Webflow-owned.
 */
export function normalizeConfig(raw = {}) {
  const idField = raw.match?.idField || 'shopify-id';
  const fields = { ...DEFAULT_FIELDS, [idField]: 'legacyId', ...(raw.fields ?? {}) };
  const onDelete = raw.onDelete || 'archive';
  const inactive = raw.inactive || 'archive';
  const webflowOwned = [...new Set(raw.webflowOwned ?? [])];
  if (!isOneOf(onDelete, ON_DELETE))
    throw new SyncError(`onDelete must be archive, delete or unpublish (got ${onDelete})`);
  if (!isOneOf(inactive, INACTIVE))
    throw new SyncError(`inactive must be archive, unpublish or keep (got ${inactive})`);
  if (webflowOwned.includes('slug') || webflowOwned.includes(idField)) {
    throw new SyncError(`"slug" and "${idField}" can't be Webflow-owned: they are how items are matched`);
  }
  const shopify = { apiVersion: DEFAULT_API_VERSION, metafields: [], inventory: false, ...(raw.shopify ?? {}) };
  return {
    shopify: { ...shopify, metafields: metafieldsFor(shopify.metafields, fields) },
    webflow: { perMinute: 50, publish: true, skipMissingFields: false, ...(raw.webflow ?? {}) },
    match: {
      idField,
      bySlug: raw.match?.bySlug !== false,
      indexTtlMinutes: raw.match?.indexTtlMinutes ?? MINUTES_PER_DAY,
    },
    fields,
    webflowOwned,
    onDelete,
    inactive,
    reconcile: {
      maxChangesPerRun: 20,
      maxProductsPerRun: 200,
      maxPagesPerRun: 10,
      reserveSubrequests: 8,
      overlapMinutes: 5,
      lookbackMinutes: 60,
      ...(raw.reconcile ?? {}),
    },
  };
}

/**
 * A FIELD_MAP value as a source. JSON holds no functions, so anything but a string is a constant.
 *
 * @param {unknown} value Any JSON value but `null`.
 * @returns {FieldSource}
 */
function fieldSourceFromJson(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    /** @type {readonly unknown[]} */
    const list = value;
    return list;
  }
  return /** @type {{ readonly [key: string]: unknown }} */ (value);
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>}
 * @throws {SyncError} `FIELD_MAP` when it is not a JSON object.
 */
function parseFieldMap(text) {
  /** @type {unknown} */
  let map;
  try {
    map = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SyncError(`FIELD_MAP is not valid JSON: ${reason}`, { code: 'FIELD_MAP' });
  }
  if (!isRecord(map))
    throw new SyncError('FIELD_MAP must be a JSON object like {"webflow-field":"shopifySource"}', {
      code: 'FIELD_MAP',
    });
  return map;
}

/**
 * Environment overrides on top of the config file:
 *   FIELD_MAP='{"material":"metafield:custom.material","gallery":null}'  (null removes a field)
 *   WEBFLOW_OWNED='description,intro'
 *
 * @param {RawConfig} [raw]
 * @param {CleanEnv} [env]
 * @returns {RawConfig}
 */
export function applyEnv(raw = {}, env = {}) {
  const fields = new Map(Object.entries(raw.fields ?? {}));
  const out = { ...raw, shopify: { ...(raw.shopify ?? {}) }, webflow: { ...(raw.webflow ?? {}) } };
  if (env.SHOPIFY_DOMAIN) out.shopify.domain = env.SHOPIFY_DOMAIN;
  if (env.SHOPIFY_API_VERSION) out.shopify.apiVersion = env.SHOPIFY_API_VERSION;
  if (env.WEBFLOW_COLLECTION_ID) out.webflow.collectionId = env.WEBFLOW_COLLECTION_ID;
  if (env.FIELD_MAP) {
    for (const [slug, source] of Object.entries(parseFieldMap(env.FIELD_MAP))) {
      if (source === null) fields.delete(slug);
      else fields.set(slug, fieldSourceFromJson(source));
    }
  }
  /** @type {RawConfig} */
  const withFields = { ...out, fields: Object.fromEntries(fields) };
  if (env.WEBFLOW_OWNED)
    withFields.webflowOwned = env.WEBFLOW_OWNED.split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);
  return withFields;
}

/**
 * One step of a dotted path. Primitives have properties too (`'abc'.length`), so only `null` and `undefined` stop it.
 *
 * @param {unknown} value
 * @param {string} key
 */
function propertyOf(value, key) {
  if (value == null) return undefined;
  return /** @type {Record<string, unknown>} */ (value)[key];
}

/**
 * @param {Product} product
 * @param {FieldSource} source
 * @returns {unknown}
 */
function readSource(product, source) {
  if (typeof source === 'function') return source(product);
  if (typeof source !== 'string') return source;
  if (source.startsWith(METAFIELD_PREFIX)) return product.metafields[source.slice(METAFIELD_PREFIX.length)] ?? null;
  if (source.startsWith('=')) return source.slice(1);
  return source.split('.').reduce(propertyOf, /** @type {unknown} */ (product));
}

/**
 * Webflow slugs: lowercase letters, digits and hyphens. Shopify handles already are, mostly.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function toSlug(value) {
  return scalarText(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 256);
}

/**
 * Full fieldData for a product, owned fields included: {@link withoutOwned} strips them for updates.
 *
 * @param {Product} product
 * @param {SyncConfig} cfg
 * @returns {FieldData}
 */
export function mapProduct(product, cfg) {
  /** @type {FieldData} */
  const out = {};
  for (const [slug, source] of Object.entries(cfg.fields)) {
    const value = readSource(product, source);
    if (value === undefined) continue;
    if (slug === 'slug') out[slug] = toSlug(value);
    else if (slug === cfg.match.idField && value != null) out[slug] = scalarText(value);
    else out[slug] = value;
  }
  if (!out['name']) out['name'] = product.title || product.handle;
  if (!out['slug']) out['slug'] = toSlug(product.handle);
  return out;
}

/**
 * @param {FieldData} fieldData
 * @param {SyncConfig} cfg
 * @returns {FieldData}
 */
export function withoutOwned(fieldData, cfg) {
  return Object.fromEntries(Object.entries(fieldData).filter(([slug]) => !cfg.webflowOwned.includes(slug)));
}

/** Names a function source in the checks, which can only see that it is one. */
const FUNCTION_SOURCE = '(function)';

/**
 * What is wrong with mapping `source` to a field of `type`, as [message, fix], or `null`.
 *
 * @param {string} slug
 * @param {string} type
 * @param {string} source
 * @returns {[string, string] | null}
 */
function typeMismatch(slug, type, source) {
  if (type === 'Image' && !['image', FUNCTION_SOURCE].includes(source) && !/^images\.\d+$/.test(source))
    return [`"${slug}" is an Image field but maps "${source}".`, 'Map it to "image" or "images.0".'];
  if (type === 'MultiImage' && !['images', FUNCTION_SOURCE].includes(source))
    return [`"${slug}" is a Multi-image field but maps "${source}".`, 'Map it to "images".'];
  if (type === 'Number' && ['tags', 'tagsText', 'images', 'image', 'title', 'handle', 'vendor'].includes(source))
    return [
      `"${slug}" is a Number field but maps "${source}".`,
      'Map a number such as "price", or change the field type.',
    ];
  if (type === 'Switch' && !['available', FUNCTION_SOURCE].includes(source) && !source.startsWith(METAFIELD_PREFIX))
    return [
      `"${slug}" is a Switch field but maps "${source}".`,
      'Map a true/false source such as "available", or a function.',
    ];
  if (['PlainText', 'RichText'].includes(type) && ['tags', 'images', 'image', 'variants', 'options'].includes(source))
    return [
      `"${slug}" is a text field but maps "${source}" (an object/list).`,
      'Use "tagsText" for tags, or a function that returns text.',
    ];
  if (['Option', 'Reference', 'MultiReference'].includes(type) && source !== FUNCTION_SOURCE)
    return [`"${slug}" is an ${type} field.`, 'Map it with a function that returns Webflow ids.'];
  return null;
}

/**
 * Checks the mapping against the Webflow collection schema.
 *
 * @param {SyncConfig} cfg
 * @param {WebflowCollection | null | undefined} collection
 * @returns {MappingProblem[]}
 */
export function checkMapping(cfg, collection) {
  /** @type {MappingProblem[]} */
  const problems = [];
  /** @param {MappingProblem['level']} level @param {string} message @param {string} fix */
  const add = (level, message, fix) => problems.push({ level, message, fix });
  const collectionFields = collection?.fields ?? [];
  const fields = new Map(collectionFields.map((field) => [field.slug, field]));
  const name = collection?.displayName || cfg.webflow.collectionId;
  for (const [slug, source] of Object.entries(cfg.fields)) {
    const field = fields.get(slug);
    if (!field) {
      if (cfg.webflow.skipMissingFields)
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
      continue;
    }
    const mismatch = typeMismatch(slug, field.type, typeof source === 'string' ? source : FUNCTION_SOURCE);
    if (mismatch) add('error', ...mismatch);
  }
  for (const field of collectionFields) {
    if (!field.isRequired || field.slug in cfg.fields) continue;
    add(
      'error',
      `Required Webflow field "${field.slug}" isn't mapped: creating items will fail.`,
      `Map "${field.slug}" in the config (or FIELD_MAP), or make it optional in Webflow.`,
    );
  }
  if (!fields.has(cfg.match.idField))
    add(
      'error',
      `The collection has no "${cfg.match.idField}" field.`,
      `Add a Plain text field named "Shopify ID" (slug "${cfg.match.idField}"): it stores the Shopify product id.`,
    );
  for (const slug of cfg.webflowOwned) {
    if (!fields.has(slug))
      add(
        'warn',
        `webflowOwned "${slug}" isn't a field in the collection.`,
        'Remove it from webflowOwned or add the field.',
      );
  }
  return problems;
}

/**
 * Drops mapped fields the collection doesn't have (webflow.skipMissingFields).
 *
 * @param {FieldData} fieldData
 * @param {Set<string> | null} fieldSlugs `null` keeps every field.
 * @returns {FieldData}
 */
export function onlyExisting(fieldData, fieldSlugs) {
  if (!fieldSlugs) return fieldData;
  /** @type {FieldData} */
  const out = {};
  for (const [slug, value] of Object.entries(fieldData)) {
    if (slug === 'name' || slug === 'slug' || fieldSlugs.has(slug)) out[slug] = value;
  }
  return out;
}
