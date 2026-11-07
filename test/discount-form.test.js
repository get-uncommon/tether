// The discount code form: a code Shopify takes is applied and the input cleared, a refused one marks the form.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cancelTimersAfterTests,
  cartFrom,
  detailOf,
  find,
  graphqlRequest,
  jsonResponse,
  operationName,
  pageGlobals,
  product,
} from './fixtures.js';
import { asString, listAt, stringAt, waitFor } from '../server/test/mocks.js';

cancelTimersAfterTests();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, pageGlobals(dom.window));
localStorage.setItem('tether:cart:shop.test', 'gid://shopify/Cart/abc');
const cart = cartFrom([{ merchandiseId: product.variants.nodes[0]?.id ?? '', quantity: 1 }]);
const ACCEPTED = 'SAVE10';

/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  if (operationName(query) === 'TetherCart') return jsonResponse({ data: { cart } });
  const codes = listAt(variables, 'discountCodes').map((code, i) => asString(code, `discountCodes[${i}]`));
  const discountCodes = codes.map((code) => ({ code, applicable: code === ACCEPTED }));
  return jsonResponse({ data: { cartDiscountCodesUpdate: { cart: { ...cart, discountCodes }, userErrors: [] } } });
};

before(async () => {
  const { default: Tether } = await import('../src/index.ts');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false });
});

/**
 * @param {string} code
 * @returns {Promise<{ name: string, code: string }>} The event the form emitted.
 */
async function submit(code) {
  document.body.innerHTML = '<form tether-discount-form><input tether-discount-input></form>';
  /** @type {{ name: string, code: string }[]} */
  const events = [];
  for (const name of ['tether:discount-applied', 'tether:discount-invalid']) {
    document.addEventListener(name, (event) => events.push({ name, code: stringAt(detailOf(event), 'code') }), {
      once: true,
    });
  }
  const input = /** @type {HTMLInputElement} */ (find('input'));
  input.value = code;
  find('form').dispatchEvent(new window.SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => events.length > 0, 'the discount form to answer');
  const [event] = events;
  assert.ok(event);
  return event;
}

test('a code Shopify takes is applied and the input cleared', async () => {
  assert.deepEqual(await submit(` ${ACCEPTED} `), { name: 'tether:discount-applied', code: ACCEPTED });
  assert.equal(/** @type {HTMLInputElement} */ (find('input')).value, '');
  assert.equal(find('form').classList.contains('is-invalid'), false);
});

test('a refused code marks the form invalid until the visitor types again', async () => {
  assert.deepEqual(await submit('NOPE'), { name: 'tether:discount-invalid', code: 'NOPE' });
  assert.equal(find('form').classList.contains('is-invalid'), true);
  assert.equal(find('input').getAttribute('aria-invalid'), 'true');
  find('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(find('form').classList.contains('is-invalid'), false);
  assert.equal(find('input').hasAttribute('aria-invalid'), false);
});
