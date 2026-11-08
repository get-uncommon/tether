/**
 * Prints the Shopify API version Tether pins, or the next quarterly one.
 *   node scripts/api-version.ts          # 2026-07
 *   node scripts/api-version.ts --next   # 2026-10
 * Used by the weekly smoke workflow (.github/workflows/smoke.yml).
 */
import { DEFAULTS } from '../src/config.ts';
import { nextApiVersion } from '../src/api-version.ts';

const pinned = DEFAULTS.apiVersion;
console.log(process.argv.includes('--next') ? nextApiVersion(pinned) : pinned);
