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

const { cfg } = config;

/** The modules a part may use, shared instead of bundled twice (scripts/build.mjs maps imports to these). */
export const coreModules = {
  'config.js': config, 'client.js': client, 'dom.js': dom, 'fragments.js': fragments, 'loader.js': loader,
  'selling-plans.js': sellingPlans, 'status.js': status, 'cart.js': cart, 'product.js': product,
  'collection.js': collection, 'mounting.js': mounting,
};

const self = typeof document !== 'undefined' ? document.currentScript?.src || '' : '';
const parts = {};

export function loadPart(name) {
  if (parts[name]) return parts[name];
  const base = cfg.partsUrl || self.replace(/[^/]*$/, '');
  const min = /\.min\.js(\?|$)/.test(self) || !self ? '.min' : '';
  const url = `${base.replace(/\/?$/, '/')}tether.${name}${min}.js`;
  parts[name] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => (window.Tether?.__parts?.[name] ? resolve(window.Tether.__parts[name]) : reject(new Error(`${url} did not register`)));
    s.onerror = () => { delete parts[name]; reject(new Error(`Could not load ${url}. Host it next to the Tether script, or set partsUrl.`)); };
    document.head.appendChild(s);
  });
  return parts[name];
}

// Parts that load other parts (account -> account-pages) use this same loader.
coreModules['lazy.js'] = { loadPart, coreModules };
