// The account settings: what accounts need before they answer, and what /check reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAccount } from '../src/account.ts';
import { SHOP, env, shopify, req, configured, answer } from './account-fixtures.js';
import { jsonOf, stringAt } from './mocks.js';

test('settings: not set up -> 404; missing pieces -> 503 without details for the public', async () => {
  assert.equal((await answer(req('/me'), {}, {})).status, 404);
  const response = await answer(req('/me'), { ACCOUNT_CLIENT_ID: 'x', SHOPIFY_DOMAIN: SHOP }, {});
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /ACCOUNT_ORIGINS|SYNC_SECRET/);
  assert.equal(await handleAccount(new Request('https://x/other'), env, {}), null, 'other routes pass through');
});

test('settings: ACCOUNT_SECRET is required, with no fallback to SYNC_SECRET; /check says what to set', async () => {
  const { accountProblems } = await import('../src/account.ts');
  const { ACCOUNT_SECRET, ...withoutSecret } = env;
  const syncOnly = { ...withoutSecret, SYNC_SECRET: 'a-long-sync-secret-of-24-plus-chars' };
  assert.deepEqual(configured(syncOnly).secret, { kind: 'missing' }, 'SYNC_SECRET is never a session key');
  const [problem] = accountProblems(configured(syncOnly));
  assert.ok(problem);
  assert.equal(problem.severity, 'error');
  assert.match(problem.message, /ACCOUNT_SECRET is not set/);
  assert.match(problem.fix ?? '', /ACCOUNT_SECRET, a random string of at least 24 characters/);
  assert.match(problem.fix ?? '', /logs every customer out once/);

  /** @type {string[]} */
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const response = await answer(req('/me'), syncOnly, { memory: new Map() });
    assert.equal(response.status, 503);
    const error = stringAt(await jsonOf(response), 'error');
    assert.match(error, /Worker secret ACCOUNT_SECRET/, 'the one setting a Worker set up before 0.7.0 lacks is named');
    assert.doesNotMatch(error, /SYNC_SECRET|shop\.example|myshopify/);
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((line) => line.includes('account setup ACCOUNT_SECRET is not set')));

  for (const unusable of ['choose-a-long-random-string', 'a']) {
    const settings = configured({ ...env, ACCOUNT_SECRET: unusable });
    assert.deepEqual(settings.secret, { kind: 'missing' }, `${unusable}: an example or a short value is no key`);
  }
  assert.deepEqual(configured(env).secret, { kind: 'set', value: ACCOUNT_SECRET });
  assert.deepEqual(accountProblems(configured(env)), []);
});

test('settings: an ACCOUNT_SECRET equal to SYNC_SECRET is refused, so the /check password opens no session', async () => {
  const { accountProblems } = await import('../src/account.ts');
  const shared = { ...env, SYNC_SECRET: env.ACCOUNT_SECRET };
  assert.deepEqual(configured(shared).secret, { kind: 'same-as-sync-secret' });
  const [problem, ...others] = accountProblems(configured(shared));
  assert.ok(problem);
  assert.deepEqual(others, []);
  assert.equal(problem.severity, 'error');
  assert.match(problem.message, /ACCOUNT_SECRET is the same as SYNC_SECRET/);
  assert.match(problem.fix ?? '', /different from SYNC_SECRET/);

  const realError = console.error;
  console.error = () => {};
  try {
    const response = await answer(req('/me'), shared, { memory: new Map() });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'accounts are not set up (see /check)' });
  } finally {
    console.error = realError;
  }
});

test('settings: unusable ACCOUNT_SESSION_DAYS and SHOPIFY_DOMAIN are reported, not silently replaced', async () => {
  const { accountProblems } = await import('../src/account.ts');
  /** @param {Record<string, string>} overrides */
  const problems = (overrides) => accountProblems(configured({ ...env, ...overrides }));
  /** @type {[string, number][]} */
  const sessionDays = [
    ['0', 1],
    ['abc', 14],
    ['200', 90],
    ['7.5', 14],
  ];
  for (const [raw, days] of sessionDays) {
    const settings = configured({ ...env, ACCOUNT_SESSION_DAYS: raw });
    assert.equal(settings.sessionDays.days, days, raw);
    assert.ok(
      problems({ ACCOUNT_SESSION_DAYS: raw }).some(
        (problem) => problem.severity === 'warning' && problem.message.includes(raw),
      ),
    );
  }
  assert.deepEqual(configured({ ...env, ACCOUNT_SESSION_DAYS: '30' }).sessionDays, { kind: 'as-set', days: 30 });
  for (const domain of ['shop.myshopify.com/admin', 'shop .myshopify.com', 'shop.myshopify.com?x=1']) {
    assert.ok(
      problems({ SHOPIFY_DOMAIN: domain }).some(
        (problem) => problem.severity === 'error' && problem.message.includes('SHOPIFY_DOMAIN'),
      ),
      domain,
    );
  }
  assert.ok(
    !problems({ SHOPIFY_DOMAIN: 'https://shop.myshopify.com/' }).some((problem) =>
      problem.message.includes('SHOPIFY_DOMAIN'),
    ),
  );
});

test('without the TETHER_SYNC namespace the Worker refuses accounts instead of keeping sessions in memory', async () => {
  /** @type {string[]} */
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const response = await answer(req('/login'), env, { fetch: shopify().fetch });
    assert.equal(response.status, 503);
    const notNamespace = await answer(req('/login'), { ...env, TETHER_SYNC: 'a-string' }, {});
    assert.equal(notNamespace.status, 503, 'a setting by that name that is no namespace is not one');
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((line) => line.includes('TETHER_SYNC KV namespace is not bound')));
});

test('settings: ACCOUNT_ORIGINS entries are compared the way the browser writes its Origin header', async () => {
  const { accountProblems } = await import('../src/account.ts');
  const written = 'https://Shop.Example:443/, https://other.example';
  const settings = configured({ ...env, ACCOUNT_ORIGINS: written });
  assert.deepEqual(settings.origins, ['https://shop.example', 'https://other.example']);
  assert.deepEqual(accountProblems(settings), []);
  const me = await answer(
    req('/me', { origin: 'https://shop.example' }),
    { ...env, ACCOUNT_ORIGINS: written },
    {
      memory: new Map(),
    },
  );
  assert.equal(me.headers.get('access-control-allow-origin'), 'https://shop.example');
});

test('settings: an ACCOUNT_ORIGINS entry that is not an https origin alone is an error that names it', async () => {
  const { accountProblems } = await import('../src/account.ts');
  for (const entry of [
    'https://user@shop.example',
    'https://shop.example/shop',
    'http://shop.example',
    'shop.example',
  ]) {
    const settings = configured({ ...env, ACCOUNT_ORIGINS: `https://shop.example ${entry}` });
    const errors = accountProblems(settings).filter((problem) => problem.severity === 'error');
    assert.equal(errors.length, 1, entry);
    assert.ok(errors[0]?.message.startsWith('ACCOUNT_ORIGINS must be https origins'), entry);
    assert.ok(errors[0]?.message.endsWith(`not ${entry}`), entry);
    const refused = await answer(
      req('/me', { origin: 'https://shop.example' }),
      { ...env, ACCOUNT_ORIGINS: entry },
      {
        memory: new Map(),
      },
    );
    assert.equal(refused.status, 503, entry);
  }
});
