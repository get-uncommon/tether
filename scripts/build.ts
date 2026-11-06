/**
 * Builds dist/, or the folder after `--out`, which the tests use so the committed dist/ only changes in a release:
 *
 *   tether.min.js (+ .map), tether.js     the <script> build (IIFE)
 *   tether.<part>(.min).js                the optional parts, loaded on first use (`PARTS`); built first, so the
 *                                         core carries their integrity hashes (src/part-integrity.ts)
 *   esm/                                  ES modules for bundlers, the parts as split chunks
 *   tether.esm.js                         re-export of esm/index.js (older import path)
 *   presets/barba.esm.js
 *   types/                               the published .d.ts, generated from the source by tsc
 *                                         (tsconfig.declarations.json)
 *
 * Size comes from the build, not from golfed source: ES2020 output (no helpers for ?. and ??), GraphQL strings
 * minified, the parts in their own files.
 */
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

type TemplatePart = { kind: 'text'; text: string } | { kind: 'expression'; source: string };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const watch = process.argv.includes('--watch');
const outIndex = process.argv.indexOf('--out');
const OUT = join(ROOT, outIndex === -1 ? 'dist' : (process.argv[outIndex + 1] ?? 'dist'));
const TARGET = 'es2020';
const BYTES_PER_KB = 1024;
const GZIP_LEVEL = 9;

/** The optional parts, each `src/parts/<name>.ts` built into `tether.<name>(.min).js`. */
const PARTS = ['diagnose', 'markets', 'search', 'extras', 'account', 'account-pages', 'analytics'];

/**
 * The core modules a part uses through `window.Tether.__core` instead of bundling copies: the same names as
 * `coreModules` in src/lazy-iife.ts.
 */
const CORE = [
  'config.ts',
  'client.ts',
  'dom.ts',
  'fragments.ts',
  'loader.ts',
  'selling-plans.ts',
  'status.ts',
  'cart.ts',
  'product.ts',
  'collection.ts',
  'mounting.ts',
  'shopify-values.ts',
  'store-html.ts',
  'market-codes.ts',
  'lazy.ts',
];

/**
 * @param start The index just after the `${` that opens the expression.
 * @returns The index just after the `}` that closes it.
 */
function expressionEnd(body: string, start: number): number {
  let depth = 1;
  let index = start;
  for (; index < body.length && depth; index++) {
    if (body[index] === '{') depth++;
    else if (body[index] === '}') depth--;
  }
  return index;
}

/**
 * @param body A template literal's text between the backticks.
 * @returns Its text parts and `${…}` expressions, in order.
 */
function splitTemplate(body: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
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

const minifyGraphqlText = (text: string): string =>
  text
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ?([{}():,!=@[\]]) ?/g, '$1');

/**
 * Collapses whitespace and drops the spaces around punctuation in the template literals that look like GraphQL, only
 * in their text, never inside `${…}`.
 */
export function minifyGraphqlTemplates(code: string): string {
  return code.replace(/`((?:[^`\\]|\\.)*)`/gs, (whole, body: string) => {
    const parts = splitTemplate(body);
    const plain = parts.map((part) => (part.kind === 'text' ? part.text : '')).join(' ');
    if (!GRAPHQL.test(plain)) return whole;
    const minified = parts.map((part) => (part.kind === 'text' ? minifyGraphqlText(part.text) : part.source));
    return `\`${minified.join('')}\``;
  });
}

const graphqlPlugin: esbuild.Plugin = {
  name: 'tether-graphql',
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\].*\.ts$/ }, async (args) => ({
      contents: minifyGraphqlTemplates(await readFile(args.path, 'utf8')),
      loader: 'ts',
    }));
  },
};

/**
 * The core's map of part file to Subresource Integrity hash (src/part-integrity.ts), read from the part files on disk
 * each time the core builds, so a core always carries the hashes of the parts built before it.
 *
 * @param minified Which parts: a core loads the parts of its own kind (tether.min.js the .min ones).
 */
function partIntegrityPlugin(minified: boolean): esbuild.Plugin {
  return {
    name: 'tether-part-integrity',
    setup(build) {
      build.onLoad({ filter: /[/\\]src[/\\]part-integrity\.ts$/ }, async () => ({
        contents: `export const PART_INTEGRITY = ${JSON.stringify(await partHashes(minified))};\n`,
        loader: 'js',
      }));
    },
  };
}

/** @returns The `sha384-…` hash of each built part file, by file name. */
async function partHashes(minified: boolean): Promise<Record<string, string>> {
  const integrity: Record<string, string> = {};
  for (const file of PARTS.map((name) => `tether.${name}${minified ? '.min' : ''}.js`)) {
    const bytes = await readFile(join(OUT, file));
    integrity[file] = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
  }
  return integrity;
}

/** The `<script>` build loads parts from files (src/lazy-iife.ts) instead of `import()`. */
const iifeLazyPlugin: esbuild.Plugin = {
  name: 'tether-iife-lazy',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\/lazy\.ts$/ }, (args) =>
      join(args.resolveDir, args.path) === join(SRC, 'lazy.ts') ? { path: join(SRC, 'lazy-iife.ts') } : undefined,
    );
  },
};

/** @returns Each core module's export names. */
async function coreExports(): Promise<Record<string, string[]>> {
  const exportsByFile: Record<string, string[]> = {};
  for (const file of CORE) {
    const module: unknown = await import(pathToFileURL(join(SRC, file)).href);
    // `import()` always resolves to a module namespace object.
    exportsByFile[file] = Object.keys(module as object);
  }
  return exportsByFile;
}

/**
 * A part's imports of core modules become reads of `window.Tether.__core`.
 */
function partPlugin(exportsByFile: Record<string, string[]>): esbuild.Plugin {
  return {
    name: 'tether-part',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\/[\w-]+\.ts$/ }, (args) => {
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

const common: esbuild.BuildOptions = {
  bundle: true,
  target: TARGET,
  logLevel: 'warning',
  legalComments: 'none',
  plugins: [graphqlPlugin],
};

const partBuild = (exportsByFile: Record<string, string[]>, name: string, minify: boolean): esbuild.BuildOptions => ({
  ...common,
  entryPoints: [join(SRC, 'parts', `${name}.ts`)],
  format: 'iife',
  minify,
  outfile: join(OUT, `tether.${name}${minify ? '.min' : ''}.js`),
  plugins: [partPlugin(exportsByFile), graphqlPlugin],
});

/** @returns The optional parts, which the core's builds depend on. */
async function partBuilds(): Promise<esbuild.BuildOptions[]> {
  const exportsByFile = await coreExports();
  return PARTS.flatMap((name) => [partBuild(exportsByFile, name, false), partBuild(exportsByFile, name, true)]);
}

/** @returns The `<script>` cores, which carry the hashes of the parts built before them. */
function scriptCoreBuilds(): esbuild.BuildOptions[] {
  const iife: esbuild.BuildOptions = { ...common, entryPoints: [join(SRC, 'index.ts')], format: 'iife' };
  return [
    {
      ...iife,
      outfile: join(OUT, 'tether.js'),
      plugins: [iifeLazyPlugin, partIntegrityPlugin(false), graphqlPlugin],
    },
    {
      ...iife,
      outfile: join(OUT, 'tether.min.js'),
      minify: true,
      sourcemap: true,
      plugins: [iifeLazyPlugin, partIntegrityPlugin(true), graphqlPlugin],
    },
  ];
}

/** @returns The ES modules for bundlers and the Barba preset. */
function moduleBuilds(): esbuild.BuildOptions[] {
  return [
    {
      ...common,
      entryPoints: [join(SRC, 'index.ts'), join(SRC, 'server.ts'), join(SRC, 'astro.ts')],
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
      entryPoints: [join(SRC, 'presets/barba.ts')],
      format: 'esm',
      outfile: join(OUT, 'presets/barba.esm.js'),
    },
  ];
}

/** A relative `.ts` specifier, which the published declarations name by its `.js` file. */
const TS_SPECIFIER = /(['"])(\.{1,2}\/[^'"]*?)(?<!\.d)\.ts\1/g;

const jsSpecifiers = (declarations: string): string => declarations.replace(TS_SPECIFIER, '$1$2.js$1');

const diagnosticHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => ROOT,
  getNewLine: () => '\n',
};

/**
 * Writes the published declarations into `types/`: tsc's declarations of the entry points and of what they use, and
 * the `window` globals (src/globals.d.ts), which only the published `index.d.ts` references.
 *
 * @throws {Error} When the declaration build reports a problem.
 */
async function buildTypes(): Promise<void> {
  const outDir = join(OUT, 'types');
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(ROOT, 'tsconfig.declarations.json'),
    { outDir },
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.formatDiagnostics([diagnostic], diagnosticHost));
      },
    },
  );
  if (!parsed) throw new Error('tsconfig.declarations.json could not be read');
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const problems = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (problems.length)
    throw new Error(`The declaration build failed:\n${ts.formatDiagnostics(problems, diagnosticHost)}`);
  const files = new Map<string, string>();
  // tsc names the files with forward slashes; `resolve` writes them the way `join` does.
  program.emit(undefined, (file, text) => files.set(resolve(file), jsSpecifiers(text)));
  const index = join(outDir, 'src', 'index.d.ts');
  files.set(join(outDir, 'src', 'globals.d.ts'), jsSpecifiers(await readFile(join(SRC, 'globals.d.ts'), 'utf8')));
  files.set(index, `/// <reference path="./globals.d.ts" />\n${files.get(index) ?? ''}`);
  for (const [file, text] of files) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

const kilobytes = (bytes: number): string => (bytes / BYTES_PER_KB).toFixed(1);

/** Prints the size of each minified script, raw and compressed. */
async function report(): Promise<void> {
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
await rm(join(OUT, 'types'), { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await writeFile(
  join(OUT, 'tether.esm.js'),
  "export * from './esm/index.js';\nexport { default } from './esm/index.js';\n",
);
/**
 * Watches the sources. A part that rebuilds rebuilds the `<script>` cores too, so they carry its new hash.
 */
async function watchAll(parts: esbuild.BuildOptions[]): Promise<void> {
  for (const options of moduleBuilds()) await (await esbuild.context(options)).watch();
  const cores = await Promise.all(scriptCoreBuilds().map((options) => esbuild.context(options)));
  for (const core of cores) await core.watch();
  const rebuildCores: esbuild.Plugin = {
    name: 'tether-rebuild-cores',
    setup(build) {
      build.onEnd(async (result) => {
        if (!result.errors.length) await Promise.all(cores.map((core) => core.rebuild()));
      });
    },
  };
  for (const options of parts) {
    const context = await esbuild.context({ ...options, plugins: [...(options.plugins ?? []), rebuildCores] });
    await context.watch();
  }
}

await buildTypes();
const parts = await partBuilds();
// The parts first: the cores read their hashes from the built files.
await Promise.all(parts.map((options) => esbuild.build(options)));
if (watch) {
  await watchAll(parts);
} else {
  await Promise.all([...scriptCoreBuilds(), ...moduleBuilds()].map((options) => esbuild.build(options)));
  await report();
}
