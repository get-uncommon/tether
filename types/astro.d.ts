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

/** Astro's `astro:config:setup` argument, as far as the integration reads it (astro isn't a dependency). */
export interface AstroConfigSetup {
  injectScript(stage: 'head-inline' | 'page', content: string): void;
  /** `dev`, `build`, `preview` or `sync`. */
  command: string;
  config: { root?: URL };
  logger: { warn(message: string): void };
  /** Astro 4.0+. */
  addWatchFile?: (path: string) => void;
  /**
   * Astro 4.0+; takes a partial Astro config. A method, so Astro's own `DeepPartial<AstroConfig>` parameter fits the
   * env schema the integration passes.
   */
  updateConfig?(config: { env?: { schema?: Record<string, unknown> } }): unknown;
}

/**
 * Astro integration: Tether on every page, store and token from .env
 * (PUBLIC_SHOPIFY_DOMAIN, PUBLIC_SHOPIFY_STOREFRONT_TOKEN). Functions (onError, hooks) go in
 * window.TETHER_CONFIG in your layout.
 */
export default function tether(options?: TetherAstroOptions): {
  name: string;
  hooks: { 'astro:config:setup': (setup: AstroConfigSetup) => Promise<void> };
};
