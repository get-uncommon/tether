/**
 * `<script>` build: the optional parts are separate files next to tether(.min).js (tether.markets.min.js), loaded on
 * first use and checked against the hashes the core was built with, from that folder or from `partsUrl`, which must
 * serve the files of the same release. A part registers itself in `window.Tether.__parts` and uses the core modules in
 * `window.Tether.__core` instead of bundling copies.
 */
import * as config from './config.ts';
import * as client from './client.ts';
import * as dom from './dom.ts';
import * as fragments from './fragments.ts';
import * as loader from './loader.ts';
import * as sellingPlans from './selling-plans.ts';
import * as status from './status.ts';
import * as cart from './cart.ts';
import * as product from './product.ts';
import * as collection from './collection.ts';
import * as mounting from './mounting.ts';
import * as marketCodes from './market-codes.ts';
import * as shopifyValues from './shopify-values.ts';
import * as storeHtml from './store-html.ts';
import { PART_INTEGRITY } from './part-integrity.ts';
import type { Parts, PartName } from './lazy.ts';

const { cfg } = config;

/** The modules a part may use, by the file name scripts/build.ts maps a part's imports to. */
interface CoreModules {
  'config.ts': typeof config;
  'client.ts': typeof client;
  'dom.ts': typeof dom;
  'fragments.ts': typeof fragments;
  'loader.ts': typeof loader;
  'selling-plans.ts': typeof sellingPlans;
  'status.ts': typeof status;
  'cart.ts': typeof cart;
  'product.ts': typeof product;
  'collection.ts': typeof collection;
  'mounting.ts': typeof mounting;
  'market-codes.ts': typeof marketCodes;
  'shopify-values.ts': typeof shopifyValues;
  'store-html.ts': typeof storeHtml;
  'lazy.ts': { loadPart: typeof loadPart; coreModules: CoreModules };
}

/** The modules a part may use, shared instead of bundled twice. */
export const coreModules: CoreModules = {
  'config.ts': config,
  'client.ts': client,
  'dom.ts': dom,
  'fragments.ts': fragments,
  'loader.ts': loader,
  'selling-plans.ts': sellingPlans,
  'status.ts': status,
  'cart.ts': cart,
  'product.ts': product,
  'collection.ts': collection,
  'mounting.ts': mounting,
  'market-codes.ts': marketCodes,
  'shopify-values.ts': shopifyValues,
  'store-html.ts': storeHtml,
  // Parts that load other parts (account → account-pages) use this same loader.
  get 'lazy.ts'() {
    return { loadPart, coreModules };
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
      const { Tether } = window as { Tether?: { __parts?: Record<string, unknown> } };
      const part = Tether?.__parts?.[name];
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
