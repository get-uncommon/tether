import type { TetherConfig } from './index.js';

type Serializable<T> = {
  [
    K in keyof T as T[K] extends ((...args: any[]) => any) | null | undefined
      ? Exclude<T[K], null | undefined> extends (...args: any[]) => any
        ? never
        : K
      : K
  ]: T[K];
};

export interface TetherAstroOptions extends Partial<Serializable<TetherConfig>> {
  /** Add the Tether script to every page (default true). False: import and init it yourself. */
  inject?: boolean;
  /** Files that restart the dev server when they change (default: src/shop.config.js/.mjs/.ts). */
  watch?: string[];
}

/**
 * Astro integration: Tether on every page, store and token from .env
 * (PUBLIC_SHOPIFY_DOMAIN, PUBLIC_SHOPIFY_STOREFRONT_TOKEN). Functions (onError, hooks) go in
 * window.TETHER_CONFIG in your layout.
 */
export default function tether(options?: TetherAstroOptions): {
  name: string;
  hooks: Record<string, (...args: any[]) => unknown>;
};
