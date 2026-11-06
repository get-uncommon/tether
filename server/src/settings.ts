/** Settings derived from the Worker's env that more than one module reads, parsed the same way everywhere. */

import type { CleanEnv } from './env.ts';

/** A static site rebuilds at most this often when DEPLOY_HOOK_MIN_SECONDS is not set. */
const DEFAULT_DEPLOY_HOOK_MIN_SECONDS = 60;

/**
 * The shortest time between two deploy hook builds, from DEPLOY_HOOK_MIN_SECONDS.
 *
 * @returns Seconds; {@link DEFAULT_DEPLOY_HOOK_MIN_SECONDS} when the setting is unset or not a number.
 */
export function deployHookMinSeconds(env: CleanEnv): number {
  const seconds = Number(env.DEPLOY_HOOK_MIN_SECONDS);
  return env.DEPLOY_HOOK_MIN_SECONDS === undefined || Number.isNaN(seconds) ? DEFAULT_DEPLOY_HOOK_MIN_SECONDS : seconds;
}
