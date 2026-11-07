/**
 * Builds dist/, or the folder after `--out`, which the tests use so the committed dist/ only changes in a release. The
 * build replaces the folder once every step has succeeded (`build`), so it holds exactly these files:
 *
 *   tether.min.js (+ .map), tether.js     the <script> build (IIFE)
 *   tether.<part>(.min).js                the optional parts, loaded on first use (`PARTS`); built first, so the
 *                                         core carries their integrity hashes (src/part-integrity.ts)
 *   esm/                                  ES modules for bundlers, the parts as split chunks
 *   tether.esm.js                         re-export of esm/index.js (older import path)
 *   presets/barba.esm.js
 *   types/                               the published .d.ts, generated from the source by tsc
 *                                         (.config/tsconfig/declarations.json)
 *
 * Size comes from the build, not from golfed source: ES2020 output (no helpers for ?. and ??), GraphQL strings
 * minified, the minified `<script>` files passed through terser as well (`terserPlugin`), the parts in their own files.
 */
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { minify as terser } from 'terser';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';
import { minifyGraphqlTemplates } from './graphql-minify.ts';
import { replaceFolder } from './replace-folder.ts';
import { rebuildUntilCurrent, type PartHashes } from './watch-core.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const watch = process.argv.includes('--watch');
const outIndex = process.argv.indexOf('--out');
const OUT = resolve(ROOT, outIndex === -1 ? 'dist' : (process.argv[outIndex + 1] ?? 'dist'));
/** The newest ECMAScript edition the browser files use, for esbuild's `target` and terser's `ecma`. */
const ECMA = 2020;
const TARGET = `es${String(ECMA)}`;
const BYTES_PER_KB = 1024;
const GZIP_LEVEL = 9;

/** The optional parts, each `src/parts/<name>.ts` built into `tether.<name>(.min).js`. */
const PARTS = ['diagnose', 'markets', 'search', 'lists', 'extras', 'account', 'account-pages', 'analytics'];

const graphqlPlugin: esbuild.Plugin = {
  name: 'tether-graphql',
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\].*\.ts$/ }, async (args) => ({
      contents: minifyGraphqlTemplates(await readFile(args.path, 'utf8'), args.path),
      loader: 'ts',
    }));
  },
};

/** The suffix of the temporary file `writeAtomically` writes, `<file>.tmp-<pid>`. */
const TEMPORARY_SUFFIX = /\.tmp-\d+$/;

/** The codes Windows fails a rename with while another handle has the file it replaces open. */
const BUSY_CODES: ReadonlySet<unknown> = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 20;
const RENAME_RETRY_MS = 50;

/**
 * Writes a file through a temporary file beside it, renamed into its place, so neither a core that hashes a part file
 * in `--watch` nor a browser loading one reads it half written. On Windows the rename fails while anything reads the
 * file, the core's own hashing included, so a busy file is retried, for up to about 10 seconds. An interrupted run
 * leaves the temporary file, which the next build's folder check counts as the build's own (`isBuildEntry`) and the
 * build's folder swap removes.
 *
 * @throws The rename's error when it fails otherwise, or the file stays busy.
 */
async function writeAtomically(file: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${file}.tmp-${String(process.pid)}`;
  await writeFile(temporary, contents);
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temporary, file);
        return;
      } catch (error) {
        const busy = error instanceof Error && 'code' in error && BUSY_CODES.has(error.code);
        if (!busy || attempt === RENAME_ATTEMPTS) throw error;
        await sleep(RENAME_RETRY_MS * attempt);
      }
    }
  } finally {
    // Gone after the rename; what a failed rename left otherwise.
    await rm(temporary, { force: true });
  }
}

/** Writes a build's files with `writeAtomically`: a build with this plugin runs with `write: false`. */
const atomicWritePlugin: esbuild.Plugin = {
  name: 'tether-atomic-write',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      for (const file of result.outputFiles ?? []) await writeAtomically(file.path, file.contents);
    });
  },
};

/**
 * Minifies a minified `<script>` file again with terser, whose compression and renaming esbuild's minifier lacks, and
 * writes it and its source map, which terser chains onto esbuild's so it still maps to src/: a build with this plugin
 * runs with `write: false`. Terser emits nothing newer than `ECMA` and uses none of its unsafe rewrites.
 */
const terserPlugin: esbuild.Plugin = {
  name: 'tether-terser',
  setup(build) {
    build.onEnd(async (result) => {
      const outputs = result.outputFiles ?? [];
      const script = outputs.find((file) => file.path.endsWith('.js'));
      if (result.errors.length || !script) return;
      const map = outputs.find((file) => file.path === `${script.path}.map`);
      const minified = await terser(script.text, {
        ecma: ECMA,
        compress: { passes: 3 },
        mangle: true,
        format: { comments: false },
        ...(map && {
          sourceMap: { content: map.text, url: basename(map.path), includeSources: true, asObject: true },
        }),
      });
      if (minified.code === undefined) throw new Error(`terser wrote no code for ${script.path}`);
      await writeAtomically(script.path, minified.code);
      if (map) await writeAtomically(map.path, JSON.stringify(minified.map));
    });
  },
};

/**
 * The core's map of part file to Subresource Integrity hash (src/part-integrity.ts), read from the part files on disk
 * each time the core builds, so a core always carries the hashes of the parts built before it.
 *
 * @param minified Which parts: a core loads the parts of its own kind (tether.min.js the .min ones).
 * @param onEmbed Called with the hashes each build of the core embeds.
 */
function partIntegrityPlugin(out: string, minified: boolean, onEmbed?: (hashes: PartHashes) => void): esbuild.Plugin {
  return {
    name: 'tether-part-integrity',
    setup(build) {
      build.onLoad({ filter: /[/\\]src[/\\]part-integrity\.ts$/ }, async () => {
        const hashes = await partHashes(out, minified);
        onEmbed?.(hashes);
        return { contents: `export const PART_INTEGRITY = ${JSON.stringify(hashes)};\n`, loader: 'js' };
      });
    },
  };
}

/** @returns The `sha384-…` hash of each built part file of one kind, by file name. */
async function partHashes(out: string, minified: boolean): Promise<Record<string, string>> {
  const integrity: Record<string, string> = {};
  for (const file of PARTS.map((name) => `tether.${name}${minified ? '.min' : ''}.js`)) {
    const bytes = await readFile(join(out, file));
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

/** @returns The module namespace of a source file. */
async function importSource(file: string): Promise<Record<string, unknown>> {
  const module: unknown = await import(pathToFileURL(file).href);
  // `import()` always resolves to a module namespace object.
  return module as Record<string, unknown>;
}

/**
 * @returns The export names of the values each core module shares with the parts (`coreModules` in src/lazy-iife.ts),
 *   in the order it lists them, by file name. A part uses those through `window.Tether.__core` instead of bundling
 *   copies.
 * @throws {Error} When a shared value isn't exactly one export of its module.
 */
async function coreExports(): Promise<Record<string, string[]>> {
  const lazyIife = join(SRC, 'lazy-iife.ts');
  const coreModules = (await importSource(lazyIife))['coreModules'];
  // The browser program types lazy-iife.ts; here each entry is read as the list of values it is.
  const entries = Object.entries(coreModules as Record<string, unknown[]>);
  const exportsByFile: Record<string, string[]> = {};
  for (const [file, values] of entries) {
    // The <script> build's lazy.ts is lazy-iife.ts (`iifeLazyPlugin`).
    const module = await importSource(file === 'lazy.ts' ? lazyIife : join(SRC, file));
    exportsByFile[file] = values.map((value) => {
      const [name, ...others] = Object.keys(module).filter((key) => module[key] === value);
      if (name === undefined || others.length) throw new Error(`${file} shares a value that isn't one of its exports`);
      return name;
    });
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
        return inSrc && file in exportsByFile ? { path: file, namespace: 'tether-core' } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: 'tether-core' }, (args) => ({
        contents: `const m = window.Tether.__core[${JSON.stringify(args.path)}];\nexport const [${(exportsByFile[args.path] ?? []).join(', ')}] = m;\n`,
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

const partBuild = (
  out: string,
  exportsByFile: Record<string, string[]>,
  name: string,
  minify: boolean,
): esbuild.BuildOptions => ({
  ...common,
  entryPoints: [join(SRC, 'parts', `${name}.ts`)],
  format: 'iife',
  minify,
  outfile: join(out, `tether.${name}${minify ? '.min' : ''}.js`),
  write: false,
  plugins: [partPlugin(exportsByFile), graphqlPlugin, minify ? terserPlugin : atomicWritePlugin],
});

/** Whether a `<script>` file is minified: the core and each part are built both ways. */
const SCRIPT_KINDS = [false, true];

/** @returns The optional parts of one kind, which the core of that kind depends on. */
async function partBuilds(out: string, minified: boolean): Promise<esbuild.BuildOptions[]> {
  const exportsByFile = await coreExports();
  return PARTS.map((name) => partBuild(out, exportsByFile, name, minified));
}

/**
 * @param onEmbed Called with the part hashes each build embeds (`partIntegrityPlugin`).
 * @returns The `<script>` core of one kind, which carries the hashes of the parts of its kind built before it.
 */
function scriptCoreBuild(out: string, minified: boolean, onEmbed?: (hashes: PartHashes) => void): esbuild.BuildOptions {
  const iife: esbuild.BuildOptions = { ...common, entryPoints: [join(SRC, 'index.ts')], format: 'iife' };
  const integrity = partIntegrityPlugin(out, minified, onEmbed);
  if (!minified)
    return { ...iife, outfile: join(out, 'tether.js'), plugins: [iifeLazyPlugin, integrity, graphqlPlugin] };
  return {
    ...iife,
    outfile: join(out, 'tether.min.js'),
    minify: true,
    sourcemap: 'external',
    write: false,
    plugins: [iifeLazyPlugin, integrity, graphqlPlugin, terserPlugin],
  };
}

/** @returns The ES modules for bundlers and the Barba preset. */
function moduleBuilds(out: string): esbuild.BuildOptions[] {
  return [
    {
      ...common,
      entryPoints: [join(SRC, 'index.ts'), join(SRC, 'server.ts'), join(SRC, 'astro.ts')],
      format: 'esm',
      splitting: true,
      minify: true,
      external: ['@occluze/tether', 'node:*'],
      outdir: join(out, 'esm'),
      chunkNames: 'chunks/[name]-[hash]',
      entryNames: '[name]',
    },
    {
      ...common,
      entryPoints: [join(SRC, 'presets/barba.ts')],
      format: 'esm',
      outfile: join(out, 'presets/barba.esm.js'),
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
async function buildTypes(out: string): Promise<void> {
  const outDir = join(out, 'types');
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(ROOT, '.config', 'tsconfig', 'declarations.json'),
    { outDir },
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.formatDiagnostics([diagnostic], diagnosticHost));
      },
    },
  );
  if (!parsed) throw new Error('.config/tsconfig/declarations.json could not be read');
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

/** The top-level entries a build writes into its output folder. */
const BUILD_ENTRIES: ReadonlySet<string> = new Set([
  'tether.js',
  'tether.min.js',
  'tether.min.js.map',
  'tether.esm.js',
  ...PARTS.flatMap((name) => [`tether.${name}.js`, `tether.${name}.min.js`]),
  'esm',
  'presets',
  'types',
]);

/** The files macOS's Finder and Windows' Explorer write into a folder someone opened. */
const OS_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** A part's file, `tether.<name>.js` or `tether.<name>.min.js`. */
const PART_FILE = /^tether\.([\w-]+?)(?:\.min)?\.js$/;

/**
 * @returns Whether `entry` is a file a build writes, `entries` being the output folder's: one of this build's
 *   (`BUILD_ENTRIES`), a file the OS writes (`OS_FILES`), a part a build of older source wrote, known by its other kind
 *   beside it, since a build writes every part both plain and minified, or the temporary file of any of those that an
 *   interrupted run left (`writeAtomically`). A site's own `tether.config.js` is none.
 */
function isBuildEntry(entry: string, entries: readonly string[]): boolean {
  const written = entry.replace(TEMPORARY_SUFFIX, '');
  if (BUILD_ENTRIES.has(written) || OS_FILES.has(written)) return true;
  const part = PART_FILE.exec(written)?.[1];
  return part !== undefined && entries.includes(`tether.${part}.js`) && entries.includes(`tether.${part}.min.js`);
}

/**
 * Exits unless the output folder is missing, empty or a build's, every entry one a build writes (`isBuildEntry`): the
 * build replaces the folder, so a mistyped `--out`, or one naming a site's asset folder, can't remove other files.
 */
async function checkOut(): Promise<void> {
  const entries = existsSync(OUT) ? await readdir(OUT) : [];
  const foreign = entries.filter((entry) => !isBuildEntry(entry, entries)).toSorted();
  if (!foreign.length) return;
  console.error(`build: ${OUT} isn't a build's output folder (it holds ${foreign.join(', ')}): not replacing it`);
  process.exit(1);
}

/** Writes every file of the build into `out`. */
async function buildInto(out: string): Promise<void> {
  await writeFile(
    join(out, 'tether.esm.js'),
    "export * from './esm/index.js';\nexport { default } from './esm/index.js';\n",
  );
  await buildTypes(out);
  // The parts first: the cores read their hashes from the built files.
  const parts = await Promise.all(SCRIPT_KINDS.map((minified) => partBuilds(out, minified)));
  await Promise.all(parts.flat().map((options) => esbuild.build(options)));
  const cores = SCRIPT_KINDS.map((minified) => scriptCoreBuild(out, minified));
  await Promise.all([...cores, ...moduleBuilds(out)].map((options) => esbuild.build(options)));
}

/**
 * Builds into a new folder and puts it in the output folder's place once every step has succeeded (`replaceFolder`): a
 * part or preset the source no longer has can't stay in dist/, where the release's fresh-build check sees it as a
 * deletion, and a failed build leaves the folder as it was.
 */
async function build(): Promise<void> {
  await checkOut();
  await replaceFolder(OUT, buildInto);
}

/**
 * Watches the sources, rebuilding into the output folder itself. A part that rebuilds rebuilds the `<script>` core of
 * its kind too, until the core carries the hashes of the part files as they are then (`rebuildUntilCurrent`).
 */
async function watchAll(): Promise<void> {
  for (const options of moduleBuilds(OUT)) await (await esbuild.context(options)).watch();
  for (const minified of SCRIPT_KINDS) {
    let embedded: PartHashes | undefined;
    const core = await esbuild.context(
      scriptCoreBuild(OUT, minified, (hashes) => {
        embedded = hashes;
      }),
    );
    await core.watch();
    const rebuildCore: esbuild.Plugin = {
      name: 'tether-rebuild-core',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length) return;
          await rebuildUntilCurrent(
            () => core.rebuild(),
            () => embedded,
            () => partHashes(OUT, minified),
          );
        });
      },
    };
    for (const options of await partBuilds(OUT, minified)) {
      const context = await esbuild.context({ ...options, plugins: [...(options.plugins ?? []), rebuildCore] });
      await context.watch();
    }
  }
}

await build();
if (watch) await watchAll();
else await report();
