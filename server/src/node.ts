/** Node-only bits: JSON file store, config loading, HTTP server for webhooks. */
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readCapped } from './capped-body.ts';
import { handleShopifyWebhook, MAX_WEBHOOK_BYTES } from './webhook.ts';
import { parseConfigFile } from './config-file.ts';
import { asRecord } from './json.ts';
import { isRecord } from './shared/json.ts';
import { messageOf } from './util.ts';

import type { Stats } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { RawConfig } from './mapping.ts';
import type { Store } from './store.ts';
import type { Logger } from './util.ts';

type WebhookSync = Parameters<typeof handleShopifyWebhook>[1]['sync'];

export type FileStore = Store & { path: string; flush: () => Promise<void> };

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * A failed write is reported to the flush that started it, and its keys are put back in `dirty`: the next write runs
 * regardless.
 */
function leaveFailureToItsFlush() {
  // Reported through the promise that flush returned.
}

/** mtime + size + inode: Linux mtimes are coarse, two writes can share one. */
const stamp = (stats: Stats) => `${String(stats.mtimeMs)}:${String(stats.size)}:${String(stats.ino)}`;

/** Empty when the file does not exist yet. */
async function readStateFile(path: string): Promise<{ entries: Map<string, unknown>; version: string }> {
  try {
    const [text, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const json: unknown = JSON.parse(text);
    if (!isRecord(json)) throw new Error(`state file ${path} does not hold a JSON object`);
    return { entries: new Map(Object.entries(json)), version: stamp(stats) };
  } catch (err) {
    if (!isFileMissing(err)) throw err;
    return { entries: new Map(), version: '' };
  }
}

/**
 * Replaces the file in one rename, so another process never reads half of it.
 *
 * @returns The written file's version stamp.
 */
async function writeStateFile(path: string, entries: Map<string, unknown>): Promise<string> {
  const tmp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(tmp, JSON.stringify(Object.fromEntries(entries)));
  await rename(tmp, path);
  return stamp(await stat(path));
}

/**
 * The file's version stamp differs from `version`. A removed file counts as unchanged: what this process holds is
 * still the state. Any other failure is a real one.
 */
async function changedOnDisk(path: string, version: string): Promise<boolean> {
  try {
    return stamp(await stat(path)) !== version;
  } catch (err) {
    if (!isFileMissing(err)) throw err;
    return false;
  }
}

/** @param changes Key -> value, or `undefined` for a delete. */
function applyChanges(target: Map<string, unknown>, changes: Map<string, unknown>): void {
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
 * @param options `log` reports a failed timed write.
 */
export function fileStore(
  path: string,
  { delayMs = 250, log = console }: { delayMs?: number; log?: Pick<Logger, 'error'> } = {},
): FileStore {
  let data: Map<string, unknown> | null = null;
  let version = '';
  /** Key -> value, or `undefined` for a delete. */
  const dirty = new Map<string, unknown>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const load = async () => {
    if (data && !(await changedOnDisk(path, version))) return data;
    const disk = await readStateFile(path);
    applyChanges(disk.entries, dirty);
    data = disk.entries;
    version = disk.version;
    return data;
  };
  const write = async (batch: Map<string, unknown>) => {
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
      flush().catch((err: unknown) => {
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
 * @throws {Error} When no candidate exists, or the file does not hold a valid config.
 */
export async function loadConfig(path?: string): Promise<{ path: string; config: RawConfig }> {
  const candidates = path
    ? [path]
    : ['tether-sync.config.js', 'tether-sync.config.mjs', 'tether-sync.config.json', BUNDLED_CONFIG];
  for (const candidate of candidates) {
    const full = candidate === BUNDLED_CONFIG ? candidate : resolve(candidate);
    if (!existsSync(full)) continue;
    if (full.endsWith('.json')) {
      const json: unknown = JSON.parse(await readFile(full, 'utf8'));
      return { path: full, config: parseConfigFile(json, full) };
    }
    const module: unknown = await import(pathToFileURL(full).href);
    const exports = asRecord(module);
    return { path: full, config: parseConfigFile(exports['default'] ?? exports['config'], full) };
  }
  throw new Error(`No config found (${candidates.join(', ')}).`);
}

/** The request as a web Request, so the Worker's webhook handler serves Node too. */
function toRequest(req: IncomingMessage, body: Uint8Array<ArrayBuffer>): Request {
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

/** A client that aborts mid-body: it ends that request, and is not worth an error in the log. */
function isClientAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ('code' in error && error.code === 'ECONNRESET') || error.message === 'aborted';
}

/** The webhook body, or `null` when it is larger than `maxBody`: then the request was answered 413 and destroyed. */
async function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBody: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declaredTooLarge = Number(req.headers['content-length'] ?? 0) > maxBody;
  // A request stream without an encoding yields Buffers, which are Uint8Arrays.
  const body = declaredTooLarge ? null : await readCapped(req, maxBody);
  if (body) return body;
  res.writeHead(413);
  res.end('too large');
  req.destroy();
  return null;
}

/** Answers without reading the body: other paths never get theirs read. */
function answerEarly(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  text: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, headers);
  res.end(text);
  req.resume();
}

/** The parts of the app (`createApp`) the webhook server uses. */
interface ServeApp {
  sync: WebhookSync;
  webhookSecrets: string[];
  config: { shopify: { domain?: string | undefined } };
  /** A file store is flushed after each webhook. */
  store?: (Store & { flush?: () => Promise<unknown> }) | null | undefined;
}

interface ServeOptions {
  port?: number;
  /** Every interface when not set. */
  host?: string | undefined;
  log?: Logger;
  /** Bytes; a larger webhook body is answered 413 without being buffered. */
  maxBody?: number;
}

async function handle(
  app: ServeApp,
  req: IncomingMessage,
  res: ServerResponse,
  { log, maxBody }: { log: Logger; maxBody: number },
): Promise<void> {
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
 * @param port The port asked for, used when Node reports no address.
 */
function listeningOn(address: ReturnType<Server['address']>, port: number): string {
  if (!address || typeof address === 'string') return `port ${String(port)}`;
  const path = `:${String(address.port)}/webhooks/shopify`;
  if (EVERY_INTERFACE.has(address.address)) return `every interface (${address.address}), e.g. http://localhost${path}`;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${host}${path}`;
}

/**
 * The webhook endpoint (`POST /webhooks/shopify`) and `GET /health`.
 *
 * @returns Once it listens.
 */
export function serve(
  app: ServeApp,
  { port = 8787, host, log = console, maxBody = MAX_WEBHOOK_BYTES }: ServeOptions = {},
): Promise<Server> {
  const server = createServer((req, res) => {
    handle(app, req, res, { log, maxBody }).catch((err: unknown) => {
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
