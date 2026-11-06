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
import type { TetherConfig } from '../config.js';
/**
 * `gsap`, `lenis` and `scrollTrigger` are getters, read each time they are used, so an instance made later is found.
 */
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
    onValueChange?: TetherConfig['onValueChange'];
    /** Animate cart lines in and out (default true). */
    animateLines?: boolean;
    /** Seconds. */
    lineDuration?: number;
}
/** The hooks the preset always sets, and `onValueChange` as passed (`null` when it isn't). */
type BarbaPresetConfig = {
    autoMount: false;
} & {
    [Hook in 'onLayoutChange' | 'onCartOpen' | 'onCartClose' | 'onLineEnter' | 'onLineLeave']: NonNullable<TetherConfig[Hook]>;
} & Pick<TetherConfig, 'onValueChange'>;
export type { BarbaPresetOptions, BarbaPresetConfig };
/**
 * Hooks for sites with page transitions, smooth scroll and GSAP: spread into `Tether.init()`.
 */
export declare function barbaPreset(options?: BarbaPresetOptions): BarbaPresetConfig;
/** @alias `barbaPreset`, for `import barbaPreset from '@occluze/tether/presets/barba'`. */
export default barbaPreset;
