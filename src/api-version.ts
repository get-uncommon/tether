/**
 * Shopify API versions are quarterly (YYYY-01, -04, -07, -10) and supported for 12 months. Tether pins a dated version
 * and never targets `unstable` (it changes without notice). Used by the config, the diagnose part and the release
 * scripts.
 */

const QUARTERLY_VERSION = /^(\d{4})-(01|04|07|10)$/;
const MONTHS_PER_QUARTER = 3;
const QUARTERS_PER_YEAR = 4;
const MONTHS_SUPPORTED = 12;
/** Months left at which the status starts asking for an upgrade. */
const UPGRADE_WARNING_MONTHS = 3;
const AVERAGE_MONTH_MS = 30.44 * 24 * 3600 * 1000;

export interface ApiVersionStatus {
  version: string;
  /** Released and still supported. */
  ok: boolean;
  /** What to do about it, for people. */
  note: string;
  /** Months of support left, rounded; negative once support ended. */
  monthsLeft?: number;
  /** The version after this one. */
  next?: string;
}

function parseVersion(version: unknown): { year: number; month: number } | null {
  const match = QUARTERLY_VERSION.exec(typeof version === 'string' ? version : '');
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** @returns True for a dated version such as `2026-07`. */
export const isQuarterlyVersion = (version: unknown): version is string => parseVersion(version) !== null;

/** @param month 1 to 12. */
const formatVersion = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/**
 * `'2026-07'` → `'2026-10'`, `'2026-10'` → `'2027-01'`.
 *
 * @param steps Quarters ahead.
 * @throws {Error} When `version` isn't a quarterly version.
 */
export function nextApiVersion(version: string, steps = 1): string {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`not a quarterly Shopify API version: ${version}`);
  const quarter = parsed.year * QUARTERS_PER_YEAR + (parsed.month - 1) / MONTHS_PER_QUARTER + steps;
  return formatVersion(Math.floor(quarter / QUARTERS_PER_YEAR), (quarter % QUARTERS_PER_YEAR) * MONTHS_PER_QUARTER + 1);
}

/** The support window of `version`, relative to `now`. */
export function apiVersionStatus(version: string, now = new Date()): ApiVersionStatus {
  if (version === 'unstable') {
    return { version, ok: false, note: '"unstable" changes without notice: pin a dated version such as 2026-07' };
  }
  const parsed = parseVersion(version);
  if (!parsed) return { version, ok: false, note: 'not a quarterly version (YYYY-01, -04, -07 or -10)' };
  const released = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  const supportedUntil = new Date(Date.UTC(parsed.year, parsed.month - 1 + MONTHS_SUPPORTED, 1));
  const monthsLeft = (supportedUntil.getTime() - now.getTime()) / AVERAGE_MONTH_MS;
  const isReleased = released <= now;
  let note = `supported until about ${supportedUntil.toISOString().slice(0, 7)}`;
  if (!isReleased) note = 'not released yet (release candidate at best)';
  else if (monthsLeft <= 0) {
    note = 'no longer supported: Shopify falls back to the oldest supported version. Upgrade (see README)';
  } else if (monthsLeft < UPGRADE_WARNING_MONTHS) {
    note = `${note}: plan the upgrade to ${nextApiVersion(version)} or later (see README)`;
  }
  return {
    version,
    ok: isReleased && monthsLeft > 0,
    monthsLeft: Math.round(monthsLeft),
    next: nextApiVersion(version),
    note,
  };
}
