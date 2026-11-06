// The Node webhook server (tether-sync serve): limits before authentication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { serve } from '../src/node.js';

const quiet = { info() {}, warn() {}, error() {} };
const app = {
  sync: {},
  webhookSecrets: ['x'.repeat(32)],
  config: { shopify: { domain: 'shop.myshopify.com' } },
  store: null,
};
const raw = (port, text, { abortAfter } = {}) =>
  new Promise((resolve) => {
    const s = connect(port, '127.0.0.1', () => {
      s.write(text);
      if (abortAfter)
        setTimeout(() => {
          s.destroy();
          resolve('');
        }, abortAfter);
    });
    let out = '';
    s.on('data', (d) => {
      out += d;
    });
    s.on('end', () => resolve(out));
    s.on('error', () => resolve(out));
  });

test('serve: an aborted upload, a huge body and unknown paths do not crash or buffer', async () => {
  const server = await serve(app, { port: 0, host: '127.0.0.1', log: quiet, maxBody: 1024 });
  const { port } = server.address();
  try {
    // Client sends half a body and disconnects: the process keeps running.
    await raw(port, 'POST /webhooks/shopify HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n0123456789', {
      abortAfter: 100,
    });
    await new Promise((r) => setTimeout(r, 100));
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
