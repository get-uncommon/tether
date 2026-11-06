// The update workflow the sync Worker ships. These tests read the shipped file, so they live outside server/: a
// deployed copy runs server/test/ against its own workflow, which is the one it was made with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHIPPED_REVISION,
  WORKFLOW_PATH,
  workflowRevision,
  workflowRevisionAt,
  workflowState,
} from '../server/scripts/workflow-check.ts';

const SERVER = fileURLToPath(new URL('../server/', import.meta.url));
const shipped = () => readFile(join(SERVER, WORKFLOW_PATH), 'utf8');

/**
 * The shipped workflow's hash. A copy keeps the workflow it was made with, because an Action's token can't change a
 * workflow file, so every version of the updater keeps the contract that all shipped workflows rely on (the test
 * below). The hash makes a change to the workflow a deliberate one; a change that copies need also raises its
 * `# Tether workflow revision:` line, so the updater tells them to copy it in.
 */
const WORKFLOW_HASH = '4041071f6dee';

test('the shipped workflow changes only on purpose', async () => {
  const hash = createHash('sha256').update(await shipped());
  assert.equal(hash.digest('hex').slice(0, 12), WORKFLOW_HASH);
});

test('the workflow keeps to the contract: the script path, the updated= line, test/ and src/entry.js', async () => {
  const workflow = await shipped();
  for (const command of [
    'node scripts/update-tether.mjs | tee update.log',
    `grep '^updated=' update.log | tail -1 | cut -d= -f2`,
    'node --test test/*.test.js',
    "import('./src/entry.js')",
  ]) {
    assert.ok(workflow.includes(command), command);
  }
});

test('the updater knows the revision of the workflow it ships with', async () => {
  assert.equal(workflowRevision(await shipped()), SHIPPED_REVISION);
});

test('a copy made before 0.7.0 runs an outdated workflow and is told to copy the shipped one in', async () => {
  const fixture = await readFile(new URL('workflows/update-tether-v0.6.8.yml', import.meta.url), 'utf8');
  const copy = await mkdtemp(join(tmpdir(), 'tether-v068-'));
  await mkdir(join(copy, '.github', 'workflows'), { recursive: true });
  await writeFile(join(copy, WORKFLOW_PATH), fixture);
  assert.deepEqual(await workflowState(copy, await workflowRevisionAt(SERVER)), {
    kind: 'outdated',
    copy: 1,
    release: SHIPPED_REVISION,
  });
});
