/**
 * Field mapping: Shopify product (normalized, see shopify.ts) -> Webflow fieldData.
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
import { isRecord } from './shared/json.ts';
import { messageOf } from './shared/error-message.ts';
import { SyncError, scalarText } from './util.ts';
import { DEFAULT_API_VERSION } from './shopify.ts';

import type { CleanEnv } from './env.ts';
import type { Product } from './product.ts';
import type { WebflowCollection } from './webflow.ts';

type FieldFunction = (product: Product) => unknown;
/** A value written as-is: any JSON value a FIELD_MAP or a config file can hold other than a string. */
type FieldConstant = number | boolean | readonly unknown[] | Readonly<Record<string, unknown>>;
/**
 * A source path (`'title'`, `'variants.0.sku'`, `'metafield:custom.material'`, `'=constant'`), a function of the
 * product, or a constant.
 */
export type FieldSource = string | FieldFunction | FieldConstant;

/** A Webflow item's fieldData, keyed by field slug. */
export type FieldData = Record<string, unknown>;

interface ShopifySettings {
  domain?: string;
  apiVersion: string;
  /** `namespace.key` references fetched with every product. */
  metafields: string[];
  inventory: boolean;
  /** A product search that limits `import`. */
  query?: string;
}

interface WebflowSettings {
  collectionId?: string;
  perMinute: number;
  publish: boolean;
  skipMissingFields: boolean;
}

export interface MatchSettings {
  /** The collection field that stores the Shopify product id. */
  idField: string;
  /** Adopt a hand-made item whose slug is the product's handle. */
  bySlug: boolean;
  indexTtlMinutes: number;
}

interface ReconcileSettings {
  /** Webflow writes. */
  maxChangesPerRun: number;
  /** Products checked (one store read each). */
  maxProductsPerRun: number;
  /** Shopify pages. */
  maxPagesPerRun: number;
  /** A Worker run stops while this many subrequests are left. */
  reserveSubrequests: number;
  /** How far each window re-reads the previous one: Shopify's search index lags. */
  overlapMinutes: number;
  /** How far back the first reconcile without a cursor looks. */
  lookbackMinutes: number;
}

/** What a product deleted in Shopify does to its item. */
type OnDelete = 'archive' | 'delete' | 'unpublish';
/** What a DRAFT or ARCHIVED product does to its item. */
type InactiveAction = 'archive' | 'unpublish' | 'keep';

/** The config file (tether-sync.config.js or .json) as written: every key is optional. */
export interface RawConfig {
  shopify?: Partial<ShopifySettings>;
  webflow?: Partial<WebflowSettings>;
  match?: Partial<MatchSettings>;
  fields?: Record<string, FieldSource>;
  webflowOwned?: string[];
  onDelete?: string;
  inactive?: string;
  reconcile?: Partial<ReconcileSettings>;
}

/** The config with every default filled in and checked. */
export interface SyncConfig {
  shopify: ShopifySettings;
  webflow: WebflowSettings;
  match: MatchSettings;
  fields: Record<string, FieldSource>;
  /** Written when an item is created, never overwritten. */
  webflowOwned: string[];
  onDelete: OnDelete;
  inactive: InactiveAction;
  reconcile: ReconcileSettings;
}

export interface MappingProblem {
  level: 'error' | 'warn';
  message: string;
  fix: string;
}

const DEFAULT_FIELDS = { name: 'title', slug: 'handle' };
const METAFIELD_PREFIX = 'metafield:';
const MINUTES_PER_DAY = 24 * 60;
const ON_DELETE: readonly OnDelete[] = ['archive', 'delete', 'unpublish'];
const INACTIVE: readonly InactiveAction[] = ['archive', 'unpublish', 'keep'];

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((item) => item === value);
}

/** The `namespace.key` references the mapping reads, added to the configured ones: they are fetched automatically. */
function metafieldsFor(configured: readonly string[], fields: Record<string, FieldSource>): string[] {
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
 * @throws {SyncError} When `onDelete` or `inactive` is not one of its values, or `slug` or the id field is Webflow-owned.
 */
export function normalizeConfig(raw: RawConfig = {}): SyncConfig {
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
  const shopify: ShopifySettings = {
    apiVersion: DEFAULT_API_VERSION,
    metafields: [],
    inventory: false,
    ...(raw.shopify ?? {}),
  };
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
 * @param value Any JSON value but `null`.
 */
function fieldSourceFromJson(value: unknown): FieldSource {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const list: readonly unknown[] = value;
    return list;
  }
  // JSON.parse yields nothing else than the cases above, `null` and objects.
  return value as Readonly<Record<string, unknown>>;
}

/** @throws {SyncError} `FIELD_MAP` when it is not a JSON object. */
function parseFieldMap(text: string): Record<string, unknown> {
  let map: unknown;
  try {
    map = JSON.parse(text);
  } catch (err) {
    const reason = messageOf(err);
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
 */
export function applyEnv(raw: RawConfig = {}, env: CleanEnv = {}): RawConfig {
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
  const withFields: RawConfig = { ...out, fields: Object.fromEntries(fields) };
  if (env.WEBFLOW_OWNED)
    withFields.webflowOwned = env.WEBFLOW_OWNED.split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);
  return withFields;
}

/** One step of a dotted path. Primitives have properties too (`'abc'.length`), so only `null` and `undefined` stop it. */
function propertyOf(value: unknown, key: string): unknown {
  if (value == null) return undefined;
  // A primitive is boxed for the property read, so reading it like a record is what JavaScript does anyway.
  return (value as Record<string, unknown>)[key];
}

function readSource(product: Product, source: FieldSource): unknown {
  if (typeof source === 'function') return source(product);
  if (typeof source !== 'string') return source;
  if (source.startsWith(METAFIELD_PREFIX)) return product.metafields[source.slice(METAFIELD_PREFIX.length)] ?? null;
  if (source.startsWith('=')) return source.slice(1);
  return source.split('.').reduce<unknown>(propertyOf, product);
}

/** Webflow slugs: lowercase letters, digits and hyphens. Shopify handles already are, mostly. */
export function toSlug(value: unknown): string {
  return scalarText(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 256);
}

/** Full fieldData for a product, owned fields included: {@link withoutOwned} strips them for updates. */
export function mapProduct(product: Product, cfg: SyncConfig): FieldData {
  const out: FieldData = {};
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

export function withoutOwned(fieldData: FieldData, cfg: SyncConfig): FieldData {
  return Object.fromEntries(Object.entries(fieldData).filter(([slug]) => !cfg.webflowOwned.includes(slug)));
}

/** Names a function source in the checks, which can only see that it is one. */
const FUNCTION_SOURCE = '(function)';

/** What is wrong with mapping `source` to a field of `type`, as [message, fix], or `null`. */
function typeMismatch(slug: string, type: string, source: string): [string, string] | null {
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

/** Checks the mapping against the Webflow collection schema. */
export function checkMapping(cfg: SyncConfig, collection: WebflowCollection | null | undefined): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const add = (level: MappingProblem['level'], message: string, fix: string) => problems.push({ level, message, fix });
  const collectionFields = collection?.fields ?? [];
  const fields = new Map(collectionFields.map((field) => [field.slug, field]));
  const name = collection?.displayName || cfg.webflow.collectionId;
  for (const [slug, source] of Object.entries(cfg.fields)) {
    const field = fields.get(slug);
    if (!field) {
      if (cfg.webflow.skipMissingFields)
        add(
          'warn',
          `Webflow field "${slug}" doesn't exist in "${String(name)}": it is skipped.`,
          `Add a field with slug "${slug}" to sync it, or remove it from the mapping.`,
        );
      else
        add(
          'error',
          `Webflow field "${slug}" doesn't exist in "${String(name)}".`,
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
 * @param fieldSlugs `null` keeps every field.
 */
export function onlyExisting(fieldData: FieldData, fieldSlugs: Set<string> | null): FieldData {
  if (!fieldSlugs) return fieldData;
  const out: FieldData = {};
  for (const [slug, value] of Object.entries(fieldData)) {
    if (slug === 'name' || slug === 'slug' || fieldSlugs.has(slug)) out[slug] = value;
  }
  return out;
}
