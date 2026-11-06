/**
 * A reconcile run: the products updated since the last one, after the retries. It stops at the first budget it hits
 * (Webflow writes, products, Shopify pages, Worker subrequests) and saves its exact position, so the next run
 * continues there. Each window overlaps the previous one by a few minutes, because Shopify's search index lags
 * slightly behind updates.
 */
import { flushPublish, removeProduct, syncProduct } from './sync-product.ts';
import { PAGE_KEY, RETRY_KEY, SINCE_KEY, readPage, readRetries, readSince } from './sync-state.ts';
import { messageOf, numericId, productGid } from './util.ts';

import type { Product } from './product.ts';
import type { SyncContext, SyncResult, SyncStats } from './sync-product.ts';
import type { ReconcilePage, RetryEntry } from './sync-state.ts';

/** The part of the Shopify client the engine reads products with. */
export interface ProductSource {
  /** `null` when the product is gone. */
  getProduct: (gid: string) => Promise<Product | null>;
  /** One page, oldest update first. */
  listProducts: (options: { after: string | null; query: string | null }) => Promise<ProductPage>;
}

interface ProductPage {
  products: Product[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/** The subrequests a Worker run has left. */
export interface Budget {
  left: () => number;
}

type StopReason = 'changes' | 'products' | 'pages' | 'subrequests' | 'error' | 'publish';

/** A failure without an id is a listing. */
type ReconcileFailure = RetryEntry | { id: null; error: string };

export interface ReconcileOptions {
  maxChanges?: number | undefined;
  maxProducts?: number | undefined;
  maxPages?: number | undefined;
  /** Starts a window here instead of at the cursor, e.g. for a first import. */
  since?: string | null | undefined;
}

export interface ReconcileResult {
  since: string;
  /** The newest `updatedAt` seen: where the next window starts. */
  until: string;
  processed: number;
  pages: number;
  changes: number;
  complete: boolean;
  /** `null` exactly when `complete`. */
  stopped: StopReason | null;
  failures: ReconcileFailure[];
  stats: SyncStats;
}

/** The state of a run in progress. */
interface Run {
  changes: number;
  processed: number;
  pages: number;
  stopped: StopReason | null;
  failures: ReconcileFailure[];
  after: string | null;
  /** How many products of the current page are done. */
  offset: number;
  newest: string;
}

/** Attempts before a failing product is dropped from the retry list. */
const MAX_ATTEMPTS = 5;
const MS_PER_MINUTE = 60000;

const isoMinus = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) - minutes * MS_PER_MINUTE).toISOString().replace('.000Z', 'Z');

/** Unchanged and skipped products cost no Webflow write. */
const isChange = (result: SyncResult) => result.action !== 'unchanged' && result.action !== 'skipped';

interface RunDeps {
  ctx: SyncContext;
  shopify: ProductSource;
  outOfBudget: () => boolean;
  limits: { maxChanges: number; maxProducts: number; maxPages: number };
}

/** Products that failed before, in webhooks or earlier runs. Returns those left for the next run. */
async function runRetries(
  { ctx, shopify, outOfBudget, limits }: RunDeps,
  run: Run,
  retry: RetryEntry[],
): Promise<RetryEntry[]> {
  const left: RetryEntry[] = [];
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

/** Why the next product must wait for another run, or `null`. */
function productStop({ outOfBudget, limits }: RunDeps, run: Run): StopReason | null {
  if (run.changes >= limits.maxChanges) return 'changes';
  if (run.processed >= limits.maxProducts) return 'products';
  if (outOfBudget()) return 'subrequests';
  return null;
}

/** Syncs a page from `run.offset` on. Stopping part-way leaves `run.offset` at the first product not done. */
async function runPage(deps: RunDeps, run: Run, page: ProductPage): Promise<void> {
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

/** Lists the products updated since `start` page by page until a budget stops it or the last page is done. */
async function runPages(deps: RunDeps, run: Run, start: string): Promise<void> {
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

interface Position {
  run: Run;
  start: string;
  storedSince: string | null;
  resume: ReconcilePage | null;
  /** The window started at a `since` option instead of the cursor. */
  restart: boolean;
}

/**
 * Stores the cursor, or the position of a window stopped part-way, and the retries. Only what moved is written:
 * KV's free tier allows 1,000 writes a day.
 */
async function savePosition(
  ctx: SyncContext,
  { run, start, storedSince, resume, restart }: Position,
  { retry, retryLeft }: { retry: RetryEntry[]; retryLeft: RetryEntry[] },
): Promise<void> {
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
  const failed = run.failures.filter((failure): failure is RetryEntry => failure.id !== null);
  const nextRetry = [...retryLeft, ...failed];
  if (nextRetry.length || retry.length) await store.put(RETRY_KEY, nextRetry);
}

export async function reconcile(
  ctx: SyncContext,
  shopify: ProductSource,
  budget: Budget | null,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
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
  const run: Run = {
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
  const deps: RunDeps = {
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
