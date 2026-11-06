/**
 * Shopify API versions are quarterly (YYYY-01, -04, -07, -10) and supported for 12 months. Tether pins a dated version
 * and never targets `unstable` (it changes without notice). Used by the config, the diagnose part and the release
 * scripts.
 */
import type { ApiVersion } from '../server/src/shared/api-versions.js';
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
/** @returns True for a dated version such as `2026-07`. */
export declare const isQuarterlyVersion: (version: unknown) => version is ApiVersion;
/**
 * `'2026-07'` → `'2026-10'`, `'2026-10'` → `'2027-01'`.
 *
 * @param steps Quarters ahead.
 * @throws {Error} When `version` isn't a quarterly version.
 */
export declare function nextApiVersion(version: string, steps?: number): string;
/** The support window of `version`, relative to `now`. */
export declare function apiVersionStatus(version: string, now?: Date): ApiVersionStatus;
