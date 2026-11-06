/**
 * The signed form of a release: `tether-server-<version>.tar.gz`, which the upstream repository's release workflow
 * (`.github/workflows/release.yml`) builds from the tag's `server/` folder, attests with a GitHub artifact attestation
 * and uploads to the GitHub Release. The updater installs a release only from this file, and only after
 * `gh attestation verify` confirms that this workflow built it from the tag's commit. A download that was swapped on
 * the way, or a file uploaded to the Release by hand, has no such attestation and is refused.
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { asList, field } from '../src/shared/json.ts';

export type GitHubGet = (path: string) => Promise<unknown>;
/** How a command ended. `missing`: the program isn't installed, which a person running the updater by hand can fix. */
type CommandResult = { kind: 'exited'; status: number; output: string } | { kind: 'missing' };
type RunCommand = (command: string, args: string[]) => CommandResult;
/**
 * What to do without `gh`: `require` refuses to install, `allow-unverified` installs with a warning. Either way a
 * verification that `gh` ran and that failed is refused: it means the file is not what the release workflow built.
 */
export type VerifyPolicy = 'require' | 'allow-unverified';
type Verification = { kind: 'verified' } | { kind: 'unverified' };
interface Release {
  upstream: string;
  version: string;
  sha: string;
}
/** Where a release comes from: the GitHub API, a command runner for `gh`, and the download. Tests pass fakes. */
interface ReleaseSource {
  get: GitHubGet;
  run: RunCommand;
  download: (url: string, dir: string) => Promise<string>;
}

/** The first release whose GitHub Release carries the attested asset. */
export const FIRST_SIGNED_RELEASE = '0.7.0';

/** @param version `0.7.0`. */
export function releaseAssetName(version: string): string {
  return `tether-server-${version}.tar.gz`;
}

export function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    if ('code' in result.error && result.error.code === 'ENOENT') return { kind: 'missing' };
    throw result.error;
  }
  return { kind: 'exited', status: result.status ?? 1, output: `${result.stdout}${result.stderr}`.trim() };
}

function unsignedRelease(release: Release, why: string): Error {
  return new Error(
    `v${release.version} has no signed ${releaseAssetName(release.version)} on its GitHub Release (${why}). ` +
      `Releases before ${FIRST_SIGNED_RELEASE} have none, so this updater can't install them: ` +
      `set TETHER_VERSION to ${FIRST_SIGNED_RELEASE} or newer.`,
  );
}

/**
 * The download URL of the release's signed asset.
 *
 * @throws When the GitHub Release or its asset is missing, naming the releases that never had one.
 */
export async function releaseAssetUrl(get: GitHubGet, release: Release): Promise<string> {
  const name = releaseAssetName(release.version);
  let answer: unknown;
  try {
    answer = await get(`/repos/${release.upstream}/releases/tags/v${release.version}`);
  } catch (error) {
    throw unsignedRelease(release, error instanceof Error ? error.message : String(error));
  }
  const asset = asList(field(answer, 'assets')).find((entry) => field(entry, 'name') === name);
  const url = field(asset, 'browser_download_url');
  if (typeof url !== 'string') throw unsignedRelease(release, `no asset named ${name}`);
  return url;
}

/**
 * Checks that `file` was built by the upstream release workflow, from the tag's commit.
 *
 * @param file The downloaded asset.
 * @param release `sha` is the tag's commit, already checked to be on the default branch.
 * @throws When the attestation doesn't verify, or `gh` is missing and the policy requires it.
 */
export function verifyAttestation(run: RunCommand, file: string, release: Release, policy: VerifyPolicy): Verification {
  const { upstream, version, sha } = release;
  const result = run('gh', [
    'attestation',
    'verify',
    file,
    '--repo',
    upstream,
    '--signer-workflow',
    `${upstream}/.github/workflows/release.yml`,
    '--source-ref',
    `refs/tags/v${version}`,
    '--source-digest',
    sha,
  ]);
  if (result.kind === 'missing') {
    if (policy === 'allow-unverified') return { kind: 'unverified' };
    throw new Error(
      `v${version} can't be verified: the GitHub CLI (gh) is not installed. Install it (https://cli.github.com) ` +
        'and run again, or pass --allow-unverified to install without checking where the file came from.',
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `v${version}: ${releaseAssetName(version)} failed its attestation check: not installed\n${result.output}`,
    );
  }
  return { kind: 'verified' };
}

/**
 * Downloads the release's signed asset into `dir`.
 *
 * @param dir An empty folder, which the caller removes.
 * @returns The downloaded file.
 */
export async function downloadAsset(url: string, dir: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${url}: ${response.status}`);
  const archive = join(dir, 'release.tgz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  return archive;
}

/**
 * Unpacks a release archive whose single top folder holds `server/`.
 *
 * @param dir The folder to unpack into.
 * @returns The unpacked `server/` folder.
 */
export function unpackRelease(archive: string, dir: string): string {
  // A relative path: GNU tar reads the `C:` of a Windows path as a remote host.
  execFileSync('tar', ['-xzf', relative(dir, archive), '--strip-components=1'], { cwd: dir });
  const server = join(dir, 'server');
  if (!existsSync(join(server, 'package.json'))) throw new Error(`${archive} has no server/ folder`);
  return server;
}

/**
 * Downloads the release's signed asset, verifies it, and only then unpacks it.
 *
 * @param dir An empty folder, which the caller removes.
 * @returns The unpacked `server/` folder.
 */
export async function fetchSignedRelease(
  source: ReleaseSource,
  release: Release,
  dir: string,
  policy: VerifyPolicy,
): Promise<string> {
  const archive = await source.download(await releaseAssetUrl(source.get, release), dir);
  const verification = verifyAttestation(source.run, archive, release, policy);
  if (verification.kind === 'unverified') {
    console.log(`::warning::v${release.version} installed without verifying its signature (--allow-unverified, no gh)`);
  }
  return unpackRelease(archive, dir);
}
