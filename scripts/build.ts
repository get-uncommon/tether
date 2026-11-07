/**
 * Builds dist/, or the folder after `--out`, which the tests use so the committed dist/ only changes in a release. The
 * build replaces the folder once every step has succeeded (`build`), so it holds exactly these files:
 *
 *   tether.min.js (+ .map), tether.js     the <script> build (IIFE)
 *   tether.<part>(.min).js                the optional parts, loaded on first use (`PARTS` in script-build.ts);
 *                                         built first, so the core carries their integrity hashes
 *                                         (src/part-integrity.ts)
 *   esm/                                  ES modules for bundlers, the parts as split chunks
 *   tether.esm.js                         re-export of esm/index.js (older import path)
 *   presets/barba.esm.js
 *   types/                               the published .d.ts, generated from the source by tsc
 *                                         (.config/tsconfig/declarations.json)
 *
 * Size comes from the build, not from golfed source: ES2020 output (no helpers for ?. and ??), GraphQL strings
 * minified, the minified `<script>` files passed through terser as well (script-build.ts), the parts in their own
 * files.
 */
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { replaceFolder } from './replace-folder.ts';
import { COMMON_OPTIONS, PARTS, buildScripts, watchScripts } from './script-build.ts';
import { TEMPORARY_SUFFIX } from './write-atomically.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const watch = process.argv.includes('--watch');
const outIndex = process.argv.indexOf('--out');
const OUT = resolve(ROOT, outIndex === -1 ? 'dist' : (process.argv[outIndex + 1] ?? 'dist'));
const BYTES_PER_KB = 1024;
const GZIP_LEVEL = 9;

/** @returns The ES modules for bundlers and the Barba preset. */
function moduleBuilds(out: string): esbuild.BuildOptions[] {
  return [
    {
      ...COMMON_OPTIONS,
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
      ...COMMON_OPTIONS,
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
 *   interrupted run left (`writeAtomically` in write-atomically.ts). A site's own `tether.config.js` is none.
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
  await Promise.all([buildScripts(SRC, out), ...moduleBuilds(out).map((options) => esbuild.build(options))]);
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

/** Watches the sources, rebuilding into the output folder itself (`watchScripts` for the `<script>` files). */
async function watchAll(): Promise<void> {
  for (const options of moduleBuilds(OUT)) await (await esbuild.context(options)).watch();
  await watchScripts(SRC, OUT);
}

await build();
if (watch) await watchAll();
else await report();
