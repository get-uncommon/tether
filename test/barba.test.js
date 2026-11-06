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
  assert.ok(preset.onCartOpen && preset.onCartClose);
  preset.onCartClose([]);
  const drawer = document.createElement('div');
  drawer.id = 'cart';
  preset.onCartOpen([drawer]);
  preset.onCartOpen([drawer]);
  preset.onCartClose([drawer]);
  assert.deepEqual(log, [['lock', 'cart'], ['unlock']]);
  assert.equal(preset.onValueChange, null);
});

test('barba preset: layout changes resize Lenis and refresh ScrollTrigger, as getters or values', () => {
  const log = [];
  /** @param {import('../src/presets/barba.ts').BarbaPresetOptions} options */
  const layoutChange = (options) => {
    const { onLayoutChange } = barbaPreset(options);
    assert.ok(onLayoutChange);
    onLayoutChange('x');
  };
  layoutChange({
    lenis: () => ({ resize: () => log.push('lenis') }),
    scrollTrigger: () => ({ refresh: () => log.push('st') }),
  });
  // @ts-expect-error -- the options are typed as getters, but the preset also takes the value itself
  layoutChange({ lenis: { resize: () => log.push('lenis value') }, scrollTrigger: () => null });
  layoutChange({ lenis: () => ({}) });
  assert.deepEqual(log, ['lenis', 'st', 'lenis value']);
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
  assert.ok(preset.onLineEnter && preset.onLineLeave);
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
  assert.ok(onLineLeave);
  onLineLeave(line, () => (done += 1));
  assert.equal(done, 3, 'something that is not GSAP is not called');
});
