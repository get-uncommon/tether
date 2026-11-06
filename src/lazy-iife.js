/**
 * `<script>` build: the optional parts are separate files next to tether(.min).js (tether.markets.min.js), loaded on
 * first use. `partsUrl` sets another folder. A part registers itself in `window.Tether.__parts` and uses the core
 * modules in `window.Tether.__core` instead of bundling copies of them.
 */
import * as config from './config.js';
import * as client from './client.js';
import * as dom from './dom.js';
import * as fragments from './fragments.js';
import * as loader from './loader.js';
import * as sellingPlans from './selling-plans.js';
import * as status from './status.js';
import * as cart from './cart.js';
import * as product from './product.js';
import * as collection from './collection.js';
import * as mounting from './mounting.js';
import * as marketCodes from './market-codes.js';
import * as shopifyValues from './shopify-values.js';
import * as storeHtml from './store-html.js';
/** @import { Parts, PartName } from './lazy.js' */

const { cfg } = config;

/**
 * The modules a part may use, shared instead of bundled twice (scripts/build.mjs maps a part's imports to these).
 *
 * @type {Record<string, object>}
 */
export const coreModules = {
  'config.js': config,
  'client.js': client,
  'dom.js': dom,
  'fragments.js': fragments,
  'loader.js': loader,
  'selling-plans.js': sellingPlans,
  'status.js': status,
  'cart.js': cart,
  'product.js': product,
  'collection.js': collection,
  'mounting.js': mounting,
  'market-codes.js': marketCodes,
  'shopify-values.js': shopifyValues,
  'store-html.js': storeHtml,
};

const MINIFIED_SCRIPT = /\.min\.js(\?|$)/;
const coreScript = typeof document === 'undefined' ? '' : (document.currentScript?.getAttribute('src') ?? '');
const coreScriptUrl = coreScript ? new URL(coreScript, document.baseURI).href : '';

/** @type {Map<PartName, Promise<unknown>>} Parts loaded or loading. */
const parts = new Map();

/**
 * The folder parts load from: `partsUrl`, else the core script's own folder. A `partsUrl` must be https or on this
 * site, because the parts run with the same access as the core (the account part holds customer sessions).
 *
 * @throws {Error} For a `partsUrl` that is neither.
 */
function partsFolder() {
  if (!cfg.partsUrl) return coreScriptUrl.replace(/[^/]*$/, '');
  const folder = new URL(cfg.partsUrl, document.baseURI);
  if (folder.protocol !== 'https:' && folder.origin !== window.location.origin) {
    throw new Error(`partsUrl must be https or on this site: ${folder.href}`);
  }
  return folder.href;
}

/**
 * @param {PartName} name
 * @param {string} url
 * @returns {Promise<unknown>}
 */
function loadScript(name, url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      const { Tether } = /** @type {Window & { Tether?: { __parts?: Record<string, unknown> } }} */ (window);
      const part = Tether?.__parts?.[name];
      if (part) resolve(part);
      else reject(new Error(`${url} did not register`));
    };
    script.onerror = () => {
      parts.delete(name);
      reject(new Error(`Could not load ${url}. Host it next to the Tether script, or set partsUrl.`));
    };
    document.head.appendChild(script);
  });
}

/**
 * @template {PartName} Name
 * @param {Name} name
 * @returns {Promise<Parts[Name]>}
 * @throws {Error} (rejected) When the part's file can't be loaded or doesn't register.
 */
export function loadPart(name) {
  let loading = parts.get(name);
  if (!loading) {
    let folder;
    try {
      folder = partsFolder();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const suffix = MINIFIED_SCRIPT.test(coreScriptUrl) || !coreScriptUrl ? '.min' : '';
    loading = loadScript(name, `${folder.replace(/\/?$/, '/')}tether.${name}${suffix}.js`);
    parts.set(name, loading);
  }
  // A part's file is built from the module `Parts[Name]` names (scripts/build.mjs), and registers that module.
  return /** @type {Promise<Parts[Name]>} */ (loading);
}

// Parts that load other parts (account → account-pages) use this same loader.
coreModules['lazy.js'] = { loadPart, coreModules };
