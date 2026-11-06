// Which pages load the account part for a login coming back. Its own file: the part finishes a login only on its
// first mount, so these tests need a part no other test has mounted.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/account' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
});

const { configure } = await import('../src/config.js');
const { mountAccountIfUsed } = await import('../src/account-api.js');
// Loaded up front, so a part that loads when it shouldn't is seen within `QUIET_MS`.
await import('../src/account.js');

const PENDING_KEY = 'tether:account-login:shop.test';
/** How long a page that doesn't load the part is watched for it. */
const QUIET_MS = 200;
/** How long a page that loads the part may take to show it. */
const LOAD_MS = 2000;

// `debug`: the part's first mount logs, the one sign of it in browser mode without a session.
const testConfig = (account) => ({
  domain: 'shop.test',
  token: 't',
  autoMount: false,
  retries: 0,
  debug: true,
  account,
});

/**
 * Mounts the core's account check on a page with `search` as its query, and watches it for `waitMs`.
 *
 * @param {string} search
 * @param {number} waitMs
 * @returns {Promise<boolean>} True when the part ran: it logged its first mount, asked the Worker, or sent an account
 *   event.
 */
function partRanWithin(search, waitMs) {
  window.history.replaceState(null, '', `/account${search}`);
  return new Promise((resolve) => {
    const consoleLog = console.log;
    const finish = (ran) => {
      clearTimeout(timer);
      document.removeEventListener('tether:account-error', onEvent);
      console.log = consoleLog;
      resolve(ran);
    };
    console.log = (...args) => {
      if (args[1] === 'account') finish(true);
    };
    const onEvent = () => finish(true);
    const timer = setTimeout(() => finish(false), waitMs);
    document.addEventListener('tether:account-error', onEvent);
    globalThis.fetch = async () => {
      finish(true);
      return { ok: true, status: 200, json: async () => ({ loggedIn: false }) };
    };
    mountAccountIfUsed(document);
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

test('browser mode: a ?code= without this tab’s pending login does not load the part', async () => {
  configure(testConfig({ clientId: 'client-1' }));
  assert.equal(await partRanWithin('?code=SUMMER', QUIET_MS), false, 'a discount link');
  assert.equal(await partRanWithin('?code=abc&state=xyz', QUIET_MS), false, 'another site’s OAuth callback');
});

test('browser mode: a pending login without Shopify’s answer in the URL does not load the part', async () => {
  configure(testConfig({ clientId: 'client-1' }));
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state: 's-1' }));
  assert.equal(await partRanWithin('?code=SUMMER', QUIET_MS), false);
});

test('browser mode: Shopify’s answer to this tab’s login loads the part, which finishes the login', async () => {
  configure(testConfig({ clientId: 'client-1' }));
  const pending = { state: 's-1', nonce: 'n', verifier: 'v', redirect: 'https://site.test/account', returnTo: '' };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, at: Date.now() }));
  assert.equal(await partRanWithin('?error=access_denied&state=s-1', LOAD_MS), true);
  assert.equal(sessionStorage.getItem(PENDING_KEY), null, 'the login is finished');
});

test('server mode: the Worker’s ?account= mark loads the part; a ?code= does not', async () => {
  configure(testConfig({ server: '/_tether/account' }));
  assert.equal(await partRanWithin('?code=SUMMER', QUIET_MS), false);
  assert.equal(await partRanWithin('?account=settings', QUIET_MS), false, 'not one of the login outcomes');
  assert.equal(await partRanWithin('?account=in', LOAD_MS), true);
});
