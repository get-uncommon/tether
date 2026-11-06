// The language and country of Shopify's login page, which the browser puts on the Worker's login link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, shopify, req, location, answer } from './account-fixtures.js';

/**
 * The parameters of Shopify's login page for a login link with `query`, and what the Worker warned.
 *
 * @param {string} query
 */
async function authorizeFor(query) {
  const sh = shopify();
  /** @type {string[]} */
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    const start = await answer(req(`/login?${query}`), env, { fetch: sh.fetch, memory: new Map() });
    const { searchParams } = new URL(location(start));
    return { locale: searchParams.get('locale'), country: searchParams.get('region_country'), warned };
  } finally {
    console.warn = realWarn;
  }
}

test('login: a language and country are passed on as Shopify takes them', async () => {
  assert.deepEqual(await authorizeFor('locale=nl&country=nl'), { locale: 'nl', country: 'NL', warned: [] });
  assert.deepEqual(await authorizeFor('locale=pt-BR&country=BR'), { locale: 'pt-BR', country: 'BR', warned: [] });
  assert.deepEqual(await authorizeFor('locale=de-DE'), { locale: 'de', country: null, warned: [] });
});

test('login: a value that is not a code is left out with a warning, not repaired', async () => {
  const { locale, country, warned } = await authorizeFor('locale=n1&country=U1S');
  assert.equal(locale, null);
  assert.equal(country, null);
  assert.deepEqual(warned, [
    'account login: ignored locale "n1", not a code',
    'account login: ignored country "U1S", not a code',
  ]);
  assert.equal((await authorizeFor('country=us-x')).country, null);
  assert.equal((await authorizeFor('country=XX')).country, null, "Cloudflare's unknown country");
});

test('login: without a language or country, Shopify chooses, and nothing is logged', async () => {
  assert.deepEqual(await authorizeFor('locale=&returnTo=x'), { locale: null, country: null, warned: [] });
});
