/**
 * What a release needs in the tree it runs in: `release.ts` and every file it imports, the workflows a release runs
 * (`RELEASE_WORKFLOWS`), the scripts those run and the files those import, the packages all of them import and the
 * npm scripts the workflows run. A maintenance branch, made from an older tag, gets the missing files from main, and
 * `release.ts` checks for them first (`releaseToolingProblems`), before it imports anything else, so it can name
 * every one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join, posix } from 'node:path';
import { field, isRecord } from '../server/src/shared/json.ts';

/** The tag's `release.yml`, the branch's `ci.yml`, whose passing run the release needs, and the rehearsal's. */
export const RELEASE_WORKFLOWS: readonly string[] = [
  '.github/workflows/release.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release-rehearsal.yml',
];
const RELEASE_SCRIPT = 'scripts/release.ts';

/** A static `import … from`, `export … from` or bare `import '…'`, or a dynamic import of a string literal. */
const IMPORT =
  /^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
const SCRIPT_RUN = /\bnode\b[^\n]*?(?<![\w./-])(scripts\/[\w./-]+\.ts)\b/g;
/** An npm script's name, which may have `:` inside (`lint:workflows`) but not at its end, where prose puts one. */
const NPM_RUN = /\bnpm run ([\w-]+(?::[\w-]+)*)/g;

/** @returns The text of `file`, relative to the repository root with `/`, or `null` when there is none to read. */
export type SourceReader = (file: string) => Promise<string | null>;

/** What a release needs: every file, relative to the repository root with `/`, package and npm script, each sorted. */
export interface ReleaseTooling {
  files: string[];
  packages: string[];
  npmScripts: string[];
}

/** @returns The package `specifier` names: `yaml` for `yaml/util`, `@scope/name` for `@scope/name/sub`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return (specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
}

/**
 * Walks the imports of `entries` through this repository's own files. A file `read` has no text for is listed and not
 * walked further, and so is a data file (JSON), which imports nothing.
 *
 * @returns The files reached, `entries` included, and the packages they import, each sorted.
 */
export async function importsOf(
  read: SourceReader,
  entries: readonly string[],
): Promise<{ files: string[]; packages: string[] }> {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [...entries];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    const source = /\.[cm]?[jt]s$/.test(file) ? await read(file) : null;
    for (const match of source?.matchAll(IMPORT) ?? []) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? '';
      if (specifier.startsWith('.')) pending.push(posix.join(posix.dirname(file), specifier));
      else if (!specifier.startsWith('node:') && !builtinModules.includes(specifier)) {
        packages.add(packageOf(specifier));
      }
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}

/**
 * @param workflow A workflow's text.
 * @returns The repository scripts its steps run with `node`, and the npm scripts they run, each sorted; a comment's
 *   mention of one doesn't count.
 */
export function workflowRuns(workflow: string): { scripts: string[]; npmScripts: string[] } {
  const code = workflow
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  const found = (pattern: RegExp) => [...new Set([...code.matchAll(pattern)].map((match) => match[1] ?? ''))].sort();
  return { scripts: found(SCRIPT_RUN), npmScripts: found(NPM_RUN) };
}

export async function releaseTooling(read: SourceReader): Promise<ReleaseTooling> {
  const scripts = new Set<string>();
  const npmScripts = new Set<string>();
  for (const workflow of RELEASE_WORKFLOWS) {
    const runs = workflowRuns((await read(workflow)) ?? '');
    for (const script of runs.scripts) scripts.add(script);
    for (const name of runs.npmScripts) npmScripts.add(name);
  }
  const { files, packages } = await importsOf(read, [RELEASE_SCRIPT, ...scripts]);
  return { files: [...new Set([...RELEASE_WORKFLOWS, ...files])].sort(), packages, npmScripts: [...npmScripts].sort() };
}

/** @returns A reader of the tree at `root`. */
export const treeReader =
  (root: string): SourceReader =>
  async (file) =>
    existsSync(join(root, file)) ? readFile(join(root, file), 'utf8') : null;

/**
 * @returns A reader of the tree at `root` that reads a file the tree lacks from its checkout's origin/main, so the walk
 *   goes on through what that file imports.
 */
function treeOrMainReader(root: string): SourceReader {
  const tree = treeReader(root);
  return async (file) => {
    const text = await tree(file);
    if (text !== null) return text;
    try {
      return execFileSync('git', ['-C', root, 'show', `origin/main:${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // origin/main lacks the file too, or `root` is no git checkout: there is nothing to walk.
      return null;
    }
  };
}

/**
 * @returns What the tree at `root` lacks of what a release needs (`releaseTooling`, walking a missing file's imports in
 *   origin/main's copy): files, packages its package.json doesn't list and npm scripts it doesn't define. Nothing for
 *   a tree at main.
 */
export async function releaseToolingProblems(root: string): Promise<string[]> {
  const needed = await releaseTooling(treeOrMainReader(root));
  const manifest: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const keys = (name: string): Set<string> => {
    const value = field(manifest, name);
    return new Set(isRecord(value) ? Object.keys(value) : []);
  };
  const listed = new Set([...keys('dependencies'), ...keys('devDependencies')]);
  const defined = keys('scripts');
  const missing = needed.files.filter((file) => !existsSync(join(root, file)));
  return [
    ...(missing.length ? [`missing files, which main has: git checkout origin/main -- ${missing.join(' ')}`] : []),
    ...needed.packages
      .filter((name) => !listed.has(name))
      .map((name) => `package.json doesn't list the package ${name}`),
    ...needed.npmScripts.filter((name) => !defined.has(name)).map((name) => `package.json has no "${name}" script`),
  ];
}
