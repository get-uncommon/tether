/**
 * Builds dist/:
 *   tether.min.js (+ .map), tether.js          the <script> build (IIFE)
 *   tether.diagnose(.min).js, tether.markets(.min).js
 *                                              optional parts, loaded on first use
 *   esm/                                       ES modules for bundlers (parts are split chunks)
 *   tether.esm.js                              re-export of esm/index.js (older import path)
 *   presets/barba.esm.js
 *
 * Size: ES2020 output (no helpers for ?. and ??), GraphQL strings minified at build time,
 * diagnose and markets only loaded when a page uses them.
 */
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const watch = process.argv.includes('--watch');
const TARGET = 'es2020';

// ---------------------------------------------------------------------------
// GraphQL strings: collapse whitespace and drop spaces around punctuation, but only in the
// text parts of template literals that look like GraphQL (never inside ${...} expressions).
// ---------------------------------------------------------------------------

function splitTemplate(body) {
  const parts = [];
  let text = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') { text += body[i] + (body[i + 1] ?? ''); i++; continue; }
    if (body[i] === '$' && body[i + 1] === '{') {
      parts.push({ text });
      text = '';
      let depth = 1;
      let j = i + 2;
      for (; j < body.length && depth; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
      }
      parts.push({ expr: body.slice(i, j) });
      i = j - 1;
      continue;
    }
    text += body[i];
  }
  parts.push({ text });
  return parts;
}

export function minifyGraphqlTemplates(code) {
  return code.replace(/`((?:[^`\\]|\\.)*)`/gs, (whole, body) => {
    const parts = splitTemplate(body);
    const plain = parts.filter((p) => 'text' in p).map((p) => p.text).join(' ');
    const graphql = /\b(query|mutation|fragment)\b|\.\.\. ?on |\{[^}]*\b(id|nodes|amount|cart)\b/.test(plain);
    if (!graphql) return whole;
    const out = parts.map((p) => ('expr' in p ? p.expr : p.text
      .replace(/\\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/ ?([{}():,!=@[\]]) ?/g, '$1')));
    return `\`${out.join('')}\``;
  });
}

const graphqlPlugin = {
  name: 'tether-graphql',
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\].*\.js$/ }, async (args) => ({
      contents: minifyGraphqlTemplates(await readFile(args.path, 'utf8')),
      loader: 'js',
    }));
  },
};

// The <script> build loads parts from files (lazy-iife.js) instead of import().
const iifeLazyPlugin = {
  name: 'tether-iife-lazy',
  setup(build) {
    build.onResolve({ filter: /^\.\/lazy\.js$/ }, (args) => ({ path: join(args.resolveDir, 'lazy-iife.js') }));
  },
};

// Parts reuse the main script's modules (window.Tether.__core) instead of bundling copies.
const CORE = ['config.js', 'client.js', 'dom.js', 'fragments.js', 'loader.js', 'selling-plans.js', 'status.js', 'cart.js', 'product.js', 'collection.js', 'mounting.js'];
async function coreExports() {
  const out = {};
  for (const f of CORE) out[f] = Object.keys(await import(pathToFileURL(join(SRC, f)).href));
  return out;
}
function partPlugin(exportsByFile) {
  return {
    name: 'tether-part',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\/[\w-]+\.js$/ }, (args) => {
        const file = basename(args.path);
        const inSrc = dirname(join(args.resolveDir, args.path)) === SRC;
        return inSrc && CORE.includes(file) ? { path: file, namespace: 'tether-core' } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: 'tether-core' }, (args) => ({
        contents: `const m = window.Tether.__core[${JSON.stringify(args.path)}];\nexport const { ${exportsByFile[args.path].join(', ')} } = m;\n`,
        loader: 'js',
      }));
    },
  };
}

const common = { bundle: true, target: TARGET, logLevel: 'warning', legalComments: 'none', plugins: [graphqlPlugin] };

async function builds() {
  const exportsByFile = await coreExports();
  const iife = { ...common, entryPoints: [join(SRC, 'index.js')], format: 'iife', plugins: [iifeLazyPlugin, graphqlPlugin] };
  const part = (name, minify) => ({
    ...common,
    entryPoints: [join(SRC, 'parts', `${name}.js`)],
    format: 'iife',
    minify,
    outfile: join(ROOT, 'dist', `tether.${name}${minify ? '.min' : ''}.js`),
    plugins: [partPlugin(exportsByFile), graphqlPlugin],
  });
  return [
    { ...iife, outfile: join(ROOT, 'dist/tether.js') },
    { ...iife, outfile: join(ROOT, 'dist/tether.min.js'), minify: true, sourcemap: true },
    ...['diagnose', 'markets', 'search', 'extras', 'account', 'analytics'].flatMap((n) => [part(n, false), part(n, true)]),
    {
      ...common, entryPoints: [join(SRC, 'index.js'), join(SRC, 'server.js'), join(SRC, 'astro.js')], format: 'esm', splitting: true, minify: true,
      external: ['@occluze/tether', 'node:*'],
      outdir: join(ROOT, 'dist/esm'), chunkNames: 'chunks/[name]-[hash]', entryNames: '[name]',
    },
    { ...common, entryPoints: [join(SRC, 'presets/barba.js')], format: 'esm', outfile: join(ROOT, 'dist/presets/barba.esm.js') },
  ];
}

async function report() {
  const rows = [];
  for (const f of ['tether.min.js', 'tether.diagnose.min.js', 'tether.markets.min.js', 'tether.search.min.js', 'tether.extras.min.js', 'tether.account.min.js', 'tether.analytics.min.js']) {
    const buf = await readFile(join(ROOT, 'dist', f));
    rows.push(`${f.padEnd(24)} ${(buf.length / 1024).toFixed(1).padStart(5)} KB  gzip ${(gzipSync(buf, { level: 9 }).length / 1024).toFixed(1).padStart(4)} KB  brotli ${(brotliCompressSync(buf).length / 1024).toFixed(1).padStart(4)} KB`);
  }
  console.log(rows.join('\n'));
}

await rm(join(ROOT, 'dist/esm'), { recursive: true, force: true });
await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(join(ROOT, 'dist/tether.esm.js'), "export * from './esm/index.js';\nexport { default } from './esm/index.js';\n");
const all = await builds();
if (watch) {
  for (const b of all) (await esbuild.context(b)).watch();
} else {
  await Promise.all(all.map((b) => esbuild.build(b)));
  await report();
}
