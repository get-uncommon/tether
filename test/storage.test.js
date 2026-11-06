import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

const { getStored, setStored, removeStored } = await import('../src/storage.ts');
const { forgetBrowserModeTokens } = await import('../src/account-marks.ts');
const { showLastKnownCount } = await import('../src/cart/store.ts');
const { configure } = await import('../src/config.ts');

configure({ domain: 'shop.test', token: 't' });

/**
 * Makes one storage area throw on access, as a browser that blocks site data does.
 *
 * @param {'localStorage' | 'sessionStorage'} area
 * @returns {() => void} Unblocks the area.
 */
function block(area) {
  const descriptor = Object.getOwnPropertyDescriptor(dom.window, area);
  Object.defineProperty(dom.window, area, {
    configurable: true,
    get() {
      throw new dom.window.DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(dom.window, area, descriptor);
    else Reflect.deleteProperty(dom.window, area);
  };
}

beforeEach(() => {
  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
});

test('reads, writes and removes in the area asked for, localStorage by default', () => {
  setStored('key', 'local');
  setStored('key', 'session', 'sessionStorage');
  assert.equal(getStored('key'), 'local');
  assert.equal(getStored('key', 'sessionStorage'), 'session');
  removeStored('key', 'sessionStorage');
  assert.equal(getStored('key', 'sessionStorage'), null);
  assert.equal(getStored('key'), 'local');
  removeStored('key');
  assert.equal(getStored('key'), null);
});

test('blocked storage reads as empty, and writes and removals do nothing', () => {
  const unblock = block('localStorage');
  try {
    assert.equal(getStored('key'), null);
    setStored('key', 'value');
    removeStored('key');
  } finally {
    unblock();
  }
  assert.equal(getStored('key'), null);
});

test('full storage keeps nothing, without throwing', () => {
  const { setItem } = dom.window.Storage.prototype;
  dom.window.Storage.prototype.setItem = () => {
    throw new dom.window.DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
  try {
    setStored('key', 'value');
  } finally {
    dom.window.Storage.prototype.setItem = setItem;
  }
  assert.equal(getStored('key'), null);
});

test("a blocked sessionStorage doesn't keep 0.6's tokens in localStorage", () => {
  dom.window.localStorage.setItem('tether:account:shop.test', '{"refresh":"r"}');
  dom.window.localStorage.setItem('tether:account-login:shop.test', '{"verifier":"v"}');
  const unblock = block('sessionStorage');
  try {
    forgetBrowserModeTokens();
  } finally {
    unblock();
  }
  assert.equal(dom.window.localStorage.length, 0);
});

test('the last page’s cart count is shown only when it is a whole number', () => {
  /** @type {[stored: string, shown: string][]} */
  const cases = [
    ['1700000000000|3', '3'],
    ['1700000000000|0', '0'],
    ['1700000000000|NaN', ''],
    ['1700000000000|99999 items', ''],
    ['1700000000000|-1', ''],
    ['1700000000000|2.5', ''],
    ['1700000000000|1e3', ''],
    ['1700000000000|', ''],
    ['1700000000000|99999999999999999999', ''],
    ['no separator', ''],
  ];
  for (const [stored, shown] of cases) {
    document.body.innerHTML = '<span tether-cart-count></span>';
    dom.window.localStorage.setItem('tether:cart:shop.test:seen', stored);
    showLastKnownCount();
    assert.equal(document.querySelector('[tether-cart-count]')?.textContent, shown, stored);
  }
});
