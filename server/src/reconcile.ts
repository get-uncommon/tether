/**
 * A reconcile run: the products updated since the last one, after the retries. It stops at the first budget it hits
 * (Webflow writes, products, Shopify pages, Worker subrequests) and saves the cursor of the last product it did, so
 * the next run continues right after it. A product edited meanwhile moves behind the cursor, to the end of the
 * listing, so this window still reaches it. Each window overlaps the previous one by a few minutes, because
 * Shopify's search index lags slightly behind updates.
 *
 * The products synced go live in one publish at the end. One the publish leaves unconfirmed goes on the retry list,
 * so the position can move past it. The retries are stored before the position: a run that dies between the two
 * writes repeats work, and never loses a product.
 */
import { PublishError, flushPublish, removeProduct, syncProduct } from './sync-product.ts';
import { PAGE_KEY, RETRY_KEY, SINCE_KEY, readPage, readRetries, readSince } from './sync-state.ts';
import { numericId, productGid } from './util.ts';
import { messageOf } from './shared/error-message.ts';

import type { Product } from './product.ts';
import type { ProductEdge } from './shopify.ts';
import type { SyncContext, SyncResult, SyncStats } from './sync-product.ts';
import type { ReconcilePage, RetryEntry } from './sync-state.ts';

/** The part of the Shopify client the engine reads products with. */
export interface ProductSource {
  /** `null` when the product is gone. */
  getProduct: (gid: string) => Promise<Product | null>;
  /** One page, oldest update first. */
  listProductEdges: (options: { after: string | null; query: string | null }) => Promise<ProductPage>;
}

interface ProductPage {
  edges: ProductEdge[];
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
  /** The cursor of the last product done, `null` before the window's first. */
  after: string | null;
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

/** Syncs a page in order, until a budget stops it. */
async function runPage(deps: RunDeps, run: Run, page: ProductPage): Promise<void> {
  const { ctx } = deps;
  for (const { cursor, product } of page.edges) {
    const stop = productStop(deps, run);
    if (stop) {
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
    run.after = cursor;
  }
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
      page = await shopify.listProductEdges({ after: run.after, query });
    } catch (err) {
      ctx.log.error(`listing products failed: ${messageOf(err)}`);
      run.stopped = 'error';
      run.failures.push({ id: null, error: messageOf(err) });
      return;
    }
    run.pages++;
    await runPage(deps, run, page);
    if (run.stopped || !page.pageInfo.hasNextPage) return;
  }
}

/**
 * Puts the products a publish left unconfirmed on the retry list.
 *
 * @param attemptsBefore The attempts of the products that came from the retry list, by id.
 */
function retryUnpublished(
  ctx: SyncContext,
  run: Run,
  error: PublishError,
  attemptsBefore: ReadonlyMap<string, number>,
): void {
  for (const { id } of error.products) {
    const before = attemptsBefore.get(id) ?? 0;
    // A publish call that failed as a whole says nothing about the product, so it costs no attempt.
    const attempts = error.refused ? before + 1 : Math.max(before, 1);
    if (attempts > MAX_ATTEMPTS) ctx.log.error(`giving up on product ${id}: ${error.message}`);
    else run.failures.push({ id, attempts, error: error.message });
  }
}

interface Position {
  run: Run;
  /** A budget or an error stopped the listing before the window's end. */
  listingStopped: boolean;
  start: string;
  storedSince: string | null;
  resume: ReconcilePage | null;
  /** The window started at a `since` option instead of the cursor. */
  restart: boolean;
}

/**
 * Stores the retries, then the cursor or the position of a window stopped part-way. Only what moved is written:
 * KV's free tier allows 1,000 writes a day.
 */
async function savePosition(
  ctx: SyncContext,
  { run, listingStopped, start, storedSince, resume, restart }: Position,
  { retry, retryLeft }: { retry: RetryEntry[]; retryLeft: RetryEntry[] },
): Promise<void> {
  const { store } = ctx;
  const failed = run.failures.filter((failure): failure is RetryEntry => failure.id !== null);
  // A product both failed and deferred, or both failed and left unpublished, is retried once.
  const nextRetry = [...new Map([...retryLeft, ...failed].map((entry) => [entry.id, entry])).values()];
  if (nextRetry.length || retry.length) await store.put(RETRY_KEY, nextRetry);
  if (!listingStopped) {
    if (storedSince !== run.newest) await store.put(SINCE_KEY, run.newest);
    if (resume || restart) await store.delete(PAGE_KEY);
  } else if (resume?.since !== start || resume.after !== run.after || resume.newest !== run.newest) {
    await store.put(PAGE_KEY, { since: start, after: run.after, newest: run.newest });
  }
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
  const listingStopped = run.stopped !== null;
  try {
    await flushPublish(ctx);
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    ctx.log.error(err.message);
    retryUnpublished(ctx, run, err, new Map(retry.map((entry) => [entry.id, entry.attempts])));
    run.stopped ??= 'publish';
  }
  if (!ctx.dryRun) {
    const position = { run, listingStopped, start, storedSince, resume, restart: Boolean(sinceOverride) };
    await savePosition(ctx, position, { retry, retryLeft });
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
