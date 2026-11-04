/** Node-only bits: JSON file store, config loading, HTTP server for webhooks. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleShopifyWebhook } from './webhook.js';

export function fileStore(path) {
  let data = null;
  let writing = Promise.resolve();
  const load = async () => {
    if (data) return data;
    try { data = JSON.parse(await readFile(path, 'utf8')); } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      data = {};
    }
    return data;
  };
  const save = () => {
    writing = writing.then(async () => {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2));
      await rename(tmp, path);
    });
    return writing;
  };
  return {
    path,
    async get(k) { const d = await load(); return k in d ? structuredClone(d[k]) : null; },
    async put(k, v) { const d = await load(); d[k] = structuredClone(v); await save(); },
    async delete(k) { const d = await load(); delete d[k]; await save(); },
  };
}

export async function loadConfig(path) {
  const candidates = path ? [path] : ['tether-sync.config.js', 'tether-sync.config.mjs', 'tether-sync.config.json'];
  for (const c of candidates) {
    const full = resolve(c);
    if (!existsSync(full)) continue;
    if (full.endsWith('.json')) return { path: full, config: JSON.parse(await readFile(full, 'utf8')) };
    const mod = await import(pathToFileURL(full).href);
    return { path: full, config: mod.default || mod.config };
  }
  throw new Error(`No config found (${candidates.join(', ')}). Copy server/tether-sync.config.example.js.`);
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
    } catch (err) {
      log.error(err);
      if (!res.headersSent) { res.writeHead(500); res.end('error'); }
    }
  });
  return new Promise((r) => server.listen(port, () => { log.info(`tether-sync listening on http://localhost:${port}/webhooks/shopify`); r(server); }));
}
