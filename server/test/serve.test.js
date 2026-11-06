// The Node webhook server (tether-sync serve): limits before authentication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { serve } from '../src/node.ts';
import { waitFor } from './mocks.js';

const quiet = { info() {}, warn() {}, error() {} };
const neverSyncs = () => Promise.reject(new Error('no webhook here is signed'));
/** @type {Parameters<typeof serve>[0]} */
const app = {
  sync: { syncById: neverSyncs, queueRetry: neverSyncs },
  webhookSecrets: ['x'.repeat(32)],
  config: { shopify: { domain: 'shop.myshopify.com' } },
  store: null,
};
/**
 * @param {number} port
 * @param {string} text
 * @param {{ abortWhen?: () => Promise<void> }} [options] `abortWhen` settles when the client is to disconnect.
 * @returns {Promise<string>}
 */
const raw = (port, text, { abortWhen } = {}) =>
  new Promise((resolve) => {
    const s = connect(port, '127.0.0.1', () => {
      s.write(text);
      if (abortWhen)
        void abortWhen().then(() => {
          s.destroy();
          resolve('');
        });
    });
    let out = '';
    s.on('data', (d) => {
      out += d;
    });
    s.on('end', () => resolve(out));
    s.on('error', () => resolve(out));
  });

/**
 * The server's side of each connection it accepts, so a test can wait for what the server has read.
 *
 * @param {import('node:net').Server} server
 */
function serverSockets(server) {
  /** @type {import('node:net').Socket[]} */
  const sockets = [];
  server.on('connection', (socket) => sockets.push(socket));
  return sockets;
}

/** @param {import('node:net').Server} server Listening on TCP, so its address is an AddressInfo. */
function listening(server) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address;
}

test('serve: an aborted upload, a huge body and unknown paths do not crash or buffer', async () => {
  const server = await serve(app, { port: 0, host: '127.0.0.1', log: quiet, maxBody: 1024 });
  const { port } = listening(server);
  const sockets = serverSockets(server);
  try {
    // Client sends half a body and disconnects: the process keeps running.
    const halfUpload = 'POST /webhooks/shopify HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n0123456789';
    await raw(port, halfUpload, {
      abortWhen: () => waitFor(() => sockets[0]?.bytesRead === halfUpload.length, 'the server to read the half upload'),
    });
    await waitFor(() => sockets[0]?.destroyed === true, 'the server to close the aborted upload');
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    // Too large: refused before it is read.
    const big = await raw(
      port,
      'POST /webhooks/shopify HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 999999\r\n\r\n',
    );
    assert.match(big, /^HTTP\/1\.1 413/);
    // Unknown path: answered without reading the body.
    const other = await raw(
      port,
      'POST /nope HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 500000\r\n\r\nabc',
    );
    assert.match(other, /^HTTP\/1\.1 404/);
    // A webhook with a bad signature still gets its normal answer.
    const bad = await fetch(`http://127.0.0.1:${port}/webhooks/shopify`, {
      method: 'POST',
      body: '{}',
      headers: { 'x-shopify-hmac-sha256': 'nope' },
    });
    assert.equal(bad.status, 401);
  } finally {
    server.close();
  }
});

test('serve logs the address it really listens on', async () => {
  const lines = [];
  const log = { ...quiet, info: (line) => lines.push(line) };
  const local = await serve(app, { port: 0, host: '127.0.0.1', log });
  const everywhere = await serve(app, { port: 0, log });
  try {
    assert.equal(lines[0], `tether-sync listening on http://127.0.0.1:${listening(local).port}/webhooks/shopify`);
    assert.match(
      lines[1],
      /^tether-sync listening on every interface \((::|0\.0\.0\.0)\), e\.g\. http:\/\/localhost:\d+\//,
    );
  } finally {
    local.close();
    everywhere.close();
  }
});
