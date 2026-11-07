// The updater's requests to GitHub against a local server that stalls, and its `gh attestation verify` against a
// command that never ends: each fails in time, with an error naming the URL or the command, which the updater's `main`
// reports as its `::error` annotation like any other failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchFromGitHub, runCommand, verifyAttestation } from '../scripts/release-asset.ts';
import { listenForFetch } from './mocks.js';

const TIMEOUT_MS = 100;

/**
 * @param {import('node:http').RequestListener} answer Takes each request and never ends its answer.
 * @returns {Promise<string>} The server's URL; the server is closed when the test ends.
 */
async function stallingServer(/** @type {import('node:test').TestContext} */ t, answer) {
  const server = createServer(answer);
  const port = await listenForFetch(server);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${String(port)}/`;
}

test('a request GitHub never answers fails within the timeout, naming its URL', async (t) => {
  const url = await stallingServer(t, () => {});
  await assert.rejects(
    fetchFromGitHub(url, {}, async (response) => response.text(), TIMEOUT_MS),
    {
      message: `${url}: no whole answer within 0.1 s`,
    },
  );
});

test('an answer whose body stalls fails within the timeout too', async (t) => {
  const url = await stallingServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('[');
  });
  await assert.rejects(
    fetchFromGitHub(url, {}, async (response) => response.text(), TIMEOUT_MS),
    {
      message: `${url}: no whole answer within 0.1 s`,
    },
  );
});

test('a command that never ends is stopped within the timeout, naming the command', () => {
  const args = ['-e', 'setTimeout(() => {}, 60_000)'];
  assert.throws(() => runCommand(process.execPath, args, TIMEOUT_MS), {
    message: `${[process.execPath, ...args].join(' ')}: no answer within 0.1 s, so it was stopped`,
  });
});

test('an attestation check that stalls fails the update instead of being taken as missing gh or a refusal', () => {
  const stalled = () => runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], TIMEOUT_MS);
  const release = { upstream: 'o/r', version: '0.7.1', sha: 'a'.repeat(40) };
  for (const policy of /** @type {const} */ (['require', 'allow-unverified'])) {
    assert.throws(() => verifyAttestation(stalled, 'a.tgz', release, policy), /no answer within 0\.1 s/);
  }
});
