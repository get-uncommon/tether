// The Barba preset: scroll lock, layout refresh and GSAP line animations, from what the site passes in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  getComputedStyle: dom.window.getComputedStyle,
});
const { barbaPreset } = await import('../src/presets/barba.ts');

test('barba preset: no auto-mount, the scroll lock it took is the one it releases', () => {
  const log = [];
  const preset = barbaPreset({
    lockScroll: (drawer) => log.push(['lock', drawer.id]),
    unlockScroll: () => log.push(['unlock']),
  });
  assert.equal(preset.autoMount, false);
  preset.onCartClose([]);
  const drawer = document.createElement('div');
  drawer.id = 'cart';
  preset.onCartOpen([drawer]);
  preset.onCartOpen([drawer]);
  preset.onCartClose([drawer]);
  assert.deepEqual(log, [['lock', 'cart'], ['unlock']]);
  assert.equal(preset.onValueChange, null);
});

test('barba preset: layout changes resize Lenis and refresh ScrollTrigger, an instance or the class', () => {
  const log = [];
  /** @param {import('../src/presets/barba.ts').BarbaPresetOptions} options */
  const layoutChange = (options) => barbaPreset(options).onLayoutChange('x');
  class ScrollTrigger {
    static refresh() {
      log.push('st class');
    }
  }
  layoutChange({
    lenis: () => ({ resize: () => log.push('lenis') }),
    scrollTrigger: () => ({ refresh: () => log.push('st') }),
  });
  layoutChange({ scrollTrigger: () => ScrollTrigger });
  layoutChange({ lenis: () => ({}), scrollTrigger: () => null });
  assert.deepEqual(log, ['lenis', 'st', 'st class']);
});

test('barba preset: a value where a getter belongs is refused when the preset is made', () => {
  for (const name of ['gsap', 'lenis', 'scrollTrigger']) {
    assert.throws(() => barbaPreset({ [name]: {} }), {
      name: 'TypeError',
      message: `barbaPreset: ${name} must be a function that returns it, such as () => ${name}`,
    });
  }
  assert.doesNotThrow(() => barbaPreset({ lenis: null }));
});

test('barba preset: lines animate with GSAP when they have a height; otherwise leave at once', () => {
  const tweens = [];
  const gsap = {
    fromTo: (_node, from, to) => tweens.push(['fromTo', from.height, to.duration]),
    to: (_node, to) => {
      tweens.push(['to', to.height]);
      to.onComplete();
    },
  };
  let resized = 0;
  const preset = barbaPreset({ gsap: () => gsap, onResize: () => (resized += 1), lineDuration: 0.5 });
  const line = document.createElement('div');
  let done = 0;
  preset.onLineLeave(line, () => (done += 1));
  assert.deepEqual(tweens, [], 'jsdom lays nothing out: offsetHeight is 0');
  assert.equal(done, 1);
  Object.defineProperty(line, 'offsetHeight', { value: 40 });
  preset.onLineEnter(line);
  preset.onLineLeave(line, () => (done += 1));
  assert.deepEqual(tweens, [
    ['fromTo', 0, 0.5],
    ['to', 0],
  ]);
  assert.equal(done, 2);
  assert.equal(resized, 1);
  const { onLineLeave } = barbaPreset({ gsap: () => ({}), animateLines: true });
  onLineLeave(line, () => (done += 1));
  assert.equal(done, 3, 'something that is not GSAP is not called');
});
