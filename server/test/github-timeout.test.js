// The updater's requests to GitHub against a local server that stalls: each fails in time, with an error naming the
// URL, which the updater's `main` reports as its `::error` annotation like any other failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchFromGitHub } from '../scripts/release-asset.ts';
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
