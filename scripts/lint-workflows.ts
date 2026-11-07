/**
 * Lints Tether's own workflows and the one the sync Worker ships, as CI's `workflows` job does, with actionlint (and the
 * shellcheck it runs on each `run:` script) and zizmor:
 *
 *   node --experimental-strip-types scripts/lint-workflows.ts
 *
 * CI's `workflows` job runs this script, and lefthook runs it before each push, so both use the exact versions in
 * `.config/workflow-linters.json`, with a sha256 per platform: GitHub's digest of each release asset for actionlint
 * and shellcheck, and PyPI's for zizmor's wheel. Each tool is downloaded once into `node_modules/.cache/` and used only
 * once its download matches. zizmor is a Python package: it is installed into its own venv with pip's
 * `--require-hashes`, so the first run needs Python 3. Without Python the run fails, unless the commits being pushed
 * don't change a workflow, when zizmor is skipped with a note.
 *
 * zizmor's online audits (that a pinned commit is its action's, known-vulnerable actions) need a GitHub token: GH_TOKEN
 * or GITHUB_TOKEN from the environment. Without one zizmor runs only its offline audits, as it says; CI runs them all.
 *
 * The v0.6.8 workflow in test/workflows/ is a fixture of what old copies run, and is left as it is.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import linters from '../.config/workflow-linters.json' with { type: 'json' };

interface Asset {
  file: string;
  sha256: string;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'node_modules', '.cache', 'workflow-linters');
const WORKFLOW_FOLDERS = ['.github/workflows', 'server/.github/workflows'];
const PLATFORM = `${process.platform}-${process.arch}`;
const EXE = process.platform === 'win32' ? '.exe' : '';

class LintSetupError extends Error {}

function assetFor(name: keyof typeof linters): Asset & { version: string } {
  const { version } = linters[name];
  const platforms: Partial<Record<string, Asset>> = linters[name].platforms;
  const asset = platforms[PLATFORM];
  if (asset === undefined) {
    throw new LintSetupError(
      `.config/workflow-linters.json has no ${name} ${version} for ${PLATFORM}: add its file and published sha256`,
    );
  }
  return { ...asset, version };
}

/** The folder a verified download of `url` was unpacked into, unpacking it first if this cache doesn't have it. */
async function unpacked(name: string, url: string, asset: Asset): Promise<string> {
  const folder = join(CACHE, `${name}-${asset.sha256.slice(0, 16)}`);
  if (existsSync(folder)) return folder;
  console.log(`lint-workflows: downloading ${asset.file}`);
  const response = await fetch(url);
  if (!response.ok) throw new LintSetupError(`${url} answered ${String(response.status)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) {
    throw new LintSetupError(`${asset.file} has sha256 ${sha256}, not the pinned ${asset.sha256}: not using it`);
  }
  // Unpacked beside the cache entry and renamed into it, so an interrupted run leaves nothing a later one would trust.
  const partial = `${folder}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  const archive = join(partial, asset.file);
  await writeFile(archive, bytes);
  // Windows' own tar (bsdtar) reads zip files; a tar that Git for Windows puts first on PATH doesn't.
  const tar =
    process.platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', asset.file], { cwd: partial, stdio: 'inherit' });
  await rm(archive);
  await rename(partial, folder);
  return folder;
}

/** The path of `binary` in an unpacked release, at its top or in the one folder the archive holds. */
async function binaryIn(folder: string, binary: string): Promise<string> {
  if (existsSync(join(folder, binary))) return join(folder, binary);
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(folder, entry.name, binary))) return join(folder, entry.name, binary);
  }
  throw new LintSetupError(`${folder} has no ${binary}: delete the folder and run again`);
}

async function actionlint(): Promise<string> {
  const asset = assetFor('actionlint');
  const url = `https://github.com/rhysd/actionlint/releases/download/v${asset.version}/${asset.file}`;
  return binaryIn(await unpacked(`actionlint-${asset.version}`, url, asset), `actionlint${EXE}`);
}

async function shellcheck(): Promise<string> {
  const asset = assetFor('shellcheck');
  const url = `https://github.com/koalaman/shellcheck/releases/download/v${asset.version}/${asset.file}`;
  return binaryIn(await unpacked(`shellcheck-${asset.version}`, url, asset), `shellcheck${EXE}`);
}

/** The first Python 3 on PATH, as a command and the arguments it needs before its own. */
function python(): string[] | null {
  const candidates = process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  return (
    candidates.find(([command = '', ...args]) => {
      const probe = spawnSync(command, [...args, '-c', 'import sys, venv; sys.exit(sys.version_info < (3, 9))']);
      return probe.status === 0;
    }) ?? null
  );
}

/**
 * zizmor in its own venv, installed from the pinned wheel only; null when there is no Python. The venv is complete once
 * its `installed` file names the wheel's sha256.
 */
async function zizmor(): Promise<string | null> {
  const asset = assetFor('zizmor');
  const venv = join(CACHE, `zizmor-${asset.version}-${asset.sha256.slice(0, 16)}`);
  const bin = join(venv, process.platform === 'win32' ? 'Scripts' : 'bin');
  const stamp = join(venv, 'installed');
  if (existsSync(stamp) && (await readFile(stamp, 'utf8')) === asset.sha256) return join(bin, `zizmor${EXE}`);
  const interpreter = python();
  if (interpreter === null) return null;
  const [command = '', ...args] = interpreter;
  console.log(`lint-workflows: installing ${asset.file} into ${relative(ROOT, venv)}`);
  await rm(venv, { recursive: true, force: true });
  execFileSync(command, [...args, '-m', 'venv', venv], { stdio: 'inherit' });
  const requirements = join(venv, 'requirements.txt');
  await writeFile(requirements, `zizmor==${asset.version} --hash=sha256:${asset.sha256}\n`);
  execFileSync(
    join(bin, `python${EXE}`),
    [
      '-m',
      'pip',
      'install',
      '--quiet',
      '--disable-pip-version-check',
      '--only-binary',
      ':all:',
      '--require-hashes',
      '-r',
      requirements,
    ],
    { stdio: 'inherit' },
  );
  await writeFile(stamp, asset.sha256);
  return join(bin, `zizmor${EXE}`);
}

/**
 * Whether the commits being pushed change a workflow: those after the branch's push target, or after origin's default
 * branch when it has none. True when neither is known, so a missing Python fails the run rather than skip a check.
 */
function pushTouchesWorkflows(): boolean {
  for (const base of ['@{push}', 'origin/HEAD', 'origin/main']) {
    const resolved = spawnSync('git', ['rev-parse', '--verify', '--quiet', base], { cwd: ROOT, encoding: 'utf8' });
    if (resolved.status !== 0) continue;
    const changed = execFileSync('git', ['diff', '--name-only', `${resolved.stdout.trim()}...HEAD`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return changed.split('\n').some((file) => /(^|\/)\.github\//.test(file));
  }
  return true;
}

/**
 * A GitHub token for zizmor's online audits, only when one is set in the environment: a hook doesn't reach for the
 * developer's own GitHub CLI login. CI sets GH_TOKEN, so the online audits always run there.
 */
function githubToken(): string | null {
  const fromEnv = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'];
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : null;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env }).status === 0;
}

const workflows: string[] = [];
for (const folder of WORKFLOW_FOLDERS) {
  for (const file of (await readdir(join(ROOT, folder))).sort()) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) workflows.push(`${folder}/${file}`);
  }
}

try {
  const [actionlintPath, shellcheckPath] = await Promise.all([actionlint(), shellcheck()]);
  // No Python step anywhere, so no pyflakes: an empty path turns it off instead of using whatever is on PATH.
  const actionlintArgs = ['-shellcheck', shellcheckPath, '-pyflakes=', ...workflows];
  if (process.env['CI'] !== undefined) actionlintArgs.unshift('-color');
  let passed = run(actionlintPath, actionlintArgs);

  const zizmorPath = await zizmor();
  if (zizmorPath !== null) {
    const token = githubToken();
    if (token === null) console.log('lint-workflows: no GitHub token, so zizmor runs only its offline audits');
    const env = token === null ? process.env : { ...process.env, GH_TOKEN: token };
    passed = run(zizmorPath, WORKFLOW_FOLDERS, env) && passed;
  } else if (pushTouchesWorkflows()) {
    throw new LintSetupError(
      'zizmor needs Python 3 with venv (python3, python or py on PATH), and these commits change a workflow. ' +
        'Install Python, then push again.',
    );
  } else {
    console.log("lint-workflows: no Python, so zizmor is skipped: the commits being pushed don't change a workflow");
  }
  if (!passed) process.exitCode = 1;
} catch (error) {
  if (!(error instanceof LintSetupError)) throw error;
  console.error(`lint-workflows: ${error.message}`);
  process.exitCode = 1;
}
