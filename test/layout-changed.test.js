// tether:layout-changed after a burst of async renders, and the ScrollTrigger refresh or site hook before it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureTetherWarnings } from './fixtures.js';

const warnings = captureTetherWarnings();

const dom = new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  CustomEvent: dom.window.CustomEvent,
});
const { configure } = await import('../src/config.ts');
const { notifyLayoutChanged } = await import('../src/dom.ts');

/** @returns The reasons of the `tether:layout-changed` events the next burst sends. */
async function layoutChanges() {
  const reasons = [];
  const listener = (event) => reasons.push(event.detail.reason);
  document.addEventListener('tether:layout-changed', listener);
  notifyLayoutChanged('lines');
  notifyLayoutChanged('cart');
  await new Promise((resolve) => setTimeout(resolve, 200));
  document.removeEventListener('tether:layout-changed', listener);
  return reasons;
}

beforeEach(() => {
  configure({});
  Reflect.deleteProperty(window, 'ScrollTrigger');
  warnings.length = 0;
});

test('a burst of layout changes refreshes ScrollTrigger once, then emits once', async () => {
  const refreshed = [];
  class ScrollTrigger {
    static refresh() {
      refreshed.push(this);
    }
  }
  Reflect.set(window, 'ScrollTrigger', ScrollTrigger);
  assert.deepEqual(await layoutChanges(), ['cart']);
  assert.deepEqual(refreshed, [ScrollTrigger]);
});

test('a page ScrollTrigger without a refresh function is skipped and the event still goes out', async () => {
  for (const scrollTrigger of [{ refresh: 'yes' }, { refresh: null }, 'ScrollTrigger', class {}]) {
    Reflect.set(window, 'ScrollTrigger', scrollTrigger);
    assert.deepEqual(await layoutChanges(), ['cart']);
  }
  assert.deepEqual(warnings, []);
});

test('a site hook or refresh that throws is reported and the event still goes out', async () => {
  const errors = [];
  /** @param {unknown} error */
  const onError = (error, context) => errors.push([String(error), context]);
  const onLayoutChange = () => {
    throw new Error('hook broke');
  };
  configure({ onLayoutChange, onError });
  assert.deepEqual(await layoutChanges(), ['cart']);
  configure({ onError });
  Reflect.set(
    window,
    'ScrollTrigger',
    class {
      static refresh() {
        throw new Error('refresh broke');
      }
    },
  );
  assert.deepEqual(await layoutChanges(), ['cart']);
  assert.deepEqual(errors, [
    ['Error: hook broke', 'layout-changed'],
    ['Error: refresh broke', 'layout-changed'],
  ]);
});
