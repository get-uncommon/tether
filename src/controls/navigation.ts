/**
 * How the page follows the visitor across pages and markets: Astro's ClientRouter (`astro:page-load`,
 * `astro:before-swap`) mounts each new page in its market and closes the cart while leaving; back online, what failed
 * to load loads again. The markets part follows the country selects it fills.
 */
import { cfg, reportError, reportFailure } from '../config.ts';
import { attr } from '../dom.ts';
import { liveLists, retryFailed } from '../mounting.ts';
import { marketForArrival, setCountry } from '../page-market.ts';

/** What the entry module does for a page. */
interface PageHooks {
  /** Settles once `init()` has applied the visitor's market. */
  ready: () => Promise<unknown>;
  mount: (root: Document) => unknown;
  unmount: () => void;
}

/** The body the last full-document mount ran on: Astro's first `astro:page-load` comes after that mount. */
let mountedBody: HTMLElement | null = null;

/**
 * Records a mount of the whole document, so the `astro:page-load` of the same page sends no second round of requests.
 */
export function rememberDocumentMount(): void {
  mountedBody = document.body;
}

/** Mounts the page Astro swapped in. It rejects when `init()` failed or the mount threw; the listener reports that. */
async function onPageLoad(hooks: PageHooks): Promise<void> {
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

function bindAstroRouter(hooks: PageHooks): void {
  document.addEventListener('astro:page-load', () => {
    reportFailure(onPageLoad(hooks), 'page mount');
  });
  document.addEventListener('astro:before-swap', () => {
    mountedBody = null;
    hooks.unmount();
  });
}

/** Loads the failed products and lists again. */
function onOnline() {
  retryFailed();
  liveLists.forEach((list) => {
    if (list.root.getAttribute(attr('state')) === 'error') void list.load();
  });
}

/** Binds the document-wide listeners, once per page load of the script. */
export function bindNavigation(hooks: PageHooks): void {
  if (cfg.astro) bindAstroRouter(hooks);
  window.addEventListener('online', onOnline);
}
