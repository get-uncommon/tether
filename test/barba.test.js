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
const { barbaPreset } = await import('../src/presets/barba.js');

test('barba preset: no auto-mount, the scroll lock it took is the one it releases', () => {
  const log = [];
  const preset = barbaPreset({
    lockScroll: (drawer) => log.push(['lock', drawer.id]),
    unlockScroll: () => log.push(['unlock']),
  });
  assert.equal(preset.autoMount, false);
  preset.onCartClose();
  const drawer = document.createElement('div');
  drawer.id = 'cart';
  preset.onCartOpen([drawer]);
  preset.onCartOpen([drawer]);
  preset.onCartClose();
  assert.deepEqual(log, [['lock', 'cart'], ['unlock']]);
  assert.equal(preset.onValueChange, null);
});

test('barba preset: layout changes resize Lenis and refresh ScrollTrigger, as getters or values', () => {
  const log = [];
  barbaPreset({
    lenis: () => ({ resize: () => log.push('lenis') }),
    scrollTrigger: () => ({ refresh: () => log.push('st') }),
  }).onLayoutChange('x');
  barbaPreset({ lenis: { resize: () => log.push('lenis value') }, scrollTrigger: () => null }).onLayoutChange('x');
  barbaPreset({ lenis: () => ({}) }).onLayoutChange('x');
  assert.deepEqual(log, ['lenis', 'st', 'lenis value']);
});

test('barba preset: lines animate with GSAP when they have a height; otherwise leave at once', () => {
  const tweens = [];
  const gsap = {
    fromTo: (node, from, to) => tweens.push(['fromTo', from.height, to.duration]),
    to: (node, to) => {
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
  barbaPreset({ gsap: () => ({}), animateLines: true }).onLineLeave(line, () => (done += 1));
  assert.equal(done, 3, 'something that is not GSAP is not called');
});
