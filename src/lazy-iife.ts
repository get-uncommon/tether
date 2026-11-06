/**
 * `<script>` build: the optional parts are separate files next to tether(.min).js (tether.markets.min.js), loaded on
 * first use and checked against the hashes the core was built with, from that folder or from `partsUrl`, which must
 * serve the files of the same release. A part registers itself in `window.Tether.__parts` and uses the core modules in
 * `window.Tether.__core` instead of bundling copies.
 */
import { cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn } from './config.ts';
import { endpoint, gql, orNull, shaped, TetherError } from './client.ts';
import {
  ANALYTICS_EVENTS,
  attr,
  attributesFromJson,
  emit,
  formatDate,
  formatMoney,
  get,
  has,
  hasTemplate,
  isOwnEvent,
  parseJSONAttr,
  productUrl,
  qsa,
  repeat,
  sel,
  setImage,
  setText,
  show,
} from './dom.ts';
import { clearProductCache, getProduct } from './loader.ts';
import { allPlans } from './selling-plans.ts';
import { boundary, resolveProductKey } from './status.ts';
import { Cart } from './cart.ts';
import { scopes } from './product.ts';
import { listSelector } from './collection.ts';
import { liveLists, liveProducts, mountedProducts, mountProduct, pruneLive, within } from './mounting.ts';
import { toCountry, toLanguage } from './market-codes.ts';
import { isHttpsUrl } from './shopify-values.ts';
import { PART_INTEGRITY } from './part-integrity.ts';
import type { Parts, PartName, TetherInternals } from './lazy.ts';

/**
 * The core exports the parts use, shared instead of bundled twice, by the file name scripts/build.ts maps a part's
 * imports to. Each file shares a list of values without their names: the build finds each value's export name in its
 * module and hands a part's import of that name the value at its position. The core so carries no export names and no
 * export a part doesn't use, and a part that imports one not listed here fails its build. A part reads its entries
 * when it loads, once every module has run; read while the core runs, an import cycle through this file could leave
 * a value unset.
 */
export const coreModules = {
  get 'config.ts'() {
    return [cfg, isConfigured, log, MARKET_SOURCES, parseMarkets, reportError, warn];
  },
  get 'client.ts'() {
    return [endpoint, gql, orNull, shaped, TetherError];
  },
  get 'dom.ts'() {
    return [
      ANALYTICS_EVENTS,
      attr,
      attributesFromJson,
      emit,
      formatDate,
      formatMoney,
      get,
      has,
      hasTemplate,
      isOwnEvent,
      parseJSONAttr,
      productUrl,
      qsa,
      repeat,
      sel,
      setImage,
      setText,
      show,
    ];
  },
  get 'loader.ts'() {
    return [clearProductCache, getProduct];
  },
  get 'selling-plans.ts'() {
    return [allPlans];
  },
  get 'status.ts'() {
    return [boundary, resolveProductKey];
  },
  get 'cart.ts'() {
    return [Cart];
  },
  get 'product.ts'() {
    return [scopes];
  },
  get 'collection.ts'() {
    return [listSelector];
  },
  get 'mounting.ts'() {
    return [liveLists, liveProducts, mountedProducts, mountProduct, pruneLive, within];
  },
  get 'market-codes.ts'() {
    return [toCountry, toLanguage];
  },
  get 'shopify-values.ts'() {
    return [isHttpsUrl];
  },
  // Parts that load other parts (account → account-pages) use this same loader.
  get 'lazy.ts'() {
    return [loadPart];
  },
};

const MINIFIED_SCRIPT = /\.min\.js(\?|$)/;
const coreScript = typeof document === 'undefined' ? '' : (document.currentScript?.getAttribute('src') ?? '');
const coreScriptUrl = coreScript ? new URL(coreScript, document.baseURI).href : '';

/** Parts loaded or loading. */
const parts = new Map<PartName, Promise<unknown>>();

/**
 * The folder parts load from: the `partsUrl` (checked to be https or on this site when the config was resolved), else
 * the core script's own folder. `null` when the core was not loaded by a `<script src>` (a module, a loader) and no
 * `partsUrl` is set, so nothing says where parts are.
 */
function partsFolder(): string | null {
  if (cfg.partsUrl) return new URL(cfg.partsUrl, document.baseURI).href;
  if (!coreScriptUrl) return null;
  return coreScriptUrl.replace(/[^/]*$/, '');
}

/**
 * Pins the script to the part file built with this core, wherever it loads from: a page that pins the core with
 * `integrity` then runs only parts of that build, and a `partsUrl` must serve the same release's files.
 */
function applyIntegrity(script: HTMLScriptElement, integrity: string): void {
  script.integrity = integrity;
  // A cross-origin script is only checked when fetched with CORS (CDNs such as jsDelivr allow it).
  if (new URL(script.src).origin !== window.location.origin) script.crossOrigin = 'anonymous';
}

/**
 * Loads a part's file. A failed load leaves the cache, so the next use tries again (the network may be back).
 *
 * @param integrity The file's hash from this core's build.
 */
function loadScript(name: PartName, folder: string, file: string, integrity: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = `${folder.replace(/\/?$/, '/')}${file}`;
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    applyIntegrity(script, integrity);
    script.onload = () => {
      const { Tether } = window as { Tether?: TetherInternals };
      const part = Tether?.__parts[name];
      if (part) {
        resolve(part);
        return;
      }
      parts.delete(name);
      reject(new Error(`${url} did not register`));
    };
    script.onerror = () => {
      parts.delete(name);
      reject(
        new Error(
          `Could not load ${url}, or it is not the file built with this Tether script. Host the same release's files ` +
            'next to the Tether script or at partsUrl.',
        ),
      );
    };
    document.head.appendChild(script);
  });
}

/**
 * @throws {Error} (rejected) When the part's file can't be loaded, fails its integrity check or doesn't register.
 */
export function loadPart<Name extends PartName>(name: Name): Promise<Parts[Name]> {
  let loading = parts.get(name);
  if (!loading) {
    const folder = partsFolder();
    if (folder === null) {
      return Promise.reject(
        new Error(`The Tether script's own location is unknown, so its ${name} part can't be found: set partsUrl.`),
      );
    }
    const suffix = MINIFIED_SCRIPT.test(coreScriptUrl) || !coreScriptUrl ? '.min' : '';
    const file = `tether.${name}${suffix}.js`;
    const integrity = PART_INTEGRITY[file];
    if (integrity === undefined) {
      return Promise.reject(new Error(`This Tether script was built without ${file}, so it can't load that part.`));
    }
    loading = loadScript(name, folder, file, integrity);
    parts.set(name, loading);
  }
  // A part's file is built from the module `Parts[Name]` names (scripts/build.ts), and registers that module.
  return loading as Promise<Parts[Name]>;
}
