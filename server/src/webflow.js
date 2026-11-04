/**
 * Webflow Data API v2, CMS items only. Token: a site API token with
 * cms:read + cms:write (Site settings -> Apps & integrations -> API access).
 */
import { SyncError, sleep as realSleep } from './util.js';
import { createThrottle } from './throttle.js';

const BASE = 'https://api.webflow.com/v2';

export function createWebflow({
  token, collectionId, fetch: fetchImpl = globalThis.fetch, throttle, perMinute = 50,
  sleep = realSleep, retries = 4, log,
}) {
  if (!token) throw new SyncError('WEBFLOW_TOKEN is required');
  if (!collectionId) throw new SyncError('webflow.collectionId is required');
  const gate = throttle || createThrottle({ perMinute, sleep });
  let requests = 0;

  async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      await gate.wait();
      requests++;
      const res = await fetchImpl(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && attempt < retries) {
        const wait = (parseFloat(res.headers.get('retry-after')) || 60) * 1000;
        log?.warn?.(`webflow 429, waiting ${wait / 1000}s`);
        gate.pause(wait);
        continue;
      }
      if (res.status >= 500 && attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      if (res.status === 204) return null;
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.message || json?.msg || res.statusText || 'error';
        const details = json?.details ? ` ${JSON.stringify(json.details)}` : '';
        throw new SyncError(`Webflow ${method} ${path}: ${res.status} ${msg}${details}`, { status: res.status, body: json });
      }
      return json;
    }
  }

  const c = `/collections/${collectionId}`;

  return {
    collectionId,
    get requests() { return requests; },
    call,
    getCollection: () => call('GET', c),

    /** Every staged item (100 per request). */
    async listAllItems() {
      const items = [];
      for (let offset = 0; ; offset += 100) {
        const page = await call('GET', `${c}/items?limit=100&offset=${offset}`);
        items.push(...(page.items || []));
        const total = page.pagination?.total ?? items.length;
        if (!page.items?.length || items.length >= total) return items;
      }
    },

    getItem: async (id) => {
      try { return await call('GET', `${c}/items/${id}`); } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
    createItem: (fieldData, { isDraft = false, isArchived = false } = {}) => call('POST', `${c}/items`, { isArchived, isDraft, fieldData }),
    updateItem: (id, fieldData, flags = {}) => call('PATCH', `${c}/items/${id}`, { ...flags, fieldData }),
    deleteItem: (id) => call('DELETE', `${c}/items/${id}`),

    /** Publishes up to 100 items per request. */
    async publish(itemIds) {
      const ids = [...new Set(itemIds)].filter(Boolean);
      const results = [];
      for (let i = 0; i < ids.length; i += 100) results.push(await call('POST', `${c}/items/publish`, { itemIds: ids.slice(i, i + 100) }));
      return results;
    },

    /** Removes the item from the live site (no-op when it isn't live). */
    async unpublish(id) {
      try { return await call('DELETE', `${c}/items/${id}/live`); } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
  };
}
