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
 *
 * The retry list is this run's to rewrite. Failures queued under their own keys (webhooks') join it at the start, a
 * page of keys at a time, and those keys are deleted once the list that holds them is stored; one queued while the run
 * goes on waits for the next. A product whose item index can't be listed within the budget stops the run without
 * costing an attempt.
 *
 * A failing product is retried on the next run, then less often, and given up on once it has failed for a day, so an
 * outage of Webflow or Shopify that lasts hours loses nothing, and a product that can't sync stops costing requests
 * and writes. The list is written only in a run that changes it.
 *
 * Cloudflare allows a Worker invocation 1,000 KV operations; {@link maxReconcileKvOperations} counts a run's.
 */
import { PublishError, flushPublish, removeProduct, syncProduct } from './sync-product.ts';
import { IndexListingStopped } from './item-index.ts';
import {
  PAGE_KEY,
  RETRY_INBOX_KV_OPERATIONS,
  RETRY_KEY,
  SINCE_KEY,
  readPage,
  readRetries,
  readRetryInbox,
  readSince,
} from './sync-state.ts';
import { numericId, productGid, stableStringify } from './util.ts';
import { messageOf } from './shared/error-message.ts';

import type { Product } from './product.ts';
import type { ProductEdge } from './shopify.ts';
import type { SyncContext, SyncResult, SyncStats } from './sync-product.ts';
import type { ReconcileSettings } from './mapping.ts';
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

const MS_PER_MINUTE = 60000;
/**
 * The wait after a product's first, second, third failure and so on, in minutes; the last applies from then on. Each
 * attempt that fails rewrites the retry list, so a product failing all day costs about 25 writes.
 */
const RETRY_DELAYS_MINUTES = [0, 10, 30, 60];
/**
 * A cron run takes a retry due this soon: runs come every 10 minutes, and one that starts seconds before a retry is due
 * would put it off by a whole run.
 */
const RETRY_EARLY_MS = 5 * MS_PER_MINUTE;
/**
 * A product failing this long, after at least {@link MIN_ATTEMPTS} attempts, is given up on at its next failure. The
 * attempts matter for a queued failure the reconcile takes in late, behind a big backlog.
 */
const GIVE_UP_AFTER_MS = 24 * 60 * MS_PER_MINUTE;
const MIN_ATTEMPTS = 5;

/** Cloudflare's limit on one Worker invocation, on every plan; a KV call past it throws. */
export const KV_OPERATIONS_PER_INVOCATION = 1000;
/**
 * A run's KV operations besides its products and the inbox: the cursor, the window's position and the retry list (a
 * read and a write each), the item index and a stopped listing (a read and a write each), the Shopify token (a read,
 * and a delete and two writes when Shopify refuses it), the deploy hook's state and the webhook registration (a read
 * and a write each).
 */
const RUN_KV_OPERATIONS = 18;
/** A product's state read, the write of a created item before its publish and the write after the publish. */
const KV_OPERATIONS_PER_PRODUCT = 3;
/** A change in the window, whose state read the window's products already count: the two writes. */
const KV_WRITES_PER_CHANGE = 2;

/**
 * Where a run's changes go: Webflow, with or without a deploy hook, sends a request for each; deploy-only stores the
 * state and marks a build, with no request.
 */
export type ReconcileTarget = 'webflow' | 'deploy-only';

/**
 * The most KV operations a Worker reconcile run can use. Each product of the window costs a state read. A product
 * starts only while the reserve of subrequests is left, so the subrequests bound how many make a request (a retry asks
 * Shopify for its product, a Webflow write is one): each of those costs 3. A deploy-only change makes no request, so
 * `maxChangesPerRun` bounds those instead.
 */
export function maxReconcileKvOperations(
  settings: ReconcileSettings,
  subrequests: number,
  target: ReconcileTarget,
): number {
  const requesting = Math.max(0, subrequests - settings.reserveSubrequests + 1);
  const unrequestedChanges =
    target === 'deploy-only' ? Math.min(settings.maxChangesPerRun, settings.maxProductsPerRun) : 0;
  return (
    RUN_KV_OPERATIONS +
    RETRY_INBOX_KV_OPERATIONS +
    settings.maxProductsPerRun +
    KV_OPERATIONS_PER_PRODUCT * requesting +
    KV_WRITES_PER_CHANGE * unrequestedChanges
  );
}

const isoMinus = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) - minutes * MS_PER_MINUTE).toISOString().replace('.000Z', 'Z');

/** Unchanged and skipped products cost no Webflow write. */
const isChange = (result: SyncResult) => result.action !== 'unchanged' && result.action !== 'skipped';

interface RunDeps {
  ctx: SyncContext;
  shopify: ProductSource;
  outOfBudget: () => boolean;
  limits: { maxChanges: number; maxProducts: number; maxPages: number };
  /** The ids on the retry list. Each is retried first or waits for its time, so the window skips them. */
  retried: ReadonlySet<string>;
}

function retryDelayMs(attempts: number): number {
  const minutes = RETRY_DELAYS_MINUTES[Math.min(attempts, RETRY_DELAYS_MINUTES.length) - 1] ?? 0;
  return minutes * MS_PER_MINUTE;
}

/**
 * The retry entry after a failed attempt, or `null` when the sync gives up on the product, which is logged.
 *
 * @param previous The product's entry on the retry list, if it has one.
 */
function failedAttempt(
  ctx: SyncContext,
  id: string,
  error: string,
  previous: RetryEntry | undefined,
): RetryEntry | null {
  const now = ctx.now();
  const attempts = (previous?.attempts ?? 0) + 1;
  const failingSince = previous?.failingSince ?? now;
  if (attempts >= MIN_ATTEMPTS && now - failingSince >= GIVE_UP_AFTER_MS) {
    ctx.log.error(`giving up on product ${id} after a day of failures: ${error}`);
    return null;
  }
  return { id, attempts, error, failingSince, retryAt: now + retryDelayMs(attempts) };
}

/** Products that failed before, in webhooks or earlier runs, whose retry is due. Returns those left for later runs. */
async function runRetries(
  { ctx, shopify, outOfBudget, limits }: RunDeps,
  run: Run,
  retry: RetryEntry[],
): Promise<RetryEntry[]> {
  const left: RetryEntry[] = [];
  const dueBy = ctx.now() + RETRY_EARLY_MS;
  for (const entry of retry) {
    if (entry.retryAt > dueBy || outOfBudget() || run.changes >= limits.maxChanges) {
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
      if (err instanceof IndexListingStopped) {
        left.push(entry);
        continue;
      }
      const failure = failedAttempt(ctx, entry.id, messageOf(err), entry);
      if (failure) run.failures.push(failure);
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
    const id = numericId(product.id);
    // A failure here too would reset the retry's count of attempts to 1, so they would never run out.
    if (!deps.retried.has(id)) {
      run.processed++;
      try {
        if (isChange(await syncProduct(ctx, product, { publishNow: false }))) run.changes++;
      } catch (err) {
        if (err instanceof IndexListingStopped) {
          // The cursor stays before this product, so the next run starts with it.
          run.stopped = 'subrequests';
          return;
        }
        ctx.stats.failed++;
        ctx.log.error(`sync ${product.handle} failed: ${messageOf(err)}`);
        const failure = failedAttempt(ctx, id, messageOf(err), undefined);
        if (failure) run.failures.push(failure);
      }
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
 * @param retried The entries of the products that came from the retry list, by id.
 */
function retryUnpublished(
  ctx: SyncContext,
  run: Run,
  error: PublishError,
  retried: ReadonlyMap<string, RetryEntry>,
): void {
  for (const { id } of error.products) {
    const previous = retried.get(id);
    if (error.refused) {
      const failure = failedAttempt(ctx, id, error.message, previous);
      if (failure) run.failures.push(failure);
      continue;
    }
    // A publish call that failed as a whole says nothing about the product: it costs no attempt, and never a give-up.
    const now = ctx.now();
    const attempts = previous?.attempts ?? 1;
    const failingSince = previous?.failingSince ?? now;
    run.failures.push({ id, attempts, error: error.message, failingSince, retryAt: now + retryDelayMs(attempts) });
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

interface Retries {
  /** The list as KV held it at the run's start. */
  stored: unknown;
  /** The retries the budget deferred. */
  retryLeft: RetryEntry[];
  /** The inbox keys the run took into `retry`. */
  inboxKeys: string[];
}

/**
 * Stores the retries, then the cursor or the position of a window stopped part-way. Only what moved is written:
 * KV's free tier allows 1,000 writes a day.
 */
async function savePosition(
  ctx: SyncContext,
  { run, listingStopped, start, storedSince, resume, restart }: Position,
  { stored, retryLeft, inboxKeys }: Retries,
): Promise<void> {
  const { store } = ctx;
  const failed = run.failures.filter((failure): failure is RetryEntry => failure.id !== null);
  // A product both failed and deferred, or both failed and left unpublished, is retried once.
  const nextRetry = [...new Map([...retryLeft, ...failed].map((entry) => [entry.id, entry])).values()];
  if (stableStringify(nextRetry) !== stableStringify(stored ?? [])) await store.put(RETRY_KEY, nextRetry);
  for (const key of inboxKeys) await store.delete(key);
  if (!listingStopped) {
    if (storedSince !== run.newest) await store.put(SINCE_KEY, run.newest);
    if (resume || restart) await store.delete(PAGE_KEY);
  } else if (resume?.since !== start || resume.after !== run.after || resume.newest !== run.newest) {
    await store.put(PAGE_KEY, { since: start, after: run.after, newest: run.newest });
  }
}

/**
 * The retry list with the queued failures in. A product on both keeps the later failure's entry: a webhook that failed
 * after the listed failure was for a newer change or a deletion, which gets a day of retries of its own.
 */
function withInbox(listed: RetryEntry[], queued: RetryEntry[]): RetryEntry[] {
  const byId = new Map(listed.map((entry) => [entry.id, entry]));
  for (const entry of queued) {
    const known = byId.get(entry.id);
    if (!known || entry.failingSince > known.failingSince) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/** @param outOfBudget Whether the Worker run's subrequests are down to the reserve. */
export async function reconcile(
  ctx: SyncContext,
  shopify: ProductSource,
  outOfBudget: () => boolean,
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
  const listed = await readRetries(store, now());
  const inbox = await readRetryInbox(store, now());
  const retry = withInbox(listed.entries, inbox.entries);
  const deps: RunDeps = {
    ctx,
    shopify,
    outOfBudget,
    limits: { maxChanges, maxProducts, maxPages },
    retried: new Set(retry.map((entry) => entry.id)),
  };

  const retryLeft = await runRetries(deps, run, retry);
  await runPages(deps, run, start);
  const listingStopped = run.stopped !== null;
  try {
    await flushPublish(ctx);
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    ctx.log.error(err.message);
    retryUnpublished(ctx, run, err, new Map(retry.map((entry) => [entry.id, entry])));
    run.stopped ??= 'publish';
  }
  if (!ctx.dryRun) {
    const position = { run, listingStopped, start, storedSince, resume, restart: Boolean(sinceOverride) };
    await savePosition(ctx, position, { stored: listed.stored, retryLeft, inboxKeys: inbox.keys });
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
