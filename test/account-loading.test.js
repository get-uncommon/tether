// Which pages load the account part: a login coming back, the hint of one, and never a config without the Worker.
// Its own file: the part finishes a login only on its first mount, so these tests need a part no other test has
// mounted.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { jsonResponse } from './fixtures.js';

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

const { configure } = await import('../src/config.ts');
const { mountAccountIfUsed } = await import('../src/account-api.ts');
// Loaded up front, so a part that loads when it shouldn't is seen within `QUIET_MS`.
await import('../src/account.ts');
const { forgetServerLogin } = await import('../src/account/server-client.ts');

/** How long a page that doesn't load the part is watched for it. */
const QUIET_MS = 200;
/** How long a page that loads the part may take to show it. */
const LOAD_MS = 2000;

// `debug`: the part's first mount logs.
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
      return jsonResponse({ loggedIn: false });
    };
    mountAccountIfUsed(document);
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

test('an account config without server warns once that accounts need the Worker, and loads nothing', async () => {
  const warned = [];
  const consoleWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    configure(testConfig({ clientId: 'client-1' }));
  } finally {
    console.warn = consoleWarn;
  }
  assert.deepEqual(warned, ['[tether] customer accounts need the Worker since 0.7.0: set account.server']);
  document.body.innerHTML = '<button tether-account-login>Log in</button>';
  localStorage.setItem('tether:account-hint:shop.test', '1');
  assert.equal(await partRanWithin('?account=in', QUIET_MS), false);
});

test('the Worker’s ?account= mark loads the part; a ?code= does not', async () => {
  configure(testConfig({ server: '/_tether/account' }));
  assert.equal(await partRanWithin('?code=SUMMER', QUIET_MS), false);
  assert.equal(await partRanWithin('?account=settings', QUIET_MS), false, 'not one of the login outcomes');
  assert.equal(await partRanWithin('?account=in', LOAD_MS), true);
});

test('the hint that a customer may be logged in loads the part on a page without account markup', async () => {
  configure(testConfig({ server: '/_tether/account' }));
  // The part is already mounted: without its kept answer, rendering asks the Worker again.
  forgetServerLogin();
  localStorage.setItem('tether:account-hint:shop.test', '1');
  assert.equal(await partRanWithin('', LOAD_MS), true);
});
