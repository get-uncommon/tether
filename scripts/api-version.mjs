/**
 * Prints the Shopify API version Tether pins, or the next quarterly one.
 *   node scripts/api-version.mjs          # 2026-07
 *   node scripts/api-version.mjs --next   # 2026-10
 * Used by the weekly smoke workflow (.github/workflows/smoke.yml).
 */
import { DEFAULTS } from '../src/config.js';
import { nextApiVersion } from '../src/api-version.js';

const v = DEFAULTS.apiVersion;
console.log(process.argv.includes('--next') ? nextApiVersion(v) : v);
