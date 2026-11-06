/**
 * Preset for sites with page transitions (Barba, Swup), smooth scroll (Lenis) and GSAP. Nothing is read from globals
 * except GSAP and ScrollTrigger by default: pass in what your site has.
 *
 *   import Tether from "@occluze/tether";
 *   import { barbaPreset } from "@occluze/tether/presets/barba";
 *
 *   Tether.init({
 *     ...window.TETHER_CONFIG,
 *     ...barbaPreset({
 *       lenis: () => myLenis,                      // resized after async renders
 *       lockScroll: (drawer) => myLock.lock(drawer),  // when the cart opens
 *       unlockScroll: () => myLock.unlock(),       // when the cart closes
 *       onValueChange: (el, previous) => {},       // e.g. a text scramble
 *     }),
 *   });
 *
 *   // once per page container, e.g. in Barba's beforeEnter AND once():
 *   Tether.mount(container);
 *   // when leaving a page:
 *   Tether.unmount();
 */
import type { TetherConfig } from '../config.ts';

// GSAP isn't a dependency, so the two calls this preset makes are described here.
type TweenVars = Record<string, string | number | (() => void)>;
interface Gsap {
  fromTo: (target: HTMLElement, from: TweenVars, to: TweenVars) => unknown;
  to: (target: HTMLElement, to: TweenVars) => unknown;
}

/** Each getter may also be the value itself. */
interface BarbaPresetOptions {
  /** Default `window.gsap`. */
  gsap?: () => unknown;
  /** Resized after async renders. */
  lenis?: (() => unknown) | null;
  /** Default `window.ScrollTrigger`, refreshed after async renders. */
  scrollTrigger?: () => unknown;
  /** When the cart opens. */
  lockScroll?: ((drawer: HTMLElement) => void) | null;
  /** When the cart closes. */
  unlockScroll?: (() => void) | null;
  /** After a cart line animated in or out. */
  onResize?: (() => void) | null;
  onValueChange?: ((el: HTMLElement, previousText: string) => void) | null;
  /** Animate cart lines in and out (default true). */
  animateLines?: boolean;
  /** Seconds. */
  lineDuration?: number;
}

type BarbaPresetConfig = Pick<
  TetherConfig,
  'autoMount' | 'onLayoutChange' | 'onCartOpen' | 'onCartClose' | 'onLineEnter' | 'onLineLeave' | 'onValueChange'
>;

export type { BarbaPresetOptions, BarbaPresetConfig };

const LINE_DURATION_SECONDS = 0.3;
/** @returns A new object each time: GSAP writes into the vars it is given. */
const collapsed = (): TweenVars => ({
  height: 0,
  paddingTop: 0,
  paddingBottom: 0,
  borderBottomWidth: 0,
  opacity: 0,
  overflow: 'hidden',
});
const ANIMATED_PROPS = 'height,paddingTop,paddingBottom,borderBottomWidth,opacity,overflow';

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @returns What a getter option returns, or the option itself when it is the value. */
function current(option: unknown): unknown {
  if (typeof option !== 'function') return option;
  // Every function option of this preset is a getter that takes no arguments.
  const getter = option as () => unknown;
  return getter();
}

/**
 * Calls `target[method]()` when it has one: Lenis and ScrollTrigger are optional and versions differ.
 */
function callIfPresent(target: unknown, method: string) {
  if (typeof target !== 'object' || target === null) return;
  const fn: unknown = Reflect.get(target, method);
  // A method of `target`, called on it.
  if (typeof fn === 'function') (fn as (this: unknown) => unknown).call(target);
}

const isGsap = (value: unknown): value is Gsap =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'fromTo') === 'function' &&
  typeof Reflect.get(value, 'to') === 'function';

/**
 * Hooks for sites with page transitions, smooth scroll and GSAP: spread into `Tether.init()`.
 */
export function barbaPreset(options: BarbaPresetOptions = {}): BarbaPresetConfig {
  const {
    gsap = (): unknown => Reflect.get(window, 'gsap'),
    lenis = null,
    scrollTrigger = (): unknown => Reflect.get(window, 'ScrollTrigger'),
    lockScroll = null,
    unlockScroll = null,
    onResize = null,
    onValueChange = null,
    animateLines = true,
    lineDuration = LINE_DURATION_SECONDS,
  } = options;

  /** Whether this preset holds the scroll lock, so a modal's own lock stays intact. */
  let locked = false;

  /** @returns GSAP, when this line should animate. */
  const animator = (node: HTMLElement): Gsap | null => {
    if (!animateLines || reducedMotion() || node.offsetHeight <= 0) return null;
    const animation = current(gsap);
    return isGsap(animation) ? animation : null;
  };

  return {
    autoMount: false,

    onLayoutChange() {
      callIfPresent(current(lenis), 'resize');
      callIfPresent(current(scrollTrigger), 'refresh');
    },

    onCartOpen(drawers) {
      const drawer = drawers[0];
      if (locked || typeof lockScroll !== 'function' || !drawer) return;
      lockScroll(drawer);
      locked = true;
    },

    onCartClose() {
      if (locked && typeof unlockScroll === 'function') unlockScroll();
      locked = false;
    },

    onLineEnter(node) {
      const animation = animator(node);
      if (!animation) return;
      const style = getComputedStyle(node);
      animation.fromTo(node, collapsed(), {
        height: node.offsetHeight,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        borderBottomWidth: style.borderBottomWidth,
        opacity: 1,
        duration: lineDuration,
        clearProps: ANIMATED_PROPS,
        onComplete: () => onResize?.(),
      });
    },

    onLineLeave(node, done) {
      const animation = animator(node);
      if (!animation) {
        done();
        return;
      }
      animation.to(node, {
        ...collapsed(),
        duration: lineDuration,
        onComplete: () => {
          done();
          onResize?.();
        },
      });
    },

    onValueChange: typeof onValueChange === 'function' ? onValueChange : null,
  };
}

export default barbaPreset;
