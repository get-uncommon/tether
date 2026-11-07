// The smoke test's retry of a step that fails on Shopify's side for a moment, on failures Tether's own client throws
// for answers an injected fetch gives, without the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, shaped } from '../src/client.ts';
import { resolveConfig } from '../src/config.ts';
import { isTransientShopifyFailure, requestIdOf, withRetries, RETRY_DELAYS_MS } from '../scripts/smoke-retry.ts';
import { jsonResponse } from './fixtures.js';

const INTERNAL_MESSAGE =
  'Internal error. Looks like something went wrong on our end.\nRequest ID: 9c1e74be-dec6-470c-8f95-414e68bf7cd0-1794012973 (include this in support requests).';
const MUTATION = 'mutation Tether_cartNoteUpdate($note: String!) { cartNoteUpdate(note: $note) { cart { id } } }';

/**
 * @param {() => Promise<Response>} answer What the store answers.
 * @param {'query' | 'mutation'} [operation]
 * @returns {Promise<unknown>} What Tether's client rejects with, for one attempt.
 */
async function failureFor(answer, operation = 'mutation') {
  const conf = { ...resolveConfig({ domain: 'shop.test', token: 't', maxAge: 0, retries: 0 }), fetch: answer };
  const isNote = shaped({ cartNoteUpdate: { cart: { id: 'string' } } });
  try {
    await request(conf, operation === 'mutation' ? MUTATION : '{ shop { name } }', {}, isNote, { operation });
  } catch (error) {
    return error;
  }
  throw new Error('the request did not fail');
}

test('a 5xx, no answer, and Shopify internal error are transient, with or without its code', async () => {
  const transient = {
    'a 502': await failureFor(async () => new Response('Bad gateway', { status: 502 })),
    'a 500 with GraphQL errors': await failureFor(async () => jsonResponse({ errors: [{ message: 'boom' }] }, 500)),
    'no answer': await failureFor(async () => {
      throw new TypeError('fetch failed');
    }),
    'an INTERNAL_SERVER_ERROR': await failureFor(async () =>
      jsonResponse({ errors: [{ message: INTERNAL_MESSAGE, extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }),
    ),
    'the internal error message alone': await failureFor(async () =>
      jsonResponse({ errors: [{ message: INTERNAL_MESSAGE }], data: { cartNoteUpdate: null } }),
    ),
    'a query refused with INTERNAL_SERVER_ERROR': await failureFor(
      async () => jsonResponse({ errors: [{ message: 'oops', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }),
      'query',
    ),
  };
  for (const [what, error] of Object.entries(transient)) assert.ok(isTransientShopifyFailure(error), what);
  assert.equal(requestIdOf(transient['an INTERNAL_SERVER_ERROR']), '9c1e74be-dec6-470c-8f95-414e68bf7cd0-1794012973');
  assert.equal(requestIdOf(transient['a 502']), null);
});

test('a 4xx, another GraphQL error, a refused mutation and a wrong shape are not transient', async () => {
  const lasting = {
    'a 401': await failureFor(async () => jsonResponse({ errors: [{ message: 'Unauthorized' }] }, 401)),
    'a 404': await failureFor(async () => new Response('Not found', { status: 404 })),
    'a field the API version removed': await failureFor(async () =>
      jsonResponse({
        errors: [{ message: "Field 'note' doesn't exist", extensions: { code: 'undefinedField' } }],
      }),
    ),
    'a query refused with a GraphQL error': await failureFor(
      async () => jsonResponse({ errors: [{ message: 'Parse error on "}"' }] }),
      'query',
    ),
    'an answer of the wrong shape': await failureFor(async () => jsonResponse({ data: { cartNoteUpdate: 'x' } })),
    "a step's own check": new Error('count 2'),
  };
  for (const [what, error] of Object.entries(lasting)) assert.ok(!isTransientShopifyFailure(error), what);
});

/** @returns Hooks that record the waits and the log lines instead of waiting. */
function recordingHooks() {
  /** @type {number[]} */
  const waits = [];
  /** @type {string[]} */
  const lines = [];
  return {
    waits,
    lines,
    hooks: {
      /** @param {number} ms */
      sleep: async (ms) => {
        waits.push(ms);
      },
      /** @param {string} line */
      log: (line) => {
        lines.push(line);
      },
    },
  };
}

test('a step that fails on Shopify side once runs again after a wait, and logs the request id', async () => {
  const internal = await failureFor(async () =>
    jsonResponse({ errors: [{ message: INTERNAL_MESSAGE, extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }),
  );
  const { waits, lines, hooks } = recordingHooks();
  let runs = 0;
  await withRetries(
    'note',
    () => {
      runs += 1;
      if (runs === 1) throw internal;
    },
    hooks,
  );
  assert.equal(runs, 2);
  assert.deepEqual(waits, [RETRY_DELAYS_MS[0]]);
  assert.deepEqual(lines, [
    '  ..  note: Shopify failed (request ID 9c1e74be-dec6-470c-8f95-414e68bf7cd0-1794012973), trying again in 1 s',
  ]);
});

test('a step fails after three attempts that all fail on Shopify side, waiting 1 s and then 3 s', async () => {
  const outage = await failureFor(async () => new Response('Service unavailable', { status: 503 }));
  const { waits, lines, hooks } = recordingHooks();
  let runs = 0;
  await assert.rejects(
    withRetries(
      'clear',
      () => {
        runs += 1;
        throw outage;
      },
      hooks,
    ),
    (error) => error === outage,
  );
  assert.equal(runs, 3);
  assert.deepEqual(waits, [1000, 3000]);
  assert.equal(lines.length, 2);
  assert.match(lines[1] ?? '', /clear: Shopify failed \(request ID none given\), trying again in 3 s/);
});

test('a step that fails for any other reason fails at once', async () => {
  const removed = await failureFor(async () =>
    jsonResponse({ errors: [{ message: "Field 'note' doesn't exist", extensions: { code: 'undefinedField' } }] }),
  );
  const { waits, hooks } = recordingHooks();
  let runs = 0;
  await assert.rejects(
    withRetries(
      'note',
      () => {
        runs += 1;
        throw removed;
      },
      hooks,
    ),
    (error) => error === removed,
  );
  assert.equal(runs, 1);
  assert.deepEqual(waits, []);
});

test('the retry ends at once when a step passes', async () => {
  const { waits, hooks } = recordingHooks();
  await withRetries('ok', async () => {}, hooks);
  assert.deepEqual(waits, []);
});
