/**
 * `<script>` build: the optional parts are separate files next to tether(.min).js (tether.markets.min.js), loaded on
 * first use and checked against the hashes the core was built with. `partsUrl` sets another folder. A part registers
 * itself in `window.Tether.__parts` and uses the core modules in `window.Tether.__core` instead of bundling copies.
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
import { PART_INTEGRITY } from './part-integrity.js';
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

/**
 * Where parts load from. Beside the core they are the files it was built with, so each is checked against its hash
 * (`PART_INTEGRITY`): a page that pins the core with `integrity` runs only parts of that build. A `partsUrl` is the
 * site's own copy, possibly of another version, so its files load unchecked.
 *
 * @typedef {{ kind: 'beside-core', folder: string } | { kind: 'parts-url', folder: string }} PartsSource
 */

/** @type {Map<PartName, Promise<unknown>>} Parts loaded or loading. */
const parts = new Map();

/**
 * A `partsUrl` must be https or on this site. That keeps parts off plain http (mixed content, rewritable on the way);
 * it doesn't vouch for the host, which the site chose.
 *
 * @returns {PartsSource}
 * @throws {Error} For a `partsUrl` that is neither.
 */
function partsSource() {
  if (!cfg.partsUrl) return { kind: 'beside-core', folder: coreScriptUrl.replace(/[^/]*$/, '') };
  const folder = new URL(cfg.partsUrl, document.baseURI);
  if (folder.protocol !== 'https:' && folder.origin !== window.location.origin) {
    throw new Error(`partsUrl must be https or on this site: ${folder.href}`);
  }
  return { kind: 'parts-url', folder: folder.href };
}

/**
 * @param {HTMLScriptElement} script
 * @param {PartsSource} source
 * @param {string} file The part's file name.
 */
function checkIntegrity(script, source, file) {
  const integrity = source.kind === 'beside-core' ? PART_INTEGRITY[file] : undefined;
  if (!integrity) return;
  script.integrity = integrity;
  // A cross-origin script is only checked when fetched with CORS (CDNs such as jsDelivr allow it).
  if (new URL(script.src).origin !== window.location.origin) script.crossOrigin = 'anonymous';
}

/**
 * @param {PartName} name
 * @param {PartsSource} source
 * @param {string} file
 * @returns {Promise<unknown>}
 */
function loadScript(name, source, file) {
  return new Promise((resolve, reject) => {
    const url = `${source.folder.replace(/\/?$/, '/')}${file}`;
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    checkIntegrity(script, source, file);
    script.onload = () => {
      const { Tether } = /** @type {Window & { Tether?: { __parts?: Record<string, unknown> } }} */ (window);
      const part = Tether?.__parts?.[name];
      if (part) resolve(part);
      else reject(new Error(`${url} did not register`));
    };
    script.onerror = () => {
      parts.delete(name);
      reject(
        new Error(`Could not load ${url}. Host it next to the Tether script, from the same build, or set partsUrl.`),
      );
    };
    document.head.appendChild(script);
  });
}

/**
 * @template {PartName} Name
 * @param {Name} name
 * @returns {Promise<Parts[Name]>}
 * @throws {Error} (rejected) When the part's file can't be loaded, fails its integrity check or doesn't register.
 */
export function loadPart(name) {
  let loading = parts.get(name);
  if (!loading) {
    let source;
    try {
      source = partsSource();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const suffix = MINIFIED_SCRIPT.test(coreScriptUrl) || !coreScriptUrl ? '.min' : '';
    loading = loadScript(name, source, `tether.${name}${suffix}.js`);
    parts.set(name, loading);
  }
  // A part's file is built from the module `Parts[Name]` names (scripts/build.mjs), and registers that module.
  return /** @type {Promise<Parts[Name]>} */ (loading);
}

// Parts that load other parts (account → account-pages) use this same loader.
coreModules['lazy.js'] = { loadPart, coreModules };
