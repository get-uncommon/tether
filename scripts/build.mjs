/**
 * Builds dist/, or the folder after `--out`, which the tests use so the committed dist/ only changes in a release:
 *
 *   tether.min.js (+ .map), tether.js     the <script> build (IIFE)
 *   tether.<part>(.min).js                the optional parts, loaded on first use (`PARTS`)
 *   esm/                                  ES modules for bundlers, the parts as split chunks
 *   tether.esm.js                         re-export of esm/index.js (older import path)
 *   presets/barba.esm.js
 *
 * Size comes from the build, not from golfed source: ES2020 output (no helpers for ?. and ??), GraphQL strings
 * minified, the parts in their own files.
 */
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

/** @typedef {{ kind: 'text', text: string } | { kind: 'expression', source: string }} TemplatePart */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const watch = process.argv.includes('--watch');
const outIndex = process.argv.indexOf('--out');
const OUT = join(ROOT, outIndex === -1 ? 'dist' : (process.argv[outIndex + 1] ?? 'dist'));
const TARGET = 'es2020';
const BYTES_PER_KB = 1024;
const GZIP_LEVEL = 9;

/** The optional parts, each `src/parts/<name>.js` built into `tether.<name>(.min).js`. */
const PARTS = ['diagnose', 'markets', 'search', 'extras', 'account', 'account-pages', 'analytics'];

/**
 * The core modules a part uses through `window.Tether.__core` instead of bundling copies: the same names as
 * `coreModules` in src/lazy-iife.js.
 */
const CORE = [
  'config.js',
  'client.js',
  'dom.js',
  'fragments.js',
  'loader.js',
  'selling-plans.js',
  'status.js',
  'cart.js',
  'product.js',
  'collection.js',
  'mounting.js',
  'shopify-values.js',
  'store-html.js',
  'market-codes.js',
  'lazy.js',
];

/**
 * @param {string} body
 * @param {number} start The index just after the `${` that opens the expression.
 * @returns {number} The index just after the `}` that closes it.
 */
function expressionEnd(body, start) {
  let depth = 1;
  let index = start;
  for (; index < body.length && depth; index++) {
    if (body[index] === '{') depth++;
    else if (body[index] === '}') depth--;
  }
  return index;
}

/**
 * @param {string} body A template literal's text between the backticks.
 * @returns {TemplatePart[]} Its text parts and `${…}` expressions, in order.
 */
function splitTemplate(body) {
  /** @type {TemplatePart[]} */
  const parts = [];
  let text = '';
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? '';
    if (char === '\\') {
      text += char + (body[index + 1] ?? '');
      index++;
    } else if (char === '$' && body[index + 1] === '{') {
      parts.push({ kind: 'text', text });
      text = '';
      const end = expressionEnd(body, index + 2);
      parts.push({ kind: 'expression', source: body.slice(index, end) });
      index = end - 1;
    } else {
      text += char;
    }
  }
  parts.push({ kind: 'text', text });
  return parts;
}

/** Text that looks like GraphQL: an operation, a fragment, an inline fragment or a selection of Tether's fields. */
const GRAPHQL = /\b(query|mutation|fragment)\b|\.\.\. ?on |\{[^}]*\b(id|nodes|amount|cart)\b/;

/** @param {string} text */
const minifyGraphqlText = (text) =>
  text
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ?([{}():,!=@[\]]) ?/g, '$1');

/**
 * Collapses whitespace and drops the spaces around punctuation in the template literals that look like GraphQL, only
 * in their text, never inside `${…}`.
 *
 * @param {string} code
 * @returns {string}
 */
export function minifyGraphqlTemplates(code) {
  return code.replace(/`((?:[^`\\]|\\.)*)`/gs, (whole, /** @type {string} */ body) => {
    const parts = splitTemplate(body);
    const plain = parts.map((part) => (part.kind === 'text' ? part.text : '')).join(' ');
    if (!GRAPHQL.test(plain)) return whole;
    const minified = parts.map((part) => (part.kind === 'text' ? minifyGraphqlText(part.text) : part.source));
    return `\`${minified.join('')}\``;
  });
}

/** @type {esbuild.Plugin} */
const graphqlPlugin = {
  name: 'tether-graphql',
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\].*\.js$/ }, async (args) => ({
      contents: minifyGraphqlTemplates(await readFile(args.path, 'utf8')),
      loader: 'js',
    }));
  },
};

/** @type {esbuild.Plugin} The `<script>` build loads parts from files (src/lazy-iife.js) instead of `import()`. */
const iifeLazyPlugin = {
  name: 'tether-iife-lazy',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\/lazy\.js$/ }, (args) =>
      join(args.resolveDir, args.path) === join(SRC, 'lazy.js') ? { path: join(SRC, 'lazy-iife.js') } : undefined,
    );
  },
};

/** @returns {Promise<Record<string, string[]>>} Each core module's export names. */
async function coreExports() {
  /** @type {Record<string, string[]>} */
  const exportsByFile = {};
  for (const file of CORE) {
    /** @type {unknown} */
    const module = await import(pathToFileURL(join(SRC, file)).href);
    exportsByFile[file] = Object.keys(/** @type {object} A module namespace. */ (module));
  }
  return exportsByFile;
}

/**
 * A part's imports of core modules become reads of `window.Tether.__core`.
 *
 * @param {Record<string, string[]>} exportsByFile
 * @returns {esbuild.Plugin}
 */
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
        contents: `const m = window.Tether.__core[${JSON.stringify(args.path)}];\nexport const { ${(exportsByFile[args.path] ?? []).join(', ')} } = m;\n`,
        loader: 'js',
      }));
    },
  };
}

/** @type {esbuild.BuildOptions} */
const common = { bundle: true, target: TARGET, logLevel: 'warning', legalComments: 'none', plugins: [graphqlPlugin] };

/**
 * @param {Record<string, string[]>} exportsByFile
 * @param {string} name
 * @param {boolean} minify
 * @returns {esbuild.BuildOptions}
 */
const partBuild = (exportsByFile, name, minify) => ({
  ...common,
  entryPoints: [join(SRC, 'parts', `${name}.js`)],
  format: 'iife',
  minify,
  outfile: join(OUT, `tether.${name}${minify ? '.min' : ''}.js`),
  plugins: [partPlugin(exportsByFile), graphqlPlugin],
});

/** @returns {Promise<esbuild.BuildOptions[]>} */
async function builds() {
  const exportsByFile = await coreExports();
  /** @type {esbuild.BuildOptions} */
  const iife = {
    ...common,
    entryPoints: [join(SRC, 'index.js')],
    format: 'iife',
    plugins: [iifeLazyPlugin, graphqlPlugin],
  };
  return [
    { ...iife, outfile: join(OUT, 'tether.js') },
    { ...iife, outfile: join(OUT, 'tether.min.js'), minify: true, sourcemap: true },
    ...PARTS.flatMap((name) => [partBuild(exportsByFile, name, false), partBuild(exportsByFile, name, true)]),
    {
      ...common,
      entryPoints: [join(SRC, 'index.js'), join(SRC, 'server.js'), join(SRC, 'astro.js')],
      format: 'esm',
      splitting: true,
      minify: true,
      external: ['@occluze/tether', 'node:*'],
      outdir: join(OUT, 'esm'),
      chunkNames: 'chunks/[name]-[hash]',
      entryNames: '[name]',
    },
    {
      ...common,
      entryPoints: [join(SRC, 'presets/barba.js')],
      format: 'esm',
      outfile: join(OUT, 'presets/barba.esm.js'),
    },
  ];
}

/** @param {number} bytes */
const kilobytes = (bytes) => (bytes / BYTES_PER_KB).toFixed(1);

/** Prints the size of each minified script, raw and compressed. */
async function report() {
  const files = ['tether.min.js', ...PARTS.map((name) => `tether.${name}.min.js`)];
  const rows = [];
  for (const file of files) {
    const bytes = await readFile(join(OUT, file));
    const gzip = gzipSync(bytes, { level: GZIP_LEVEL }).length;
    const brotli = brotliCompressSync(bytes).length;
    rows.push(
      `${file.padEnd(24)} ${kilobytes(bytes.length).padStart(5)} KB  gzip ${kilobytes(gzip).padStart(4)} KB  brotli ${kilobytes(brotli).padStart(4)} KB`,
    );
  }
  console.log(rows.join('\n'));
}

await rm(join(OUT, 'esm'), { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await writeFile(
  join(OUT, 'tether.esm.js'),
  "export * from './esm/index.js';\nexport { default } from './esm/index.js';\n",
);
const all = await builds();
if (watch) {
  for (const options of all) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(all.map((options) => esbuild.build(options)));
  await report();
}
