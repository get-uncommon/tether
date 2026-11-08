/** Settings derived from the Worker's env that more than one module reads, parsed the same way everywhere. */

import type { CleanEnv } from './env.ts';

/** The env settings that hold a whole number. */
const NUMBER_SETTING_NAMES = ['DEPLOY_HOOK_MIN_SECONDS', 'MAX_SUBREQUESTS'] as const;
type NumberSettingName = (typeof NUMBER_SETTING_NAMES)[number];

interface NumberRange {
  min: number;
  max: number;
  /** Used when the setting is unset or outside the range. */
  fallback: number;
}

const NUMBER_SETTINGS: Readonly<Record<NumberSettingName, NumberRange>> = {
  // Longer than a day, a product change would wait more than a day to reach a statically built site.
  DEPLOY_HOOK_MIN_SECONDS: { min: 0, max: 86_400, fallback: 60 },
  // Cloudflare's free plan allows 50 subrequests per invocation, so the default leaves headroom. A paid plan can be
  // configured up to 10 million.
  MAX_SUBREQUESTS: { min: 1, max: 10_000_000, fallback: 45 },
};

const WHOLE_NUMBER = /^\d+$/;

/** A whole-number setting that is set but unusable, for `/check`. */
export interface InvalidNumberSetting {
  key: NumberSettingName;
  /** As written. */
  raw: string;
  min: number;
  max: number;
  /** What the Worker uses instead. */
  fallback: number;
}

function inRange(raw: string, { min, max }: NumberRange): boolean {
  if (!WHOLE_NUMBER.test(raw)) return false;
  const value = Number(raw);
  return value >= min && value <= max;
}

/** The setting as a whole number within its range, else its fallback. */
function numberSetting(env: CleanEnv, key: NumberSettingName): number {
  const raw = env[key];
  const range = NUMBER_SETTINGS[key];
  return raw !== undefined && inRange(raw, range) ? Number(raw) : range.fallback;
}

/** The shortest time between two deploy hook builds, in seconds, from DEPLOY_HOOK_MIN_SECONDS. */
export function deployHookMinSeconds(env: CleanEnv): number {
  return numberSetting(env, 'DEPLOY_HOOK_MIN_SECONDS');
}

/** How many subrequests one invocation may make, from MAX_SUBREQUESTS. */
export function maxSubrequests(env: CleanEnv): number {
  return numberSetting(env, 'MAX_SUBREQUESTS');
}

/** The whole-number settings that are set to something other than a whole number within their range. */
export function invalidNumberSettings(env: CleanEnv): InvalidNumberSetting[] {
  const invalid: InvalidNumberSetting[] = [];
  for (const key of NUMBER_SETTING_NAMES) {
    const raw = env[key];
    const range = NUMBER_SETTINGS[key];
    if (raw !== undefined && !inRange(raw, range)) invalid.push({ key, raw, ...range });
  }
  return invalid;
}
