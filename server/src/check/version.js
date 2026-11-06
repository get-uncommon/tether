/**
 * Whether a newer Tether release in the deployed copy's range exists: a weekly updater that stopped shows up here.
 * Versions come from jsDelivr, because GitHub's API rate-limits unauthenticated calls from shared IPs.
 */
import { asList, asRecord, responseJsonOrNull, stringOrNull } from '../json.js';
import { messageOf } from '../util.js';
import { compareVersions, newestInRange, parseVersion } from '../release-range.js';

/** @typedef {import('./steps.js').Steps} Steps */

const VERSIONS_URL = 'https://data.jsdelivr.com/v1/packages/gh/ravi-klaassens/tether';

/**
 * @param {string} a
 * @param {string} b
 */
function newerThan(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  return Boolean(left && right && compareVersions(left, right) > 0);
}

/**
 * @param {unknown} json jsDelivr's package answer: `{ versions: [{ version }] }`, each the tag without its `v`.
 * @returns {string[]}
 */
function parseVersions(json) {
  return asList(asRecord(json)['versions']).flatMap((entry) => {
    const version = stringOrNull(asRecord(entry)['version']);
    return version ? [version.replace(/^v/, '')] : [];
  });
}

/**
 * @param {Steps} steps
 * @param {{ fetch: typeof fetch, version: string, range: string | null }} options `range` defaults to the running
 *   version's minor.
 */
export async function checkTetherVersion(steps, { fetch, version, range }) {
  const spec = range || version.split('.').slice(0, 2).join('.');
  /** @type {string[]} */
  let tags;
  try {
    const res = await fetch(VERSIONS_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`jsDelivr answered ${String(res.status)}`);
    tags = parseVersions(await responseJsonOrNull(res));
  } catch (error) {
    // Not an error in the setup: the check for updates runs again next time.
    steps.add('info', 'Tether version', `${version}; couldn't look for a newer release (${messageOf(error)})`);
    return;
  }
  /** @type {string | null} */
  let newest;
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
