/**
 * A reconcile run: the products updated since the last one, after the retries. It stops at the first budget it hits
 * (Webflow writes, products, Shopify pages, Worker subrequests) and saves its exact position, so the next run
 * continues there. Each window overlaps the previous one by a few minutes, because Shopify's search index lags
 * slightly behind updates.
 */
import { flushPublish, removeProduct, syncProduct } from './sync-product.js';
import { PAGE_KEY, RETRY_KEY, SINCE_KEY, readPage, readRetries, readSince } from './sync-state.js';
import { messageOf, numericId, productGid } from './util.js';

/** @typedef {import('./sync-product.js').SyncContext} SyncContext */
/** @typedef {import('./sync-product.js').SyncResult} SyncResult */
/** @typedef {import('./sync-product.js').SyncStats} SyncStats */
/** @typedef {import('./sync-state.js').RetryEntry} RetryEntry */
/** @typedef {import('./sync-state.js').ReconcilePage} ReconcilePage */

/**
 * @typedef {object} ProductSource The part of the Shopify client the engine reads products with.
 * @property {(gid: string) => Promise<import('./mapping.js').Product | null>} getProduct `null` when the product is
 *   gone.
 * @property {(options: { after: string | null, query: string | null }) => Promise<ProductPage>} listProducts One page,
 *   oldest update first.
 */

/**
 * @typedef {{
 *   products: import('./mapping.js').Product[],
 *   pageInfo: { hasNextPage: boolean, endCursor: string | null },
 * }} ProductPage
 */

/** @typedef {{ left: () => number }} Budget The subrequests a Worker run has left. */

/** @typedef {'changes' | 'products' | 'pages' | 'subrequests' | 'error' | 'publish'} StopReason */

/** @typedef {RetryEntry | { id: null, error: string }} ReconcileFailure A failure without an id is a listing. */

/**
 * @typedef {object} ReconcileOptions
 * @property {number | undefined} [maxChanges]
 * @property {number | undefined} [maxProducts]
 * @property {number | undefined} [maxPages]
 * @property {string | null | undefined} [since] Starts a window here instead of at the cursor, e.g. for a first import.
 */

/**
 * @typedef {object} ReconcileResult
 * @property {string} since
 * @property {string} until The newest `updatedAt` seen: where the next window starts.
 * @property {number} processed
 * @property {number} pages
 * @property {number} changes
 * @property {boolean} complete
 * @property {StopReason | null} stopped `null` exactly when `complete`.
 * @property {ReconcileFailure[]} failures
 * @property {SyncStats} stats
 */

/**
 * @typedef {object} Run The state of a run in progress.
 * @property {number} changes
 * @property {number} processed
 * @property {number} pages
 * @property {StopReason | null} stopped
 * @property {ReconcileFailure[]} failures
 * @property {string | null} after
 * @property {number} offset How many products of the current page are done.
 * @property {string} newest
 */

/** Attempts before a failing product is dropped from the retry list. */
const MAX_ATTEMPTS = 5;
const MS_PER_MINUTE = 60000;

/** @param {string} iso @param {number} minutes */
const isoMinus = (iso, minutes) =>
  new Date(Date.parse(iso) - minutes * MS_PER_MINUTE).toISOString().replace('.000Z', 'Z');

/** Unchanged and skipped products cost no Webflow write. @param {SyncResult} result */
const isChange = (result) => result.action !== 'unchanged' && result.action !== 'skipped';

/**
 * @typedef {object} RunDeps
 * @property {SyncContext} ctx
 * @property {ProductSource} shopify
 * @property {() => boolean} outOfBudget
 * @property {{ maxChanges: number, maxProducts: number, maxPages: number }} limits
 */

/**
 * Products that failed before, in webhooks or earlier runs. Returns those left for the next run.
 *
 * @param {RunDeps} deps
 * @param {Run} run
 * @param {RetryEntry[]} retry
 * @returns {Promise<RetryEntry[]>}
 */
async function runRetries({ ctx, shopify, outOfBudget, limits }, run, retry) {
  /** @type {RetryEntry[]} */
  const left = [];
  for (const entry of retry) {
    if (outOfBudget() || run.changes >= limits.maxChanges) {
      left.push(entry);
      continue;
    }
    try {
      const product = await shopify.getProduct(productGid(entry.id));
      const result = product
        ? await syncProduct(ctx, product, { publishNow: false })
        : await removeProduct(ctx, entry.id);
      if (isChange(result)) run.changes++;
    } catch (err) {
      if (entry.attempts < MAX_ATTEMPTS)
        run.failures.push({ id: entry.id, attempts: entry.attempts + 1, error: messageOf(err) });
      else ctx.log.error(`giving up on product ${entry.id}: ${messageOf(err)}`);
    }
  }
  return left;
}

/**
 * Why the next product must wait for another run, or `null`.
 *
 * @param {RunDeps} deps
 * @param {Run} run
 * @returns {StopReason | null}
 */
function productStop({ outOfBudget, limits }, run) {
  if (run.changes >= limits.maxChanges) return 'changes';
  if (run.processed >= limits.maxProducts) return 'products';
  if (outOfBudget()) return 'subrequests';
  return null;
}

/**
 * Syncs a page from `run.offset` on. Stopping part-way leaves `run.offset` at the first product not done.
 *
 * @param {RunDeps} deps
 * @param {Run} run
 * @param {ProductPage} page
 */
async function runPage(deps, run, page) {
  const { ctx } = deps;
  for (const [i, product] of page.products.entries()) {
    if (i < run.offset) continue;
    const stop = productStop(deps, run);
    if (stop) {
      run.offset = i;
      run.stopped = stop;
      return;
    }
    run.processed++;
    try {
      if (isChange(await syncProduct(ctx, product, { publishNow: false }))) run.changes++;
    } catch (err) {
      ctx.stats.failed++;
      ctx.log.error(`sync ${product.handle} failed: ${messageOf(err)}`);
      run.failures.push({ id: numericId(product.id), attempts: 1, error: messageOf(err) });
    }
    if (product.updatedAt > run.newest) run.newest = product.updatedAt;
  }
  run.offset = 0;
}

/**
 * Lists the products updated since `start` page by page until a budget stops it or the last page is done.
 *
 * @param {RunDeps} deps
 * @param {Run} run
 * @param {string} start
 */
async function runPages(deps, run, start) {
  const { ctx, shopify, outOfBudget, limits } = deps;
  const query = `updated_at:>='${isoMinus(start, ctx.cfg.reconcile.overlapMinutes)}'`;
  for (;;) {
    if (run.pages >= limits.maxPages) {
      run.stopped = 'pages';
      return;
    }
    if (outOfBudget()) {
      run.stopped = 'subrequests';
      return;
    }
    let page;
    try {
      page = await shopify.listProducts({ after: run.after, query });
    } catch (err) {
      ctx.log.error(`listing products failed: ${messageOf(err)}`);
      run.stopped = 'error';
      run.failures.push({ id: null, error: messageOf(err) });
      return;
    }
    run.pages++;
    await runPage(deps, run, page);
    if (run.stopped || !page.pageInfo.hasNextPage) return;
    run.after = page.pageInfo.endCursor;
  }
}

/**
 * Stores the cursor, or the position of a window stopped part-way, and the retries. Only what moved is written:
 * KV's free tier allows 1,000 writes a day.
 *
 * @param {SyncContext} ctx
 * @param {{ run: Run, start: string, storedSince: string | null, resume: ReconcilePage | null, restart: boolean }} position
 *   `restart`: the window started at a `since` option instead of the cursor.
 * @param {{ retry: RetryEntry[], retryLeft: RetryEntry[] }} retries
 */
async function savePosition(ctx, { run, start, storedSince, resume, restart }, { retry, retryLeft }) {
  const { store } = ctx;
  if (!run.stopped) {
    if (storedSince !== run.newest) await store.put(SINCE_KEY, run.newest);
    if (resume || restart) await store.delete(PAGE_KEY);
  } else if (
    resume?.since !== start ||
    resume.after !== run.after ||
    resume.offset !== run.offset ||
    resume.newest !== run.newest
  ) {
    await store.put(PAGE_KEY, { since: start, after: run.after, offset: run.offset, newest: run.newest });
  }
  const failed = run.failures.filter(/** @returns {failure is RetryEntry} */ (failure) => failure.id !== null);
  const nextRetry = [...retryLeft, ...failed];
  if (nextRetry.length || retry.length) await store.put(RETRY_KEY, nextRetry);
}

/**
 * @param {SyncContext} ctx
 * @param {ProductSource} shopify
 * @param {Budget | null} budget
 * @param {ReconcileOptions} [options]
 * @returns {Promise<ReconcileResult>}
 */
export async function reconcile(ctx, shopify, budget, options = {}) {
  const { cfg, store, now } = ctx;
  const {
    maxChanges = cfg.reconcile.maxChangesPerRun,
    maxProducts = cfg.reconcile.maxProductsPerRun,
    maxPages = cfg.reconcile.maxPagesPerRun,
    since: sinceOverride,
  } = options;
  const storedSince = await readSince(store);
  // A half-done window is finished first, also one started with `since`.
  const resume = sinceOverride ? null : await readPage(store);
  const start =
    sinceOverride ||
    resume?.since ||
    storedSince ||
    new Date(now() - cfg.reconcile.lookbackMinutes * MS_PER_MINUTE).toISOString();
  const resumed = resume?.since === start ? resume : null;
  /** @type {Run} */
  const run = {
    changes: 0,
    processed: 0,
    pages: 0,
    stopped: null,
    failures: [],
    after: resumed ? resumed.after : null,
    offset: resumed ? resumed.offset : 0,
    newest: resumed ? resumed.newest : start,
  };
  const reserve = cfg.reconcile.reserveSubrequests;
  /** @type {RunDeps} */
  const deps = {
    ctx,
    shopify,
    outOfBudget: () => budget !== null && budget.left() < reserve,
    limits: { maxChanges, maxProducts, maxPages },
  };

  const retry = await readRetries(store);
  const retryLeft = await runRetries(deps, run, retry);
  await runPages(deps, run, start);
  try {
    await flushPublish(ctx);
  } catch (err) {
    // The hashes weren't stored, so the next run retries these products.
    ctx.log.error(`publish failed: ${messageOf(err)}`);
    run.stopped = 'publish';
  }
  if (!ctx.dryRun) {
    await savePosition(ctx, { run, start, storedSince, resume, restart: Boolean(sinceOverride) }, { retry, retryLeft });
  }
  const { changes, processed, pages, stopped, failures, newest } = run;
  return {
    since: start,
    until: newest,
    processed,
    pages,
    changes,
    complete: !stopped,
    stopped,
    failures,
    stats: { ...ctx.stats },
  };
}
