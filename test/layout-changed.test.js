// tether:layout-changed after a burst of async renders, and the ScrollTrigger refresh or site hook before it.
import { test, beforeEach, afterEach, mock } from 'node:test';
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

/** The debounce in src/dom.ts. */
const LAYOUT_DEBOUNCE_MS = 120;

/** What happened, in order: `refresh`, `hook:<reason>`, `event:<reason>`. */
const happened = [];
const recordEvent = (event) => happened.push(`event:${event.detail.reason}`);

/** @returns What the next burst of two changes made happen, once the debounce has passed and not before. */
function layoutChanges() {
  happened.length = 0;
  notifyLayoutChanged('lines');
  notifyLayoutChanged('cart');
  mock.timers.tick(LAYOUT_DEBOUNCE_MS - 1);
  assert.deepEqual(happened, [], 'nothing within the debounce');
  mock.timers.tick(1);
  return [...happened];
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  document.addEventListener('tether:layout-changed', recordEvent);
  configure({});
  Reflect.deleteProperty(window, 'ScrollTrigger');
  warnings.length = 0;
});

afterEach(() => {
  document.removeEventListener('tether:layout-changed', recordEvent);
  mock.timers.reset();
});

test('a burst of layout changes refreshes ScrollTrigger once, then emits once', () => {
  Reflect.set(
    window,
    'ScrollTrigger',
    class {
      static refresh() {
        happened.push('refresh');
      }
    },
  );
  assert.deepEqual(layoutChanges(), ['refresh', 'event:cart']);
});

test('a site hook runs instead of the ScrollTrigger refresh, before the event', () => {
  Reflect.set(
    window,
    'ScrollTrigger',
    class {
      static refresh() {
        happened.push('refresh');
      }
    },
  );
  configure({ onLayoutChange: (reason) => happened.push(`hook:${reason}`) });
  assert.deepEqual(layoutChanges(), ['hook:cart', 'event:cart']);
});

test('a page ScrollTrigger without a refresh function is skipped and the event still goes out', () => {
  for (const scrollTrigger of [{ refresh: 'yes' }, { refresh: null }, 'ScrollTrigger', class {}]) {
    Reflect.set(window, 'ScrollTrigger', scrollTrigger);
    assert.deepEqual(layoutChanges(), ['event:cart']);
  }
  assert.deepEqual(warnings, []);
});

test('a site hook or refresh that throws is reported and the event still goes out', () => {
  const errors = [];
  /** @param {unknown} error */
  const onError = (error, context) => errors.push([String(error), context]);
  const onLayoutChange = () => {
    throw new Error('hook broke');
  };
  configure({ onLayoutChange, onError });
  assert.deepEqual(layoutChanges(), ['event:cart']);
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
  assert.deepEqual(layoutChanges(), ['event:cart']);
  assert.deepEqual(errors, [
    ['Error: hook broke', 'layout-changed'],
    ['Error: refresh broke', 'layout-changed'],
  ]);
});
