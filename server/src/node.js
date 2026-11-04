/** Node-only bits: JSON file store, config loading, HTTP server for webhooks. */
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { handleShopifyWebhook } from './webhook.js';

/**
 * JSON file store. Writes are batched (one file write per `delayMs`, and on flush()) and
 * merged into the file as it is on disk, so `serve` and a cron `reconcile` can share one
 * state file. Reads reload the file when another process changed it.
 */
export function fileStore(path, { delayMs = 250 } = {}) {
  let data = null;
  let mtime = 0;
  const dirty = new Map(); // key -> value, or undefined for a delete
  let timer = null;
  let writing = Promise.resolve();

  const readDisk = async () => {
    try {
      const [text, st] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
      return { json: JSON.parse(text), mtime: st.mtimeMs };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return { json: {}, mtime: 0 };
    }
  };
  const load = async () => {
    let changed = !data;
    if (data) { try { changed = (await stat(path)).mtimeMs !== mtime; } catch { changed = false; } }
    if (changed) {
      const disk = await readDisk();
      data = disk.json;
      mtime = disk.mtime;
      dirty.forEach((v, k) => { if (v === undefined) delete data[k]; else data[k] = v; });
    }
    return data;
  };
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!dirty.size) return writing;
    const batch = new Map(dirty);
    dirty.clear();
    writing = writing.catch(() => {}).then(async () => {
      const disk = await readDisk(); // merge: keep keys other processes wrote meanwhile
      batch.forEach((v, k) => { if (v === undefined) delete disk.json[k]; else disk.json[k] = v; });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(disk.json));
      await rename(tmp, path);
      data = disk.json;
      mtime = (await stat(path)).mtimeMs;
    }).catch((err) => {
      batch.forEach((v, k) => { if (!dirty.has(k)) dirty.set(k, v); }); // try again next flush
      throw err;
    });
    return writing;
  };
  const schedule = () => { if (!timer) timer = setTimeout(() => { flush().catch(() => {}); }, delayMs); };

  return {
    path,
    flush,
    async get(k) { const d = await load(); return k in d ? structuredClone(d[k]) : null; },
    async put(k, v) { const d = await load(); const c = structuredClone(v); d[k] = c; dirty.set(k, c); schedule(); },
    async delete(k) { const d = await load(); delete d[k]; dirty.set(k, undefined); schedule(); },
  };
}

/** The config shipped with the package (env-driven default mapping). */
export const BUNDLED_CONFIG = fileURLToPath(new URL('../tether-sync.config.js', import.meta.url));

export async function loadConfig(path) {
  const candidates = path ? [path] : ['tether-sync.config.js', 'tether-sync.config.mjs', 'tether-sync.config.json', BUNDLED_CONFIG];
  for (const c of candidates) {
    const full = c === BUNDLED_CONFIG ? c : resolve(c);
    if (!existsSync(full)) continue;
    if (full.endsWith('.json')) return { path: full, config: JSON.parse(await readFile(full, 'utf8')) };
    const mod = await import(pathToFileURL(full).href);
    return { path: full, config: mod.default || mod.config };
  }
  throw new Error(`No config found (${candidates.join(', ')}).`);
}

/** Reads the request into a web Request so the Worker handler can be reused. */
function toRequest(req, body) {
  const headers = new Headers();
  Object.entries(req.headers).forEach(([k, v]) => headers.set(k, Array.isArray(v) ? v.join(', ') : v));
  return new Request(`http://localhost${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
}

export function serve(app, { port = 8787, log = console } = {}) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const body = Buffer.concat(chunks);
    try {
      if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (req.url !== '/webhooks/shopify') { res.writeHead(404); res.end('not found'); return; }
      const { response, task } = await handleShopifyWebhook(toRequest(req, body), {
        sync: app.sync, secret: app.webhookSecret, shopDomain: app.config.shopify.domain, log,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      if (task) await task;
      await app.store?.flush?.();
    } catch (err) {
      log.error(err);
      if (!res.headersSent) { res.writeHead(500); res.end('error'); }
    }
  });
  return new Promise((r) => server.listen(port, () => { log.info(`tether-sync listening on http://localhost:${port}/webhooks/shopify`); r(server); }));
}
