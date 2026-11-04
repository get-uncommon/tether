// A tiny static server for the starter's build (examples/astro/dist), for the browser tests.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../examples/astro/dist/', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PLAIN = fileURLToPath(new URL('./plain/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // /plain/: a plain HTML page with Tether's <script> build (dist/), like a Webflow site.
  const base = path.startsWith('/plain/dist/') ? DIST : path.startsWith('/plain/') ? PLAIN : ROOT;
  if (base !== ROOT) path = path.replace(base === DIST ? '/plain/dist/' : '/plain/', '/');
  let file = join(base, path);
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(base, `${path.replace(/\/$/, '')}.html`); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(Number(process.env.PORT || 4399));
