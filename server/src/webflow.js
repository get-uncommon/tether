/**
 * Webflow Data API v2, CMS items only. Token: a site API token with
 * cms:read + cms:write (Site settings -> Apps & integrations -> API access).
 * Responses are parsed here, so the sync engine only sees typed items.
 */
import { SyncError, httpStatusOf, isRecord, noopLogger, sleep as realSleep } from './util.js';
import { createThrottle } from './throttle.js';

/** @typedef {import('./mapping.js').FieldData} FieldData */
/** @typedef {import('./throttle.js').Throttle} Throttle */
/** @typedef {import('./util.js').Logger} Logger */

/** @typedef {{ slug: string, type: string, isRequired?: boolean }} WebflowField */
/** @typedef {{ displayName?: string | undefined, fields: WebflowField[] }} WebflowCollection */
/** @typedef {{ id: string, isArchived?: boolean, fieldData: FieldData }} WebflowItem */
/** @typedef {{ publishedItemIds: string[], errors: unknown[] }} PublishResult */
/** @typedef {{ isArchived?: boolean, isDraft?: boolean }} ItemFlags */

/**
 * The CMS operations the sync engine uses. The Webflow client is one; deploy.js provides a stand-in that only
 * notes a change.
 *
 * @typedef {object} CmsTarget
 * @property {() => Promise<WebflowCollection>} getCollection
 * @property {() => Promise<WebflowItem[]>} listAllItems Every staged item.
 * @property {(fieldData: FieldData, flags?: ItemFlags) => Promise<{ id: string }>} createItem
 * @property {(id: string, fieldData: FieldData, flags?: ItemFlags) => Promise<unknown>} updateItem
 * @property {(id: string) => Promise<unknown>} deleteItem
 * @property {(itemIds: string[]) => Promise<PublishResult[]>} publish
 * @property {(id: string) => Promise<unknown>} unpublish Removes the item from the live site; a no-op when it isn't live.
 */

/**
 * @typedef {CmsTarget & {
 *   collectionId: string,
 *   readonly requests: number,
 *   call: (method: string, path: string, body?: object) => Promise<unknown>,
 *   getItem: (id: string) => Promise<unknown>,
 * }} WebflowClient
 */

const BASE = 'https://api.webflow.com/v2';
/** Webflow's page size for listing items and its batch size for publishing. */
const PAGE_SIZE = 100;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const FIRST_BACKOFF_MS = 1000;

/**
 * A response body that isn't JSON (an HTML error page, an empty 202) has nothing to parse; the status still tells
 * the caller what happened.
 *
 * @returns {null}
 */
function noJsonBody() {
  return null;
}

/** @param {unknown} json @param {string} key */
function stringField(json, key) {
  const value = isRecord(json) ? json[key] : undefined;
  return typeof value === 'string' ? value : '';
}

/** @param {unknown} value @returns {WebflowItem | null} */
function parseItem(value) {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null;
  const fieldData = isRecord(value['fieldData']) ? value['fieldData'] : {};
  /** @type {WebflowItem} */
  const item = { id: value['id'], fieldData };
  if (typeof value['isArchived'] === 'boolean') item.isArchived = value['isArchived'];
  return item;
}

/** @param {unknown} value @returns {WebflowField[]} */
function parseFields(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => {
    if (!isRecord(field) || typeof field['slug'] !== 'string') return [];
    /** @type {WebflowField} */
    const parsed = { slug: field['slug'], type: typeof field['type'] === 'string' ? field['type'] : '' };
    if (typeof field['isRequired'] === 'boolean') parsed.isRequired = field['isRequired'];
    return [parsed];
  });
}

/** @param {unknown} json @returns {WebflowCollection} */
function parseCollection(json) {
  const displayName = stringField(json, 'displayName');
  return { displayName: displayName || undefined, fields: parseFields(isRecord(json) ? json['fields'] : undefined) };
}

/** @param {unknown} json @returns {PublishResult} */
function parsePublishResult(json) {
  const ids = isRecord(json) ? json['publishedItemIds'] : undefined;
  const errors = isRecord(json) ? json['errors'] : undefined;
  return {
    publishedItemIds: Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [],
    errors: Array.isArray(errors) ? errors : [],
  };
}

/**
 * @param {unknown} json
 * @returns {{ items: WebflowItem[], received: number, total: number | null }}
 */
function parseItemPage(json) {
  const raw = isRecord(json) && Array.isArray(json['items']) ? json['items'] : [];
  const pagination = isRecord(json) ? json['pagination'] : undefined;
  const total = isRecord(pagination) && typeof pagination['total'] === 'number' ? pagination['total'] : null;
  const items = raw.map(parseItem).filter((item) => item !== null);
  return { items, received: raw.length, total };
}

/**
 * The item from a create, which the engine needs the id of.
 *
 * @param {unknown} json
 * @throws {SyncError} When Webflow answered without an item id.
 */
function createdItem(json) {
  const item = parseItem(json);
  if (!item) throw new SyncError('Webflow created an item but returned no id', { body: json });
  return item;
}

/**
 * @typedef {object} RequesterOptions
 * @property {string} token
 * @property {typeof globalThis.fetch} fetchImpl
 * @property {Throttle} gate
 * @property {(ms: number) => Promise<void>} sleep
 * @property {number} retries
 * @property {Logger} log
 * @property {number} maxRetryWaitMs
 */

/**
 * Sends Webflow requests through the throttle, waits out 429s and retries 5xx answers with a backoff.
 *
 * @param {RequesterOptions} options
 */
function createRequester({ token, fetchImpl, gate, sleep, retries, log, maxRetryWaitMs }) {
  let count = 0;

  /**
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   * @returns {Promise<unknown>} The parsed JSON, or `null` for a 204.
   * @throws {SyncError} `HTTP_<status>` when Webflow refuses, after the retries.
   */
  async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      await gate.wait();
      count++;
      const res = await fetchImpl(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && attempt < retries) {
        const waitMs = (parseFloat(res.headers.get('retry-after') ?? '') || DEFAULT_RETRY_AFTER_SECONDS) * 1000;
        if (waitMs > maxRetryWaitMs)
          throw new SyncError(`Webflow rate limit: retry after ${waitMs / 1000}s`, { status: 429 });
        log.warn(`webflow 429, waiting ${waitMs / 1000}s`);
        gate.pause(waitMs);
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(FIRST_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      if (res.status === 204) return null;
      /** @type {unknown} */
      const json = await res.json().catch(noJsonBody);
      if (!res.ok) {
        const message = stringField(json, 'message') || stringField(json, 'msg') || res.statusText || 'error';
        const details = isRecord(json) && json['details'] ? ` ${JSON.stringify(json['details'])}` : '';
        throw new SyncError(`Webflow ${method} ${path}: ${res.status} ${message}${details}`, {
          status: res.status,
          body: json,
        });
      }
      return json;
    }
  }

  return {
    call,
    /** Requests sent, retries included. */
    get count() {
      return count;
    },
  };
}

/**
 * @typedef {object} WebflowOptions
 * @property {string | undefined} token
 * @property {string | undefined} collectionId
 * @property {typeof globalThis.fetch} [fetch]
 * @property {Throttle} [throttle] Shared between clients that share a token; one per client otherwise.
 * @property {number} [perMinute]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {number} [retries]
 * @property {Logger} [log]
 * @property {number} [maxRetryWaitMs] A 429 asking for a longer wait fails instead: webhook runs can't wait it out.
 */

/**
 * @param {WebflowOptions} options
 * @returns {WebflowClient}
 * @throws {SyncError} When the token or the collection id is missing.
 */
export function createWebflow({
  token,
  collectionId,
  fetch: fetchImpl = globalThis.fetch,
  throttle,
  perMinute = 50,
  sleep = realSleep,
  retries = 4,
  log = noopLogger,
  maxRetryWaitMs = Infinity,
}) {
  if (!token) throw new SyncError('WEBFLOW_TOKEN is required');
  if (!collectionId) throw new SyncError('webflow.collectionId is required');
  const gate = throttle ?? createThrottle({ perMinute, sleep });
  const requester = createRequester({ token, fetchImpl, gate, sleep, retries, log, maxRetryWaitMs });
  const { call } = requester;

  /**
   * Like {@link call}, but `null` when Webflow answers 404.
   *
   * @param {string} method
   * @param {string} path
   */
  async function callUnlessGone(method, path) {
    try {
      return await call(method, path);
    } catch (err) {
      if (httpStatusOf(err) === 404) return null;
      throw err;
    }
  }

  const collection = `/collections/${collectionId}`;

  return {
    collectionId,
    get requests() {
      return requester.count;
    },
    call,
    getCollection: async () => parseCollection(await call('GET', collection)),

    async listAllItems() {
      /** @type {WebflowItem[]} */
      const items = [];
      let received = 0;
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = parseItemPage(await call('GET', `${collection}/items?limit=${PAGE_SIZE}&offset=${offset}`));
        items.push(...page.items);
        received += page.received;
        if (!page.received || received >= (page.total ?? received)) return items;
      }
    },

    getItem: (id) => callUnlessGone('GET', `${collection}/items/${id}`),
    createItem: async (fieldData, { isDraft = false, isArchived = false } = {}) =>
      createdItem(await call('POST', `${collection}/items`, { isArchived, isDraft, fieldData })),
    updateItem: (id, fieldData, flags = {}) => call('PATCH', `${collection}/items/${id}`, { ...flags, fieldData }),
    deleteItem: (id) => call('DELETE', `${collection}/items/${id}`),

    async publish(itemIds) {
      const ids = [...new Set(itemIds)].filter(Boolean);
      /** @type {PublishResult[]} */
      const results = [];
      for (let start = 0; start < ids.length; start += PAGE_SIZE) {
        const batch = ids.slice(start, start + PAGE_SIZE);
        results.push(parsePublishResult(await call('POST', `${collection}/items/publish`, { itemIds: batch })));
      }
      return results;
    },

    unpublish: (id) => callUnlessGone('DELETE', `${collection}/items/${id}/live`),
  };
}
