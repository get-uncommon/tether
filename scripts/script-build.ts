/**
 * The `<script>` build (build.ts): the core, `tether(.min).js`, and the optional parts, `tether.<part>(.min).js`, each
 * built plain and minified. The parts build first, so each core carries the integrity hashes of the parts of its kind
 * (src/part-integrity.ts). The source folder is a parameter, so a test can build and watch a copy of it.
 */
import * as esbuild from 'esbuild';
import { minify as terser } from 'terser';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { minifyGraphqlTemplates } from './graphql-minify.ts';
import { rebuildUntilCurrent, type PartHashes } from './watch-core.ts';
import { writeAtomically } from './write-atomically.ts';

/** The newest ECMAScript edition the browser files use, for esbuild's `target` and terser's `ecma`. */
const ECMA = 2020;
const TARGET = `es${String(ECMA)}`;

/** The optional parts, each `src/parts/<name>.ts` built into `tether.<name>(.min).js`. */
export const PARTS = ['diagnose', 'markets', 'search', 'lists', 'extras', 'account', 'account-pages', 'analytics'];

/** Whether a `<script>` file is minified: the core and each part are built both ways. */
const SCRIPT_KINDS = [false, true];

const graphqlPlugin: esbuild.Plugin = {
  name: 'tether-graphql',
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\].*\.ts$/ }, async (args) => ({
      contents: minifyGraphqlTemplates(await readFile(args.path, 'utf8'), args.path),
      loader: 'ts',
    }));
  },
};

/** The options every browser build shares, the ES modules' included. */
export const COMMON_OPTIONS: esbuild.BuildOptions = {
  bundle: true,
  target: TARGET,
  logLevel: 'warning',
  legalComments: 'none',
  plugins: [graphqlPlugin],
};

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
function iifeLazyPlugin(src: string): esbuild.Plugin {
  return {
    name: 'tether-iife-lazy',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\/lazy\.ts$/ }, (args) =>
        join(args.resolveDir, args.path) === join(src, 'lazy.ts') ? { path: join(src, 'lazy-iife.ts') } : undefined,
      );
    },
  };
}

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
async function coreExports(src: string): Promise<Record<string, string[]>> {
  const lazyIife = join(src, 'lazy-iife.ts');
  const coreModules = (await importSource(lazyIife))['coreModules'];
  // The browser program types lazy-iife.ts; here each entry is read as the list of values it is.
  const entries = Object.entries(coreModules as Record<string, unknown[]>);
  const exportsByFile: Record<string, string[]> = {};
  for (const [file, values] of entries) {
    // The <script> build's lazy.ts is lazy-iife.ts (`iifeLazyPlugin`).
    const module = await importSource(file === 'lazy.ts' ? lazyIife : join(src, file));
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
function partPlugin(src: string, exportsByFile: Record<string, string[]>): esbuild.Plugin {
  return {
    name: 'tether-part',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\/[\w-]+\.ts$/ }, (args) => {
        const file = basename(args.path);
        const inSrc = dirname(join(args.resolveDir, args.path)) === src;
        return inSrc && file in exportsByFile ? { path: file, namespace: 'tether-core' } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: 'tether-core' }, (args) => ({
        contents: `const m = window.Tether.__core[${JSON.stringify(args.path)}];\nexport const [${(exportsByFile[args.path] ?? []).join(', ')}] = m;\n`,
        loader: 'js',
      }));
    },
  };
}

/** @returns The optional parts of one kind, which the core of that kind depends on. */
async function partBuilds(src: string, out: string, minified: boolean): Promise<esbuild.BuildOptions[]> {
  const exportsByFile = await coreExports(src);
  return PARTS.map((name) => ({
    ...COMMON_OPTIONS,
    entryPoints: [join(src, 'parts', `${name}.ts`)],
    format: 'iife',
    minify: minified,
    outfile: join(out, `tether.${name}${minified ? '.min' : ''}.js`),
    write: false,
    plugins: [partPlugin(src, exportsByFile), graphqlPlugin, minified ? terserPlugin : atomicWritePlugin],
  }));
}

/**
 * @param onEmbed Called with the part hashes each build embeds (`partIntegrityPlugin`).
 * @returns The `<script>` core of one kind, which carries the hashes of the parts of its kind built before it.
 */
function scriptCoreBuild(
  src: string,
  out: string,
  minified: boolean,
  onEmbed?: (hashes: PartHashes) => void,
): esbuild.BuildOptions {
  const iife: esbuild.BuildOptions = { ...COMMON_OPTIONS, entryPoints: [join(src, 'index.ts')], format: 'iife' };
  const plugins = [iifeLazyPlugin(src), partIntegrityPlugin(out, minified, onEmbed), graphqlPlugin];
  if (!minified) {
    return { ...iife, outfile: join(out, 'tether.js'), write: false, plugins: [...plugins, atomicWritePlugin] };
  }
  return {
    ...iife,
    outfile: join(out, 'tether.min.js'),
    minify: true,
    sourcemap: 'external',
    write: false,
    plugins: [...plugins, terserPlugin],
  };
}

/** Builds the parts of both kinds from `src` into `out`, then the cores, which read the parts' hashes. */
export async function buildScripts(src: string, out: string): Promise<void> {
  const parts = await Promise.all(SCRIPT_KINDS.map((minified) => partBuilds(src, out, minified)));
  await Promise.all(parts.flat().map((options) => esbuild.build(options)));
  await Promise.all(SCRIPT_KINDS.map((minified) => esbuild.build(scriptCoreBuild(src, out, minified))));
}

/**
 * Watches the sources in `src` for the core and the parts of one kind, rebuilding into `out`, which already holds a
 * build (`buildScripts`). A part that rebuilds rebuilds the core too, once it has written its file, until the core
 * carries the hashes of the part files as they are then (`rebuildUntilCurrent`).
 *
 * @param minified Which kind: the plain core and parts, or the minified ones.
 * @returns Stops the watch.
 */
export async function watchKind(src: string, out: string, minified: boolean): Promise<() => Promise<void>> {
  let embedded: PartHashes | undefined;
  const core = await esbuild.context(
    scriptCoreBuild(src, out, minified, (hashes) => {
      embedded = hashes;
    }),
  );
  await core.watch();
  /** The core rebuilds that parts' builds have started and that haven't ended. */
  const coreRebuilds = new Set<Promise<void>>();
  let stopped = false;
  const rebuildCore: esbuild.Plugin = {
    name: 'tether-rebuild-core',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length || stopped) return;
        const rebuilt = rebuildUntilCurrent(
          () => core.rebuild(),
          () => embedded,
          () => partHashes(out, minified),
        );
        coreRebuilds.add(rebuilt);
        try {
          await rebuilt;
        } finally {
          coreRebuilds.delete(rebuilt);
        }
      });
    },
  };
  const parts: esbuild.BuildContext[] = [];
  for (const options of await partBuilds(src, out, minified)) {
    // Last: esbuild runs the onEnd callbacks in plugin order, and the part's own plugin writes its file.
    const context = await esbuild.context({ ...options, plugins: [...(options.plugins ?? []), rebuildCore] });
    parts.push(context);
    await context.watch();
  }
  return async () => {
    stopped = true;
    await Promise.all(parts.map((context) => context.dispose()));
    // A core rebuild a part's build started calls the core's `rebuild` until it ends, which a disposed core would fail.
    await Promise.allSettled(coreRebuilds);
    await core.dispose();
  };
}

/** Watches the sources in `src` for every `<script>` file, rebuilding into `out` (`watchKind`). */
export async function watchScripts(src: string, out: string): Promise<void> {
  for (const minified of SCRIPT_KINDS) await watchKind(src, out, minified);
}
