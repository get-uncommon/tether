// The release's last step: locking the Astro starter once the release is pushed, which never fails the release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StarterNotReady, lockStarterAfterRelease, withStarterRange } from '../scripts/release-starter.ts';

const LOCK_LATER = 'To lock it: npm run release -- 0.10.0 --starter --push';

/**
 * Steps that record what ran and what was logged.
 *
 * @param {{ published?: () => Promise<boolean>, lock?: () => Promise<void> }} steps
 */
function recorded({ published = async () => true, lock = async () => {} }) {
  /** @type {string[]} */
  const lines = [];
  let locked = 0;
  /** @type {import('../scripts/release-starter.ts').StarterSteps} */
  const starterSteps = {
    waitForNpm: published,
    lockStarter: async () => {
      locked++;
      await lock();
    },
    log: (line) => lines.push(line),
  };
  return { starterSteps, lines, locked: () => locked };
}

test('once npm has the release, the starter is locked and nothing more is said', async () => {
  const { starterSteps, lines, locked } = recorded({});
  await lockStarterAfterRelease('0.10.0', starterSteps);
  assert.equal(locked(), 1);
  assert.deepEqual(lines, []);
});

test('when npm still lacks the release after the wait, it says how to lock the starter later', async () => {
  const { starterSteps, lines, locked } = recorded({ published: async () => false });
  await lockStarterAfterRelease('0.10.0', starterSteps);
  assert.equal(locked(), 0);
  assert.deepEqual(lines, ["npm doesn't have 0.10.0 yet. Once it has: npm run release -- 0.10.0 --starter --push"]);
});

test('any failure after the push, a registry or git error included, ends as a success with the command to run', async () => {
  const failures = [
    { published: async () => Promise.reject(new Error('Command failed: npm view @occluze/tether versions --json')) },
    { lock: async () => Promise.reject(new Error('Command failed: git fetch --quiet origin main\n')) },
    { lock: async () => Promise.reject(new StarterNotReady('main is on 0.11.0, so its starter stays on that minor')) },
    { lock: async () => Promise.reject(new Error('Command failed: npm update @occluze/tether')) },
  ];
  for (const failure of failures) {
    const { starterSteps, lines } = recorded(failure);
    await assert.doesNotReject(lockStarterAfterRelease('0.10.0', starterSteps));
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? '', /^The release of 0\.10\.0 is done, but the starter isn't locked on it: \S/);
    assert.equal(lines[1], LOCK_LATER);
  }
});

test("the starter's Tether range is set, and one written another way is an error, never taken as already right", () => {
  const json = '{\n  "dependencies": {\n    "@occluze/tether": "^0.9.0"\n  }\n}\n';
  assert.equal(withStarterRange(json, '^0.10.0'), json.replace('^0.9.0', '^0.10.0'));
  assert.equal(withStarterRange(json, '^0.9.0'), json, 'a patch release leaves the range as it is');
  for (const other of ['{"dependencies":{"@occluze/tether":"^0.9.0"}}', '{\n  "dependencies": {}\n}\n']) {
    assert.throws(() => withStarterRange(other, '^0.10.0'), StarterNotReady);
  }
});
