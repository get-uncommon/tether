// @ts-nocheck
/**
 * Shopify API versions are quarterly (YYYY-01, -04, -07, -10) and supported for 12 months.
 * Tether pins a dated version and never targets `unstable` (it changes without notice).
 */

const parse = (v) => {
  const m = /^(\d{4})-(01|04|07|10)$/.exec(String(v || ''));
  return m ? { y: +m[1], m: +m[2] } : null;
};
const fmt = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/** '2026-07' -> '2026-10', '2026-10' -> '2027-01'. */
export function nextApiVersion(v, steps = 1) {
  const p = parse(v);
  if (!p) throw new Error(`not a quarterly Shopify API version: ${v}`);
  const q = p.y * 4 + (p.m - 1) / 3 + steps;
  return fmt(Math.floor(q / 4), (q % 4) * 3 + 1);
}

/** Support window of a version, relative to `now`. */
export function apiVersionStatus(version, now = new Date()) {
  if (version === 'unstable')
    return { version, ok: false, note: '"unstable" changes without notice: pin a dated version such as 2026-07' };
  const p = parse(version);
  if (!p) return { version, ok: false, note: 'not a quarterly version (YYYY-01, -04, -07 or -10)' };
  const released = new Date(Date.UTC(p.y, p.m - 1, 1));
  const supportedUntil = new Date(Date.UTC(p.y + 1, p.m - 1, 1));
  const monthsLeft = (supportedUntil - now) / (30.44 * 24 * 3600 * 1000);
  let note = `supported until about ${supportedUntil.toISOString().slice(0, 7)}`;
  if (released > now) note = 'not released yet (release candidate at best)';
  else if (monthsLeft <= 0)
    note = 'no longer supported: Shopify falls back to the oldest supported version. Upgrade (see README)';
  else if (monthsLeft < 3) note = `${note}: plan the upgrade to ${nextApiVersion(version)} or later (see README)`;
  return {
    version,
    ok: released <= now && monthsLeft > 0,
    monthsLeft: Math.round(monthsLeft),
    next: nextApiVersion(version),
    note,
  };
}
