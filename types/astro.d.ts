import type { TetherConfig } from './index.js';

type Serializable<T> = {
  [
    K in keyof T as T[K] extends ((...args: never[]) => unknown) | null | undefined
      ? Exclude<T[K], null | undefined> extends (...args: never[]) => unknown
        ? never
        : K
      : K
  ]: T[K];
};

export interface TetherAstroOptions extends Partial<Serializable<TetherConfig>> {
  /** Add the Tether script to every page (default true). False: import and init it yourself. */
  inject?: boolean;
  /** Files that restart the dev server when they change (default: src/shop.config.js/.mjs/.ts). */
  watch?: string[] | null;
}

/**
 * Astro integration: Tether on every page, store and token from .env
 * (PUBLIC_SHOPIFY_DOMAIN, PUBLIC_SHOPIFY_STOREFRONT_TOKEN). Functions (onError, hooks) go in
 * window.TETHER_CONFIG in your layout.
 */
export default function tether(options?: TetherAstroOptions): {
  name: string;
  // Astro isn't a dependency, so its hook argument types aren't known here; `any` lets Astro pass them in.
  hooks: Record<string, (...args: any[]) => unknown>;
};
