/**
 * The one Storefront API client: a fetch wrapper that adds the market (`@inContext`), retries what is safe to send
 * again (`Operation`), and turns every failure, including an answer whose `data` lacks what its caller reads
 * (`DataCheck`), into a `TetherError`. The browser (`gql`, and `query` for `Tether.query()`) and the server helpers
 * (`request` with their own config) share it.
 */
import { cfg, log } from './config.ts';
import { toCountry, toLanguage } from './market-codes.ts';
import { field, isRecord } from '../server/src/shared/json.ts';
import { messageOf } from '../server/src/shared/error-message.ts';
import type { TetherConfig } from './config.ts';
import type { CountryCode, LanguageCode } from './market-codes.ts';

export type TetherErrorCode =
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'NOT_CONFIGURED'
  | 'NOT_LOGGED_IN'
  | 'INVALID'
  | 'INVALID_COUNTRY'
  | 'INVALID_DISCOUNT'
  | 'INVALID_RESPONSE'
  | 'SERVER_ERROR'
  | 'ERROR'
  | `HTTP_${number}`;
export interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}
/** The response shape the GraphQL spec sets. */
interface GraphQLResponse {
  data?: unknown;
  errors?: GraphQLError[];
}
export interface UserError {
  message: string;
  field?: string[] | null;
  code?: string | null;
}
interface TetherErrorDetails {
  /** Default `HTTP_<status>` with a status, else `ERROR`. */
  code?: TetherErrorCode | undefined;
  /** The HTTP status of the response that failed. */
  status?: number;
  /** The GraphQL errors of that response. */
  errors?: readonly GraphQLError[];
  /** A mutation's user errors. */
  userErrors?: readonly UserError[];
}

export class TetherError extends Error {
  override readonly name = 'TetherError' as const;
  readonly code: TetherErrorCode;
  readonly status: number | undefined;
  readonly errors: readonly GraphQLError[] | undefined;
  readonly userErrors: readonly UserError[] | undefined;

  constructor(message: string, { status, errors, userErrors, code }: TetherErrorDetails = {}) {
    super(message);
    this.code = code ?? (status ? `HTTP_${status}` : 'ERROR');
    this.status = status;
    this.errors = errors;
    this.userErrors = userErrors;
  }
}

/** What a request needs from a config: the browser's `cfg`, or a config the server helpers build. */
export type StorefrontConfig = Pick<
  TetherConfig,
  'domain' | 'token' | 'apiVersion' | 'country' | 'language' | 'maxAge' | 'retries' | 'requestTimeout'
> & { fetch?: typeof fetch };
/** Checks a query's `data` before its caller reads it as a `T`. */
export type DataCheck<T> = (data: unknown) => data is T;
/**
 * The structure of JSON a check accepts: a `typeof` name, `'object'` for a plain object, `[item]` for a list of
 * items, an object's fields, or a check of its own. Fields it doesn't name aren't checked, so a shape names only what
 * its reader walks without a fallback. A field's `undefined` is the type of one `ShapeOf` leaves out, and checks
 * nothing.
 */
export type Shape =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | ((value: unknown) => boolean)
  | readonly [Shape]
  | { readonly [key: string]: Shape | undefined };

/** @returns True when `value` has the structure `shape` describes. */
export function matches(value: unknown, shape: Shape): boolean {
  if (typeof shape === 'function') return shape(value);
  if (typeof shape === 'string') return shape === 'object' ? isRecord(value) : typeof value === shape;
  if (isShapeList(shape)) return Array.isArray(value) && value.every((item) => matches(item, shape[0]));
  return (
    isRecord(value) && Object.entries(shape).every(([key, inner]) => inner === undefined || matches(value[key], inner))
  );
}

/** `Array.isArray` doesn't narrow a readonly tuple out of a union. */
const isShapeList = (shape: Shape): shape is readonly [Shape] => Array.isArray(shape);

/**
 * The shapes that describe a `T`: every structure such a shape names is one `T` declares at that place, and a check
 * in it is a type guard for a type `T` accepts there. A shape for `T` therefore can't name a field `T` lacks or claim
 * a type `T` contradicts, so a change to `T` that its shape no longer agrees with fails to compile. Fields of `T` the
 * shape doesn't name stay unchecked (`Shape`).
 */
export type ShapeOf<T> = unknown extends T ? Shape : KnownShapeOf<T>;
type KnownShapeOf<T> =
  | DataCheck<T>
  | (string extends T ? 'string' : never)
  | (number extends T ? 'number' : never)
  | (boolean extends T ? 'boolean' : never)
  | ListShapeOf<T>
  | FieldsShapeOf<T>;
type ListShapeOf<T> = T extends readonly (infer Item)[] ? readonly [ShapeOf<Item>] : never;
type FieldsShapeOf<T> = T extends readonly unknown[]
  ? never
  : T extends object
    ? 'object' | { readonly [Key in keyof T]?: ShapeOf<T[Key]> }
    : never;

/** @returns A check that `value` is `null` or has the structure `shape` describes. */
export const orNull =
  <T>(shape: ShapeOf<T>): DataCheck<T | null> =>
  (value): value is T | null =>
    value === null || matches(value, shape);

/**
 * @returns A check that `data` has the structure `shape` describes. `ShapeOf` ties `shape` to `T`; fields `shape`
 *   doesn't name are `T`'s claim.
 */
export const shaped =
  <T>(shape: ShapeOf<T>): DataCheck<T> =>
  (data): data is T =>
    matches(data, shape);
/**
 * What an operation does to the store, which decides what is safe to retry. A query only reads, so a failure that may
 * pass is retried: the network (no answer, or a body that stopped arriving), a 429, a 5xx, `THROTTLED` and
 * `INTERNAL_SERVER_ERROR`. Shopify may have applied a mutation before a server error or a dropped connection, so a
 * mutation is retried only when Shopify answers that it didn't run it (429 or `THROTTLED`): sending it again could add
 * a line twice. Other failures (a 4xx, a 430, an answer that isn't valid, other GraphQL errors) are never retried.
 */
export type Operation = 'query' | 'mutation';

interface RequestOptions {
  /** `false` sends the query without `@inContext`. */
  context?: boolean;
  /** Default `'query'`. */
  operation?: Operation;
}
/** What the store's token may read beyond the defaults. */
export interface StoreAccess {
  inventory: boolean;
}
/**
 * A query's text, or a function that writes it for what the token may read: Tether's own queries, built from
 * `fragments.ts`, leave out inventory for a token that can't read it. Documents Tether didn't write are strings.
 */
export type QueryText = string | ((access: StoreAccess) => string);

/** @returns The Storefront GraphQL endpoint of `conf`'s store. */
export function endpoint(conf: Pick<TetherConfig, 'domain' | 'apiVersion'> = cfg): string {
  return `https://${conf.domain}/api/${conf.apiVersion}/graphql.json`;
}

/** GraphQL strings and `#` comments: text in them is never part of an operation's header. */
const STRINGS_AND_COMMENTS = /"(?:\\.|[^"\\\n])*"|#[^\n]*/g;
/** An operation's keyword, name and variable definitions: named (query Name($x: T)) and anonymous (query { … }). */
const OPERATION_START = /^\s*(?:query|mutation)(?:\s+\w+)?\s*(?:\([^)]*\))?/;

/**
 * The operation of a document Tether didn't write (`Tether.query()`, the server's `query()`). Outside strings and
 * comments, any `mutation` keyword makes it a mutation: a document that starts with a fragment still has its
 * operation found, and a misread errs on the side that is never sent twice.
 */
export function operationOf(document: string): Operation {
  return /\bmutation\b/.test(document.replace(STRINGS_AND_COMMENTS, '')) ? 'mutation' : 'query';
}

/**
 * Adds @inContext(country, language) to the first operation in the document, so prices, currency and translations
 * follow the market. The header is found in a copy of the document whose strings and comments are blanked out, so a
 * `)` in a default value or an `@inContext` in a comment or the selection set doesn't move or stop it; an operation
 * that names its own `@inContext` keeps it. Tether's own documents start with their operation, and so do the ones
 * `Tether.query()` is given in practice: a document that starts with a fragment is sent as written.
 */
function inContext(
  query: string,
  { country, language }: { country: CountryCode | undefined; language: LanguageCode | undefined },
): string {
  const args: string[] = [];
  if (country) args.push(`country: ${country}`);
  if (language) args.push(`language: ${language}`);
  if (!args.length) return query;
  const tag = `@inContext(${args.join(', ')})`;
  const blanked = query.replace(STRINGS_AND_COMMENTS, (text) => ' '.repeat(text.length));
  const selectionStart = blanked.indexOf('{');
  if (blanked.slice(0, selectionStart).includes('@inContext')) return query;
  // Shorthand: a document that starts with its selection set is a query without a keyword.
  if (blanked.trimStart().startsWith('{')) return `query ${tag} ${query.slice(selectionStart)}`;
  const header = OPERATION_START.exec(blanked);
  if (!header) return query;
  const end = header[0].length;
  return `${query.slice(0, end).trimEnd()} ${tag} ${query.slice(end).trimStart()}`;
}

/**
 * `inContext` for any country and language, as the public `Tether.withContext` takes them: one that isn't a valid
 * code is left out, so page input never becomes query text.
 */
export function withContext(
  query: string,
  ctx: { country?: string | undefined; language?: string | undefined } = cfg,
): string {
  const country = toCountry(ctx.country) ?? undefined;
  const language = toLanguage(ctx.language) ?? undefined;
  return inContext(query, { country, language });
}

/** The first retry's wait after a network error, a 429 or a 5xx; each later retry waits twice as long as the last. */
const RETRY_BACKOFF_MS = 300;
/** The same for Shopify's `THROTTLED` error, which asks for a longer wait. */
const THROTTLE_BACKOFF_MS = 500;
/** The longest wait between two tries, however many retries came before. */
const MAX_BACKOFF_MS = 30_000;
/** Shopify's status for a request its bot protection rejected; retrying doesn't help. */
const SECURITY_REJECTION = 430;
const MS_PER_SECOND = 1000;

/**
 * `quantityAvailable` needs the token's `unauthenticated_read_product_inventory` scope; without it Shopify refuses the
 * whole query with an error naming the field. That refusal is learned once per page and store: Tether's later queries
 * to the store are written without the field (`StoreAccess`), so stock levels are unknown and everything else works,
 * for one extra request.
 */
const INVENTORY_FIELD = 'quantityAvailable';

/** The stores (domain, version and token) whose token can't read inventory. */
const storesWithoutInventory = new Set<string>();

const storeOf = (conf: StorefrontConfig) => `${conf.domain} ${conf.apiVersion} ${conf.token}`;

/** @returns The text sent: with the market, and the cache's time bucket for a query. */
function queryText(
  conf: StorefrontConfig,
  query: QueryText,
  access: StoreAccess,
  { context, operation }: Required<RequestOptions>,
): string {
  const written = typeof query === 'string' ? query : query(access);
  const text = context ? inContext(written, conf) : written;
  if (conf.maxAge <= 0 || operation === 'mutation') return text;
  return `${text} #${Math.floor(Date.now() / (conf.maxAge * MS_PER_SECOND))}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a status means, for errors Shopify sends without a message (401/403 have none). */
function statusText(status: number, conf: StorefrontConfig): string {
  if (status === 401 || status === 403) {
    const adminHint = conf.token.startsWith('shpat_') ? ', not an Admin API token (shpat_…)' : '';
    return `Shopify rejected the Storefront token for ${conf.domain} (${status}): use the public Storefront API token (Headless channel)${adminHint}`;
  }
  if (status === 404) {
    return `Store or API version not found (404): check domain ${conf.domain} and apiVersion ${conf.apiVersion}`;
  }
  return `HTTP ${status} from ${conf.domain}`;
}

/**
 * @param value One entry of a response's `errors`.
 * @returns The error, with an empty message when it has none.
 */
function toGraphQLError(value: unknown): GraphQLError {
  const message = field(value, 'message');
  const code = field(field(value, 'extensions'), 'code');
  const text = typeof message === 'string' ? message : '';
  return typeof code === 'string' ? { message: text, extensions: { code } } : { message: text };
}

/**
 * @param json A response body.
 * @returns The body in the shape the GraphQL spec sets, `null` when it has another one.
 */
function toGraphQLResponse(json: unknown): GraphQLResponse | null {
  if (!isRecord(json)) return null;
  const { data, errors } = json;
  if (errors === undefined || errors === null) return { data };
  if (!Array.isArray(errors)) return null;
  return { data, errors: errors.map(toGraphQLError) };
}

/**
 * For a body that isn't JSON, isn't in the GraphQL shape or has `data` its caller's check refuses: `INVALID_RESPONSE`
 * for a 2xx, after which Shopify may have run a mutation, else `HTTP_<status>`.
 */
function invalidResponse(res: Response, conf: StorefrontConfig): TetherError {
  return res.ok
    ? new TetherError(`Invalid response (${res.status})`, { code: 'INVALID_RESPONSE', status: res.status })
    : new TetherError(statusText(res.status, conf), { status: res.status });
}

function graphQLFailure(
  res: Response,
  errors: GraphQLError[],
  conf: StorefrontConfig,
  code?: TetherErrorCode,
): TetherError {
  const message = errors
    .map((error) => error.message)
    .filter(Boolean)
    .join(' | ');
  let text = message || 'Storefront API error';
  if (!res.ok) text = res.status === 401 || res.status === 403 || !message ? statusText(res.status, conf) : message;
  return new TetherError(text, { status: res.status, errors, code });
}

type Attempt<T> =
  { kind: 'data'; data: T } | { kind: 'retry'; backoffMs: number } | { kind: 'inventory-refused'; error: TetherError };

/**
 * Which failures an attempt may answer with a retry instead of throwing: none on the last attempt, only Shopify's
 * "not run" answers for a mutation (`Operation`).
 */
type RetryPolicy = 'none' | 'not-run' | 'any';

/**
 * No answer arrived, in time (`requestTimeout`) or at all, or its body stopped arriving: retried when `retry`
 * allows any retry, else `NETWORK`.
 */
function networkFailure(error: unknown, retry: RetryPolicy): Attempt<never> {
  if (retry === 'any') return { kind: 'retry', backoffMs: RETRY_BACKOFF_MS };
  throw new TetherError(`Network error: ${messageOf(error)}`, { code: 'NETWORK' });
}

/**
 * What an answer with GraphQL errors means: an inventory refusal, a retry `retry` allows, or else the failure it
 * throws. Shopify answers a failure on its own side with a 200 and a top-level `INTERNAL_SERVER_ERROR`, which means
 * what a 5xx does; a 2xx mutation answer with errors and no `data` doesn't say whether Shopify applied it either.
 * Both are `SERVER_ERROR`.
 */
function graphQLOutcome(
  res: Response,
  conf: StorefrontConfig,
  query: string,
  errors: GraphQLError[],
  data: unknown,
  retry: RetryPolicy,
  operation: Operation,
): Attempt<never> {
  if (query.includes(INVENTORY_FIELD) && errors.some((error) => error.message.includes(INVENTORY_FIELD))) {
    return { kind: 'inventory-refused', error: graphQLFailure(res, errors, conf) };
  }
  const codes = errors.map((error) => error.extensions?.code);
  if (retry !== 'none' && codes.includes('THROTTLED')) return { kind: 'retry', backoffMs: THROTTLE_BACKOFF_MS };
  const serverError = codes.includes('INTERNAL_SERVER_ERROR');
  if (retry === 'any' && serverError) return { kind: 'retry', backoffMs: RETRY_BACKOFF_MS };
  const unclear = res.ok && (serverError || (operation === 'mutation' && data == null));
  throw graphQLFailure(res, errors, conf, unclear ? 'SERVER_ERROR' : undefined);
}

/**
 * Runs `send` with a signal that aborts it, the answer's body included, after `ms` milliseconds (`0`: never), as
 * `AbortSignal.timeout` would; Safari before 16 lacks that. A request that never settles would hold every cart change
 * queued behind it (`enqueue`) for as long as the browser keeps the connection open.
 */
async function withTimeout<T>(ms: number, send: (signal: AbortSignal | null) => Promise<T>): Promise<T> {
  if (!ms) return send(null);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('signal timed out', 'TimeoutError'));
  }, ms);
  try {
    return await send(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** One request. Failures that retrying can't fix, or that `retry` doesn't allow retrying, throw. */
async function attempt<T>(
  conf: StorefrontConfig,
  query: string,
  variables: Record<string, unknown>,
  isData: DataCheck<T>,
  retry: RetryPolicy,
  operation: Operation,
  signal: AbortSignal | null,
): Promise<Attempt<T>> {
  let res;
  try {
    res = await (conf.fetch ?? fetch)(endpoint(conf), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': conf.token },
      body: JSON.stringify({ query, variables }),
      // A `fetch` given to the server helpers has to honour the signal, as the platform's does.
      signal,
    });
  } catch (error) {
    return networkFailure(error, retry);
  }
  if (res.status === SECURITY_REJECTION) {
    throw new TetherError('Shopify security rejection (430)', { status: SECURITY_REJECTION });
  }
  if ((retry !== 'none' && res.status === 429) || (retry === 'any' && res.status >= 500)) {
    return { kind: 'retry', backoffMs: RETRY_BACKOFF_MS };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (error) {
    // `json()` refuses a body that isn't JSON with a SyntaxError; it rejects with another error when the connection
    // drops while the body streams in.
    if (error instanceof SyntaxError) throw invalidResponse(res, conf);
    return networkFailure(error, retry);
  }
  const body = toGraphQLResponse(json);
  if (!body) throw invalidResponse(res, conf);
  const { data, errors = [] } = body;
  if (errors.length) return graphQLOutcome(res, conf, query, errors, data, retry, operation);
  if (!res.ok) throw new TetherError(statusText(res.status, conf), { status: res.status });
  if (!isData(data)) throw invalidResponse(res, conf);
  return { kind: 'data', data };
}

/**
 * One Storefront API request, for any config: the browser's shared one (`gql`) or one the server helpers build.
 * Queries carry a time bucket so Shopify's cache of an identical query text is at most `maxAge` seconds old. A query
 * written for the store's access leaves out inventory once the token turns out not to read it (`INVENTORY_FIELD`);
 * a fixed query text is the caller's own, and that refusal is its error, as is a refusal of a text written without
 * inventory, so the refusal costs at most one extra request. How often a failure is retried is
 * `conf.retries`; which failures are retried is the operation's (`Operation`).
 *
 * @param isData Checks that `data` has what the caller then reads, so a malformed answer fails here.
 * @throws {TetherError} `NOT_CONFIGURED` without a domain or token, `NETWORK` when the store can't be reached, the
 *   answer's body stops arriving or the whole answer takes longer than `conf.requestTimeout`, `INVALID_RESPONSE` for
 *   a 2xx whose body isn't valid (not JSON, not in the GraphQL shape, or `data` that `isData` refuses),
 *   `SERVER_ERROR` for a 2xx whose GraphQL errors leave open whether Shopify ran it (a top-level
 *   `INTERNAL_SERVER_ERROR`, or a mutation's errors without `data`), `HTTP_<status>` for any other HTTP or GraphQL failure.
 */
export async function request<T>(
  conf: StorefrontConfig,
  query: QueryText,
  variables: Record<string, unknown>,
  isData: DataCheck<T>,
  { context = true, operation = 'query' }: RequestOptions = {},
): Promise<T> {
  if (!conf.domain || !conf.token) {
    throw new TetherError('Tether is not configured: domain and token are required', { code: 'NOT_CONFIGURED' });
  }
  const store = storeOf(conf);
  const retryWhileLeft: RetryPolicy = operation === 'mutation' ? 'not-run' : 'any';
  let retries = 0;
  for (;;) {
    const access = { inventory: !storesWithoutInventory.has(store) };
    const sent = queryText(conf, query, access, { context, operation });
    const retry = retries < conf.retries ? retryWhileLeft : 'none';
    const outcome = await withTimeout(conf.requestTimeout, (signal) =>
      attempt(conf, sent, variables, isData, retry, operation, signal),
    );
    switch (outcome.kind) {
      case 'data':
        return outcome.data;
      case 'inventory-refused':
        if (typeof query === 'string' || !access.inventory) throw outcome.error;
        log(`the token can't read inventory: ${INVENTORY_FIELD} is left out from now on`);
        storesWithoutInventory.add(store);
        break;
      case 'retry':
        await sleep(Math.min(outcome.backoffMs * 2 ** retries, MAX_BACKOFF_MS));
        retries += 1;
        log('retry', retries);
        break;
    }
  }
}

/** `request` with the browser's shared config. */
export function gql<T>(
  query: QueryText,
  variables: Record<string, unknown>,
  isData: DataCheck<T>,
  options?: RequestOptions,
): Promise<T> {
  return request(cfg, query, variables, isData, options);
}

/** The check of `Tether.query()` and the server's `query()`, whose callers read `data` themselves. */
export const hasData = (data: unknown): data is object => typeof data === 'object' && data !== null;

/**
 * `Tether.query()` and the server's `query()`: a document Tether didn't write, sent with `conf`.
 *
 * @returns Shopify's `data`, checked only for being an object: the caller's own query decides its shape, so the caller
 *   checks the fields it reads.
 */
export function untypedQuery(
  conf: StorefrontConfig,
  text: string,
  variables: Record<string, unknown> = {},
  options?: Omit<RequestOptions, 'operation'>,
): Promise<object> {
  return request(conf, text, variables, hasData, { ...options, operation: operationOf(text) });
}

/** `Tether.query()`: `untypedQuery` with the browser's shared config. */
export function query(
  text: string,
  variables?: Record<string, unknown>,
  options?: Omit<RequestOptions, 'operation'>,
): Promise<object> {
  return untypedQuery(cfg, text, variables, options);
}

/**
 * @param payload A mutation's payload.
 * @param name The mutation, for the error message.
 * @throws {TetherError} `ERROR` on an empty payload or on user errors (in `userErrors`).
 */
export function unwrap<Payload extends { userErrors?: readonly UserError[] | null }>(
  payload: Payload | null | undefined,
  name: string,
): Payload {
  if (!payload) throw new TetherError(`${name}: empty response`);
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length) {
    throw new TetherError(userErrors.map((error) => error.message).join(' | '), { userErrors });
  }
  return payload;
}
