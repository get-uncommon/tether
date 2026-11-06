// @ts-nocheck
/**
 * <script> build: optional parts are separate files next to tether(.min).js, e.g.
 * tether.markets.min.js, loaded on first use. Override the folder with config.partsUrl.
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

const { cfg } = config;

/** The modules a part may use, shared instead of bundled twice (scripts/build.mjs maps imports to these). */
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

const self = typeof document !== 'undefined' ? document.currentScript?.src || '' : '';
const parts = {};

/**
 * The folder parts load from: `partsUrl`, else the core script's own folder. A `partsUrl` must be https or on this
 * site, because the parts run with the same access as the core (the account part holds customer sessions).
 */
function partsFolder() {
  if (!cfg.partsUrl) return self.replace(/[^/]*$/, '');
  const folder = new URL(String(cfg.partsUrl), document.baseURI);
  if (folder.protocol !== 'https:' && folder.origin !== window.location.origin) {
    throw new Error(`partsUrl must be https or on this site: ${folder.href}`);
  }
  return folder.href;
}

export function loadPart(name) {
  if (parts[name]) return parts[name];
  let base;
  try {
    base = partsFolder();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  const min = /\.min\.js(\?|$)/.test(self) || !self ? '.min' : '';
  const url = `${base.replace(/\/?$/, '/')}tether.${name}${min}.js`;
  parts[name] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () =>
      window.Tether?.__parts?.[name]
        ? resolve(window.Tether.__parts[name])
        : reject(new Error(`${url} did not register`));
    s.onerror = () => {
      delete parts[name];
      reject(new Error(`Could not load ${url}. Host it next to the Tether script, or set partsUrl.`));
    };
    document.head.appendChild(s);
  });
  return parts[name];
}

// Parts that load other parts (account -> account-pages) use this same loader.
coreModules['lazy.js'] = { loadPart, coreModules };
