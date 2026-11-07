// Option, plan and purchase elements that are buttons only by role are reached and pressed from the keyboard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cancelTimersAfterTests, find, jsonResponse, PLAN_2MONTH, product, pageGlobals } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

cancelTimersAfterTests();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://keys.test/' });
Object.assign(globalThis, pageGlobals(dom.window));
const realFetch = globalThis.fetch;
globalThis.fetch = async () => jsonResponse({ data: { cart: null } });

/** @type {typeof import('../src/index.ts').default} */
let Tether;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false });
});
after(() => {
  globalThis.fetch = realFetch;
});

/**
 * @param {Element} el
 * @param {string} key
 * @returns {boolean} Whether the key's default action was prevented.
 */
const press = (el, key) =>
  !el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

const option = (/** @type {string} */ value) => find(`[tether-option-value="${value}"]`);

test('an option, plan or purchase made a button by role is in the Tab order and pressed with Enter and Space', async () => {
  Tether.primeProduct(product);
  document.body.innerHTML = `<div tether-product="${product.handle}">
    <div tether-option-list="Size"><div></div></div>
    <div tether-plan-list><a href="#plan"></a></div>
    <div id="once" tether-purchase="one-time" tabindex="-1"></div>
    <button id="native" tether-purchase="subscription"></button>
  </div>`;
  Tether.mount(document);
  await waitFor(() => find('[tether-product]').getAttribute('tether-state') === 'ready', 'the product to be ready');
  const scope = Tether.getScope(find('[tether-product]'));
  assert.ok(scope);
  let clicks = 0;
  scope.root.addEventListener('click', () => {
    clicks += 1;
  });

  assert.equal(option('1kg').getAttribute('role'), 'button');
  assert.equal(option('1kg').getAttribute('tabindex'), '0', 'a div option is in the Tab order');
  assert.equal(find('#once').getAttribute('tabindex'), '-1', "the site's own tabindex stays");
  assert.equal(find('#native').hasAttribute('tabindex'), false);

  assert.equal(press(option('1kg'), 'Enter'), true);
  assert.equal(scope.selected['Size'], '1kg');
  assert.equal(press(option('250g'), ' '), true);
  assert.equal(scope.selected['Size'], '250g');
  assert.equal(press(option('1kg'), 'a'), false, 'another key does nothing');
  assert.equal(scope.selected['Size'], '250g');
  assert.equal(clicks, 2);

  const planLink = find(`[tether-plan-value="${PLAN_2MONTH}"]`);
  assert.equal(press(planLink, 'Enter'), false, 'a link clicks itself on Enter');
  assert.equal(clicks, 2);
  assert.equal(press(planLink, ' '), true, 'Space presses a link button');
  assert.equal(scope.plan?.id, PLAN_2MONTH);
  assert.equal(press(find('#once'), 'Enter'), true);
  assert.equal(scope.purchase.kind, 'one-time');
  assert.equal(press(find('#native'), 'Enter'), false, 'a native button clicks itself');
  assert.equal(scope.purchase.kind, 'one-time');
  assert.equal(clicks, 4);
});
