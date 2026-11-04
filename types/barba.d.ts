import type { TetherConfig } from './index.js';

export interface BarbaPresetOptions {
  gsap?: () => unknown;
  lenis?: (() => { resize?(): void; stop?(): void; start?(): void } | null | undefined) | null;
  scrollTrigger?: () => unknown;
  lockScroll?: ((drawer: HTMLElement) => void) | null;
  unlockScroll?: (() => void) | null;
  onResize?: (() => void) | null;
  onValueChange?: ((el: HTMLElement, previousText: string) => void) | null;
  animateLines?: boolean;
  lineDuration?: number;
}

/** Hooks for sites with page transitions, smooth scroll and GSAP: spread into Tether.init(). */
export declare function barbaPreset(options?: BarbaPresetOptions): Partial<TetherConfig>;
