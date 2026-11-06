/**
 * Whether a newer Tether release in the deployed copy's range exists: a weekly updater that stopped shows up here.
 * Versions come from jsDelivr, because GitHub's API rate-limits unauthenticated calls from shared IPs.
 */
import { asList, asRecord, responseJsonOrNull, stringOrNull } from '../json.js';
import { messageOf } from '../util.js';

/** @typedef {import('./steps.js').Steps} Steps */

const VERSIONS_URL = 'https://data.jsdelivr.com/v1/packages/gh/ravi-klaassens/tether';
const RELEASE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** @param {string} version */
function parts(version) {
  return version.replace(/^v/, '').split('.').map(Number);
}

/**
 * @param {string} a
 * @param {string} b
 */
function newerThan(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let index = 0; index < 3; index++) {
    const left = x[index] ?? 0;
    const right = y[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/**
 * Which versions a jsDelivr-style range accepts: `latest` (or empty), a major (`0`), a minor (`0.3`) or one version.
 *
 * @param {string} spec
 * @returns {(version: string) => boolean}
 */
function rangeMatcher(spec) {
  if (spec === 'latest' || spec === '') return () => true;
  if (/^\d+$/.test(spec)) return (version) => version.split('.')[0] === spec;
  if (/^\d+\.\d+$/.test(spec)) return (version) => version.split('.').slice(0, 2).join('.') === spec;
  return (version) => version === spec;
}

/**
 * Newest release tag in a range; the same rules as scripts/update-tether.mjs.
 *
 * @param {string[]} tags
 * @param {string} spec
 * @returns {string | null}
 */
function pickVersion(tags, spec) {
  const inRange = rangeMatcher(spec.trim().replace(/^v/, '').toLowerCase());
  const releases = tags.flatMap((tag) => {
    const match = RELEASE_TAG.exec(tag);
    return match ? [[match[1], match[2], match[3]].join('.')] : [];
  });
  return (
    releases
      .filter(inRange)
      .sort((a, b) => (newerThan(a, b) ? 1 : -1))
      .pop() ?? null
  );
}

/**
 * @param {unknown} json jsDelivr's package answer: `{ versions: [{ version }] }`.
 * @returns {string[]}
 */
function parseVersions(json) {
  return asList(asRecord(json)['versions']).flatMap((entry) => {
    const version = stringOrNull(asRecord(entry)['version']);
    return version ? [version] : [];
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
  const newest = pickVersion(tags, spec);
  if (newest && newest !== version && newerThan(newest, version)) {
    steps.add(
      'warn',
      'Tether version',
      `${version} runs, ${newest} is available (range ${spec}).`,
      "The copy's Update Tether action installs it on Monday; to update now: GitHub → your copy → Actions → Update Tether → Run workflow.",
    );
  } else steps.add('ok', 'Tether version', `${version} (newest in range ${spec})`);
}
