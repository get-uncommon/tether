/**
 * The Astro starter's lock on a release, shared by `release.ts --push`, which runs it after the release's own push, and
 * `release.ts --starter`, which runs it alone.
 */

export const NPM_PACKAGE = '@occluze/tether';
const STARTER_RANGE = /"@occluze\/tether": "[^"]*"/;

/** Why the Astro starter can't be locked on a version now. */
export class StarterNotReady extends Error {}

/**
 * @param json The starter's package.json.
 * @param range The range Tether's dependency gets, `^X.Y.0`.
 * @throws {StarterNotReady} When `json` has no `"@occluze/tether": "…"` dependency to set, so that a range written
 *   another way is never taken for one already right.
 */
export function withStarterRange(json: string, range: string): string {
  if (!STARTER_RANGE.test(json)) {
    throw new StarterNotReady(`the starter's package.json has no "${NPM_PACKAGE}": "<range>" dependency to set`);
  }
  return json.replace(STARTER_RANGE, `"${NPM_PACKAGE}": "${range}"`);
}

/** What the release does after its push, as parameters so the decision around them is testable. */
export interface StarterSteps {
  /** @returns Whether npm had the version within the release's wait. */
  waitForNpm: () => Promise<boolean>;
  /** Locks the starter on the version, on top of main as GitHub has it by then, and pushes that. */
  lockStarter: () => Promise<void>;
  log: (line: string) => void;
}

/**
 * Locks the starter on a release that is already tagged and pushed. Whatever fails here, a registry or network error
 * included, the release is published, so this logs what happened and the command that locks the starter later, and
 * never throws: the release ends as a success.
 */
export async function lockStarterAfterRelease(version: string, steps: StarterSteps): Promise<void> {
  const lockLater = `npm run release -- ${version} --starter --push`;
  try {
    if (!(await steps.waitForNpm())) {
      steps.log(`npm doesn't have ${version} yet. Once it has: ${lockLater}`);
      return;
    }
    await steps.lockStarter();
  } catch (error) {
    const reason = error instanceof Error ? error.message.trim() : String(error);
    steps.log(`The release of ${version} is done, but the starter isn't locked on it: ${reason}`);
    steps.log(`To lock it: ${lockLater}`);
  }
}
