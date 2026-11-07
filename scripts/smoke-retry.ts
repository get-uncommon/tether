/**
 * Which failures of a smoke step are Shopify's own, for a moment, and running a step again after one. The demo store's
 * Storefront API answers a request now and then with a server error that the same request doesn't get a moment later;
 * a step retried past that still checks what it checks. Anything else fails the step at once: a 4xx, a GraphQL error
 * other than Shopify's internal one (a query the API version no longer accepts), or an answer of the wrong shape.
 *
 * The smoke test runs the built package, whose `TetherError` is another class than the source's, so a failure is read
 * by its fields.
 */
import { field } from '../server/src/shared/json.ts';
import { messageOf } from '../server/src/shared/error-message.ts';

/** The text Shopify answers an internal failure with, before its request id. */
const SHOPIFY_INTERNAL_ERROR = 'Internal error. Looks like something went wrong on our end';
const REQUEST_ID = /Request ID: ([\w-]+)/;
const FIRST_SERVER_STATUS = 500;
const MS_PER_SECOND = 1000;

/** The waits before the second and the third attempt. */
export const RETRY_DELAYS_MS = [1000, 3000];

/**
 * A failure that says Shopify failed on its side: no answer (`NETWORK`), an HTTP 5xx, or a GraphQL error with
 * Shopify's `INTERNAL_SERVER_ERROR` code or its internal error message. Tether's `SERVER_ERROR` alone is not one:
 * Tether also gives it to a mutation answered with errors and no `data`, which is how Shopify refuses a mutation the
 * API version doesn't accept.
 */
export function isTransientShopifyFailure(error: unknown): boolean {
  const status = field(error, 'status');
  if (field(error, 'code') === 'NETWORK') return true;
  if (typeof status === 'number' && status >= FIRST_SERVER_STATUS) return true;
  const errors = field(error, 'errors');
  const internal =
    Array.isArray(errors) &&
    errors.some((entry) => field(field(entry, 'extensions'), 'code') === 'INTERNAL_SERVER_ERROR');
  return internal || messageOf(error).includes(SHOPIFY_INTERNAL_ERROR);
}

/** @returns The request id Shopify gives in an internal error's message, for its support. */
export const requestIdOf = (error: unknown): string | null => REQUEST_ID.exec(messageOf(error))?.[1] ?? null;

/** What `withRetries` waits with and logs to; the smoke test's own are `setTimeout` and `console.log`. */
export interface RetryHooks {
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

/**
 * Runs `check`, and again after each wait in `RETRY_DELAYS_MS` while it fails with a transient Shopify failure.
 *
 * @throws The failure of the last attempt, or the first one that isn't transient.
 */
export async function withRetries(name: string, check: () => Promise<void> | void, hooks: RetryHooks): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await check();
      return;
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransientShopifyFailure(error)) throw error;
      const requestId = requestIdOf(error) ?? 'none given';
      hooks.log(`  ..  ${name}: Shopify failed (request ID ${requestId}), trying again in ${delay / MS_PER_SECOND} s`);
      await hooks.sleep(delay);
    }
  }
}
