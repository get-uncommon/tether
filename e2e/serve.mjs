// A tiny static server for the starter's build (examples/astro/dist), for the browser tests.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../examples/astro/dist/', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PLAIN = fileURLToPath(new URL('./plain/', import.meta.url));
/** @type {Partial<Record<string, string>>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function serve(req, res) {
  let path;
  try {
    // Node's types share `url` with client requests, where it is unset; a server's request always has one.
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400);
    res.end('bad path');
    return;
  }
  // /plain/: a plain HTML page with Tether's <script> build (dist/), like a Webflow site.
  let base = ROOT;
  if (path.startsWith('/plain/dist/')) base = DIST;
  else if (path.startsWith('/plain/')) base = PLAIN;
  if (base !== ROOT) path = path.replace(base === DIST ? '/plain/dist/' : '/plain/', '/');
  // Only files inside the base folder (an encoded %2F can't climb out).
  /** @param {string} candidate */
  const inside = (candidate) =>
    candidate === base.replace(/[\\/]$/, '') || candidate.startsWith(base.endsWith(sep) ? base : base + sep);
  let file = resolve(base, `.${path}`);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = resolve(base, `.${path.replace(/\/$/, '')}.html`);
  }
  if (path.includes('\0') || !inside(file)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

createServer((req, res) => {
  serve(req, res).catch((/** @type {unknown} */ error) => {
    console.error(error);
    res.destroy();
  });
}).listen(Number(process.env['PORT'] || 4399), '127.0.0.1');
