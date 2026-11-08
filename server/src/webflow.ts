/**
 * Webflow Data API v2, CMS items only. Token: a site API token with
 * cms:read + cms:write (Site settings -> Apps & integrations -> API access).
 * Responses are parsed here, so the sync engine only sees typed items.
 */
import { isRecord } from './shared/json.ts';
import { SyncError, httpStatusOf, noopLogger, sleep as realSleep } from './util.ts';
import { createThrottle } from './throttle.ts';

import type { FieldData } from './mapping.ts';
import type { Throttle } from './throttle.ts';
import type { Logger } from './util.ts';

interface WebflowField {
  slug: string;
  type: string;
  isRequired?: boolean;
}

export interface WebflowCollection {
  displayName?: string | undefined;
  fields: WebflowField[];
}

export interface WebflowItem {
  id: string;
  isArchived?: boolean;
  fieldData: FieldData;
}

interface ItemPage {
  items: WebflowItem[];
  next: number | null;
}

interface PublishResult {
  publishedItemIds: string[];
  errors: unknown[];
}

interface ItemFlags {
  isArchived?: boolean;
  isDraft?: boolean;
}

/**
 * The CMS operations the sync engine uses. The Webflow client is one; deploy.ts provides a stand-in that only
 * notes a change.
 */
export interface CmsTarget {
  getCollection: () => Promise<WebflowCollection>;
  /** One page of the staged items, from `offset`, and the offset of the next page: `null` after the last. */
  listItemPage: (offset: number) => Promise<ItemPage>;
  createItem: (fieldData: FieldData, flags?: ItemFlags) => Promise<{ id: string }>;
  updateItem: (id: string, fieldData: FieldData, flags?: ItemFlags) => Promise<unknown>;
  deleteItem: (id: string) => Promise<unknown>;
  publish: (itemIds: string[]) => Promise<PublishResult[]>;
  /** Removes the item from the live site; a no-op when it isn't live. */
  unpublish: (id: string) => Promise<unknown>;
}

export interface WebflowClient extends CmsTarget {
  collectionId: string;
  readonly requests: number;
  call: (method: string, path: string, body?: object) => Promise<unknown>;
  getItem: (id: string) => Promise<unknown>;
}

const BASE = 'https://api.webflow.com/v2';
/** Webflow's page size for listing items and its batch size for publishing. */
const PAGE_SIZE = 100;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const FIRST_BACKOFF_MS = 1000;

/**
 * A response body that isn't JSON (an HTML error page, an empty 202) has nothing to parse; the status still tells
 * the caller what happened.
 */
function noJsonBody(): null {
  return null;
}

function stringField(json: unknown, key: string): string {
  const value = isRecord(json) ? json[key] : undefined;
  return typeof value === 'string' ? value : '';
}

function parseItem(value: unknown): WebflowItem | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null;
  const fieldData = isRecord(value['fieldData']) ? value['fieldData'] : {};
  const item: WebflowItem = { id: value['id'], fieldData };
  if (typeof value['isArchived'] === 'boolean') item.isArchived = value['isArchived'];
  return item;
}

function parseFields(value: unknown): WebflowField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field: unknown) => {
    if (!isRecord(field) || typeof field['slug'] !== 'string') return [];
    const parsed: WebflowField = { slug: field['slug'], type: typeof field['type'] === 'string' ? field['type'] : '' };
    if (typeof field['isRequired'] === 'boolean') parsed.isRequired = field['isRequired'];
    return [parsed];
  });
}

function parseCollection(json: unknown): WebflowCollection {
  const displayName = stringField(json, 'displayName');
  return { displayName: displayName || undefined, fields: parseFields(isRecord(json) ? json['fields'] : undefined) };
}

function parsePublishResult(json: unknown): PublishResult {
  const ids = isRecord(json) ? json['publishedItemIds'] : undefined;
  const errors = isRecord(json) ? json['errors'] : undefined;
  return {
    publishedItemIds: Array.isArray(ids) ? ids.filter((id: unknown) => typeof id === 'string') : [],
    errors: Array.isArray(errors) ? errors : [],
  };
}

function parseItemPage(json: unknown): { items: WebflowItem[]; received: number; total: number | null } {
  const raw: unknown[] = isRecord(json) && Array.isArray(json['items']) ? json['items'] : [];
  const pagination = isRecord(json) ? json['pagination'] : undefined;
  const total = isRecord(pagination) && typeof pagination['total'] === 'number' ? pagination['total'] : null;
  const items = raw.map(parseItem).filter((item) => item !== null);
  return { items, received: raw.length, total };
}

/**
 * The item from a create, which the engine needs the id of.
 *
 * @throws {SyncError} When Webflow answered without an item id.
 */
function createdItem(json: unknown): WebflowItem {
  const item = parseItem(json);
  if (!item) throw new SyncError('Webflow created an item but returned no id', { body: json });
  return item;
}

interface RequesterOptions {
  token: string;
  fetchImpl: typeof globalThis.fetch;
  gate: Throttle;
  sleep: (ms: number) => Promise<void>;
  retries: number;
  log: Logger;
  maxRetryWaitMs: number;
}

/** Sends Webflow requests through the throttle, waits out 429s and retries 5xx answers with a backoff. */
function createRequester({ token, fetchImpl, gate, sleep, retries, log, maxRetryWaitMs }: RequesterOptions) {
  let count = 0;

  /**
   * @returns The parsed JSON, or `null` for a 204.
   * @throws {SyncError} `HTTP_<status>` when Webflow refuses, after the retries.
   */
  async function call(method: string, path: string, body?: object): Promise<unknown> {
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
          throw new SyncError(`Webflow rate limit: retry after ${String(waitMs / 1000)}s`, { status: 429 });
        log.warn(`webflow 429, waiting ${String(waitMs / 1000)}s`);
        gate.pause(waitMs);
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(FIRST_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      if (res.status === 204) return null;
      const json: unknown = await res.json().catch(noJsonBody);
      if (!res.ok) {
        const message = stringField(json, 'message') || stringField(json, 'msg') || res.statusText || 'error';
        const details = isRecord(json) && json['details'] ? ` ${JSON.stringify(json['details'])}` : '';
        throw new SyncError(`Webflow ${method} ${path}: ${String(res.status)} ${message}${details}`, {
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

interface WebflowOptions {
  token: string | undefined;
  collectionId: string | undefined;
  fetch?: typeof globalThis.fetch;
  /** Shared between clients that share a token; one per client otherwise. */
  throttle?: Throttle | undefined;
  perMinute?: number;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
  log?: Logger;
  /** A 429 asking for a longer wait fails instead: webhook runs can't wait it out. */
  maxRetryWaitMs?: number;
}

/** @throws {SyncError} When the token or the collection id is missing. */
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
}: WebflowOptions): WebflowClient {
  if (!token) throw new SyncError('WEBFLOW_TOKEN is required');
  if (!collectionId) throw new SyncError('webflow.collectionId is required');
  const gate = throttle ?? createThrottle({ perMinute, sleep });
  const requester = createRequester({ token, fetchImpl, gate, sleep, retries, log, maxRetryWaitMs });
  const { call } = requester;

  /** Like {@link call}, but `null` when Webflow answers 404. */
  async function callUnlessGone(method: string, path: string): Promise<unknown> {
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

    async listItemPage(offset) {
      const page = parseItemPage(
        await call('GET', `${collection}/items?limit=${String(PAGE_SIZE)}&offset=${String(offset)}`),
      );
      const end = offset + page.received;
      return { items: page.items, next: page.received && page.total !== null && end < page.total ? end : null };
    },

    getItem: (id) => callUnlessGone('GET', `${collection}/items/${id}`),
    createItem: async (fieldData, { isDraft = false, isArchived = false } = {}) =>
      createdItem(await call('POST', `${collection}/items`, { isArchived, isDraft, fieldData })),
    updateItem: (id, fieldData, flags = {}) => call('PATCH', `${collection}/items/${id}`, { ...flags, fieldData }),
    deleteItem: (id) => call('DELETE', `${collection}/items/${id}`),

    async publish(itemIds) {
      const ids = [...new Set(itemIds)].filter(Boolean);
      const results: PublishResult[] = [];
      for (let start = 0; start < ids.length; start += PAGE_SIZE) {
        const batch = ids.slice(start, start + PAGE_SIZE);
        results.push(parsePublishResult(await call('POST', `${collection}/items/publish`, { itemIds: batch })));
      }
      return results;
    },

    unpublish: (id) => callUnlessGone('DELETE', `${collection}/items/${id}/live`),
  };
}
