/**
 * How the page follows the visitor across pages and markets: Astro's ClientRouter (`astro:page-load`,
 * `astro:before-swap`) mounts each new page in its market and closes the cart while leaving; a country select
 * switches the market; back online, what failed to load loads again.
 */
import { cfg, reportError } from '../config.js';
import { attr, sel } from '../dom.js';
import { liveLists, retryFailed } from '../mounting.js';
import { marketForArrival, setCountry } from '../page-market.js';

/**
 * @typedef {object} PageHooks What the entry module does for a page.
 * @property {() => Promise<unknown>} ready Settles once `init()` has applied the visitor's market.
 * @property {(root: Document) => unknown} mount
 * @property {() => void} unmount
 */

/**
 * The body the last full-document mount ran on: Astro's first `astro:page-load` comes after that mount.
 *
 * @type {HTMLElement | null} */
let mountedBody = null;

/** Records a mount of the whole document, so the `astro:page-load` of the same page sends no second round of requests. */
export function rememberDocumentMount() {
  mountedBody = document.body;
}

/** @param {PageHooks} hooks */
async function onPageLoad(hooks) {
  await hooks.ready();
  const target = marketForArrival();
  if (!target) {
    if (mountedBody !== document.body) hooks.mount(document);
    return;
  }
  try {
    await setCountry(target.country, { language: target.language ?? null, locale: target.locale, remember: false });
  } catch (error) {
    reportError(error, 'country');
  }
  hooks.mount(document);
}

/** @param {PageHooks} hooks */
function bindAstroRouter(hooks) {
  document.addEventListener('astro:page-load', () => {
    void onPageLoad(hooks);
  });
  document.addEventListener('astro:before-swap', () => {
    mountedBody = null;
    hooks.unmount();
  });
}

/** @param {Event} event */
function onChange(event) {
  const { target } = event;
  if (!(target instanceof window.HTMLSelectElement) || !target.matches(sel('country-select'))) return;
  if (!target.value) return;
  setCountry(target.value).catch((/** @type {unknown} */ error) => {
    reportError(error, 'country');
  });
}

/** Loads the failed products and lists again. */
function onOnline() {
  retryFailed();
  liveLists.forEach((list) => {
    if (list.root.getAttribute(attr('state')) === 'error') void list.load();
  });
}

/**
 * Binds the document-wide listeners, once per page load of the script.
 *
 * @param {PageHooks} hooks
 */
export function bindNavigation(hooks) {
  if (cfg.astro) bindAstroRouter(hooks);
  document.addEventListener('change', onChange);
  window.addEventListener('online', onOnline);
}
