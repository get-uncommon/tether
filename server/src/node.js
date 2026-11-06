/** Node-only bits: JSON file store, config loading, HTTP server for webhooks. */
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readCapped } from './capped-body.js';
import { handleShopifyWebhook, MAX_WEBHOOK_BYTES } from './webhook.js';
import { parseConfigFile } from './config-file.js';
import { asRecord, isPlainObject } from './json.js';
import { messageOf } from './util.js';

/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./util.js').Logger} Logger */
/** @typedef {import('./mapping.js').RawConfig} RawConfig */
/** @typedef {import('./webhook.js').WebhookSync} WebhookSync */
/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {import('node:http').Server} Server */
/** @typedef {import('node:fs').Stats} Stats */

/** @typedef {Store & { path: string, flush: () => Promise<void> }} FileStore */

/** @param {unknown} error */
function isFileMissing(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * A failed write is reported to the flush that started it, and its keys are put back in `dirty`: the next write runs
 * regardless.
 */
function leaveFailureToItsFlush() {
  // Reported through the promise that flush returned.
}

/** mtime + size + inode: Linux mtimes are coarse, two writes can share one. @param {Stats} stats */
const stamp = (stats) => `${String(stats.mtimeMs)}:${String(stats.size)}:${String(stats.ino)}`;

/**
 * @param {string} path
 * @returns {Promise<{ entries: Map<string, unknown>, version: string }>} Empty when the file does not exist yet.
 */
async function readStateFile(path) {
  try {
    const [text, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    /** @type {unknown} */
    const json = JSON.parse(text);
    if (!isPlainObject(json)) throw new Error(`state file ${path} does not hold a JSON object`);
    return { entries: new Map(Object.entries(json)), version: stamp(stats) };
  } catch (err) {
    if (!isFileMissing(err)) throw err;
    return { entries: new Map(), version: '' };
  }
}

/**
 * Replaces the file in one rename, so another process never reads half of it.
 *
 * @param {string} path
 * @param {Map<string, unknown>} entries
 * @returns {Promise<string>} The written file's version stamp.
 */
async function writeStateFile(path, entries) {
  const tmp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(tmp, JSON.stringify(Object.fromEntries(entries)));
  await rename(tmp, path);
  return stamp(await stat(path));
}

/**
 * The file's version stamp differs from `version`. A removed file counts as unchanged: what this process holds is
 * still the state. Any other failure is a real one.
 *
 * @param {string} path
 * @param {string} version
 */
async function changedOnDisk(path, version) {
  try {
    return stamp(await stat(path)) !== version;
  } catch (err) {
    if (!isFileMissing(err)) throw err;
    return false;
  }
}

/**
 * @param {Map<string, unknown>} target
 * @param {Map<string, unknown>} changes Key -> value, or `undefined` for a delete.
 */
function applyChanges(target, changes) {
  changes.forEach((value, key) => {
    if (value === undefined) target.delete(key);
    else target.set(key, value);
  });
}

/**
 * JSON file store. Writes are batched (one file write per `delayMs`, and on flush()) and
 * merged into the file as it is on disk, so `serve` and a cron `reconcile` can share one
 * state file. Reads reload the file when another process changed it.
 *
 * @param {string} path
 * @param {{ delayMs?: number, log?: Pick<Logger, 'error'> }} [options] `log` reports a failed timed write.
 * @returns {FileStore}
 */
export function fileStore(path, { delayMs = 250, log = console } = {}) {
  /** @type {Map<string, unknown> | null} */
  let data = null;
  let version = '';
  /** Key -> value, or `undefined` for a delete. @type {Map<string, unknown>} */
  const dirty = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<void>} */
  let writing = Promise.resolve();

  const load = async () => {
    if (data && !(await changedOnDisk(path, version))) return data;
    const disk = await readStateFile(path);
    applyChanges(disk.entries, dirty);
    data = disk.entries;
    version = disk.version;
    return data;
  };
  /** @param {Map<string, unknown>} batch */
  const write = async (batch) => {
    try {
      const disk = await readStateFile(path); // merge: keep keys other processes wrote meanwhile
      applyChanges(disk.entries, batch);
      version = await writeStateFile(path, disk.entries);
      data = disk.entries;
    } catch (err) {
      // Tried again on the next flush, unless a newer value for the key is waiting already.
      batch.forEach((value, key) => {
        if (!dirty.has(key)) dirty.set(key, value);
      });
      throw err;
    }
  };
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty.size) return writing;
    const batch = new Map(dirty);
    dirty.clear();
    writing = writing.catch(leaveFailureToItsFlush).then(() => write(batch));
    return writing;
  };
  const schedule = () => {
    timer ??= setTimeout(() => {
      flush().catch((/** @type {unknown} */ err) => {
        log.error(`state file ${path}: write failed, retried on the next change (${messageOf(err)})`);
      });
    }, delayMs);
  };

  return {
    path,
    flush,
    async get(key) {
      const current = await load();
      return current.has(key) ? structuredClone(current.get(key)) : null;
    },
    async put(key, value) {
      const current = await load();
      const copy = structuredClone(value);
      current.set(key, copy);
      dirty.set(key, copy);
      schedule();
    },
    async delete(key) {
      const current = await load();
      current.delete(key);
      dirty.set(key, undefined);
      schedule();
    },
  };
}

/** The config shipped with the package (env-driven default mapping). */
const BUNDLED_CONFIG = fileURLToPath(new URL('../tether-sync.config.js', import.meta.url));

/**
 * The first config file that exists: `path`, or `tether-sync.config.{js,mjs,json}` in the working directory, or the
 * bundled default.
 *
 * @param {string} [path]
 * @returns {Promise<{ path: string, config: RawConfig }>}
 * @throws {Error} When no candidate exists, or the file does not hold a valid config.
 */
export async function loadConfig(path) {
  const candidates = path
    ? [path]
    : ['tether-sync.config.js', 'tether-sync.config.mjs', 'tether-sync.config.json', BUNDLED_CONFIG];
  for (const candidate of candidates) {
    const full = candidate === BUNDLED_CONFIG ? candidate : resolve(candidate);
    if (!existsSync(full)) continue;
    if (full.endsWith('.json')) {
      /** @type {unknown} */
      const json = JSON.parse(await readFile(full, 'utf8'));
      return { path: full, config: parseConfigFile(json, full) };
    }
    /** @type {unknown} */
    const module = await import(pathToFileURL(full).href);
    const exports = asRecord(module);
    return { path: full, config: parseConfigFile(exports['default'] ?? exports['config'], full) };
  }
  throw new Error(`No config found (${candidates.join(', ')}).`);
}

/**
 * The request as a web Request, so the Worker's webhook handler serves Node too.
 *
 * @param {IncomingMessage} req
 * @param {Uint8Array<ArrayBuffer>} body
 */
function toRequest(req, body) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  return new Request(`http://localhost${req.url ?? '/'}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });
}

/**
 * A client that aborts mid-body: it ends that request, and is not worth an error in the log.
 *
 * @param {unknown} error
 */
function isClientAbort(error) {
  if (!(error instanceof Error)) return false;
  return ('code' in error && error.code === 'ECONNRESET') || error.message === 'aborted';
}

/**
 * The webhook body, or `null` when it is larger than `maxBody`: then the request was answered 413 and destroyed.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {number} maxBody
 * @returns {Promise<Uint8Array<ArrayBuffer> | null>}
 */
async function readBody(req, res, maxBody) {
  const declaredTooLarge = Number(req.headers['content-length'] ?? 0) > maxBody;
  // A request stream without an encoding yields Buffers, which are Uint8Arrays.
  const body = declaredTooLarge ? null : await readCapped(req, maxBody);
  if (body) return body;
  res.writeHead(413);
  res.end('too large');
  req.destroy();
  return null;
}

/**
 * Answers without reading the body: other paths never get theirs read.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {number} status
 * @param {string} text
 * @param {Record<string, string>} [headers]
 */
function answerEarly(req, res, status, text, headers = {}) {
  res.writeHead(status, headers);
  res.end(text);
  req.resume();
}

/**
 * The parts of the app (`createApp`) the webhook server uses.
 *
 * @typedef {object} ServeApp
 * @property {WebhookSync} sync
 * @property {string[]} webhookSecrets
 * @property {{ shopify: { domain?: string | undefined } }} config
 * @property {(Store & { flush?: () => Promise<unknown> }) | null | undefined} [store] A file store is flushed after
 *   each webhook.
 */

/**
 * @typedef {object} ServeOptions
 * @property {number} [port]
 * @property {string | undefined} [host] Every interface when not set.
 * @property {Logger} [log]
 * @property {number} [maxBody] Bytes; a larger webhook body is answered 413 without being buffered.
 */

/**
 * @param {ServeApp} app
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {{ log: Logger, maxBody: number }} options
 */
async function handle(app, req, res, { log, maxBody }) {
  if (req.url === '/health') {
    answerEarly(req, res, 200, '{"ok":true}', { 'content-type': 'application/json' });
    return;
  }
  if (req.url !== '/webhooks/shopify') {
    answerEarly(req, res, 404, 'not found');
    return;
  }
  if (req.method !== 'POST') {
    answerEarly(req, res, 405, 'POST only');
    return;
  }
  const body = await readBody(req, res, maxBody);
  if (!body) return;
  const { response, task } = await handleShopifyWebhook(toRequest(req, body), {
    sync: app.sync,
    secrets: app.webhookSecrets,
    shopDomain: app.config.shopify.domain ?? '',
    log,
  });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
  if (task) await task;
  await app.store?.flush?.();
}

/** The addresses Node binds when no host is given: every IPv6 and IPv4 interface. */
const EVERY_INTERFACE = new Set(['::', '0.0.0.0']);

/**
 * Where the server really listens, for the log: the bound address, or every interface with the local URL to try.
 *
 * @param {ReturnType<Server['address']>} address
 * @param {number} port The port asked for, used when Node reports no address.
 */
function listeningOn(address, port) {
  if (!address || typeof address === 'string') return `port ${String(port)}`;
  const path = `:${String(address.port)}/webhooks/shopify`;
  if (EVERY_INTERFACE.has(address.address)) return `every interface (${address.address}), e.g. http://localhost${path}`;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${host}${path}`;
}

/**
 * The webhook endpoint (`POST /webhooks/shopify`) and `GET /health`.
 *
 * @param {ServeApp} app
 * @param {ServeOptions} [options]
 * @returns {Promise<Server>} Once it listens.
 */
export function serve(app, { port = 8787, host, log = console, maxBody = MAX_WEBHOOK_BYTES } = {}) {
  const server = createServer((req, res) => {
    handle(app, req, res, { log, maxBody }).catch((/** @type {unknown} */ err) => {
      if (!isClientAbort(err)) log.error(err);
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(500);
        res.end('error');
      }
    });
  });
  return new Promise((done) => {
    server.listen(port, host, () => {
      log.info(`tether-sync listening on ${listeningOn(server.address(), port)}`);
      done(server);
    });
  });
}
