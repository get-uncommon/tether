/**
 * Tether release versions and the ranges a deployed copy updates within (its TETHER_VERSION file), the way jsDelivr
 * ranges work: `latest` (or `*`, or empty) for any release, a major (`0`), a minor (`0.3`) or one version (`0.3.3`).
 * Shared by the updater (`scripts/update-tether.mjs`, which a deployed copy runs with plain Node) and the Worker's
 * `/check`, so both pick the same release.
 */

/** @typedef {[major: number, minor: number, patch: number]} Version */

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * @param {string} text `0.3.3`, without a `v`.
 * @returns {Version | null}
 */
export function parseVersion(text) {
  const match = VERSION.exec(text.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Negative when `a` is older than `b`, 0 when they are equal, positive when it is newer.
 *
 * @param {Version} a
 * @param {Version} b
 */
export function compareVersions(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * @param {string} spec `latest`, `0`, `0.3` or `0.3.3`; a leading `v` and case are ignored.
 * @returns {(version: Version) => boolean}
 * @throws {Error} For anything else.
 */
function rangeMatcher(spec) {
  const range = spec.trim().replace(/^v/, '').toLowerCase();
  if (range === 'latest' || range === '*' || range === '') return () => true;
  if (/^\d+$/.test(range)) return (version) => version[0] === Number(range);
  if (/^\d+\.\d+$/.test(range)) {
    const [major, minor] = range.split('.').map(Number);
    return (version) => version[0] === major && version[1] === minor;
  }
  const exact = parseVersion(range);
  if (exact) return (version) => compareVersions(version, exact) === 0;
  throw new Error(`TETHER_VERSION must be latest, 0, 0.3 or 0.3.3 (got "${spec}")`);
}

/**
 * The newest of `versions` in the range.
 *
 * @param {string[]} versions `0.3.3`, without a `v`; anything else is skipped.
 * @param {string} spec See {@link rangeMatcher}.
 * @returns {string | null} `0.3.3`.
 * @throws {Error} For a spec {@link rangeMatcher} refuses.
 */
export function newestInRange(versions, spec) {
  const inRange = rangeMatcher(spec);
  const newest = versions
    .map(parseVersion)
    .filter((version) => version !== null)
    .filter(inRange)
    .sort(compareVersions)
    .at(-1);
  return newest ? newest.join('.') : null;
}
