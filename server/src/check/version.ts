/**
 * Whether a newer Tether release in the deployed copy's range exists: a weekly updater that stopped shows up here.
 * Versions come from jsDelivr, because GitHub's API rate-limits unauthenticated calls from shared IPs.
 */
import { asList, asRecord, responseJsonOrNull, stringOrNull } from '../json.ts';
import { messageOf } from '../shared/error-message.ts';
import { compareVersions, newestInRange, parseVersion } from '../release-range.ts';

import type { Steps } from './steps.ts';

const VERSIONS_URL = 'https://data.jsdelivr.com/v1/packages/gh/ravi-klaassens/tether';

function newerThan(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  return Boolean(left && right && compareVersions(left, right) > 0);
}

/**
 * @param json jsDelivr's package answer: `{ versions: [{ version }] }`, each the tag without its `v`.
 */
function parseVersions(json: unknown): string[] {
  return asList(asRecord(json)['versions']).flatMap((entry) => {
    const version = stringOrNull(asRecord(entry)['version']);
    return version ? [version.replace(/^v/, '')] : [];
  });
}

/**
 * @param options `range` defaults to the running version's minor.
 */
export async function checkTetherVersion(
  steps: Steps,
  { fetch, version, range }: { fetch: typeof globalThis.fetch; version: string; range: string | null },
): Promise<void> {
  const spec = range || version.split('.').slice(0, 2).join('.');
  let tags: string[];
  try {
    const res = await fetch(VERSIONS_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`jsDelivr answered ${String(res.status)}`);
    tags = parseVersions(await responseJsonOrNull(res));
  } catch (error) {
    // Not an error in the setup: the check for updates runs again next time.
    steps.add('info', 'Tether version', `${version}; couldn't look for a newer release (${messageOf(error)})`);
    return;
  }
  let newest: string | null;
  try {
    newest = newestInRange(tags, spec);
  } catch (error) {
    steps.add(
      'warn',
      'Tether version',
      `${version}; ${messageOf(error)}`,
      'Fix TETHER_VERSION: the updater refuses it too.',
    );
    return;
  }
  if (newest && newerThan(newest, version)) {
    steps.add(
      'warn',
      'Tether version',
      `${version} runs, ${newest} is available (range ${spec}).`,
      "The copy's Update Tether action installs it on Monday; to update now: GitHub → your copy → Actions → Update Tether → Run workflow.",
    );
  } else steps.add('ok', 'Tether version', `${version} (newest in range ${spec})`);
}
