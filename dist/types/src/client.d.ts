import type { TetherConfig } from './config.js';
export type TetherErrorCode = 'NOT_FOUND' | 'NETWORK' | 'NOT_CONFIGURED' | 'NOT_LOGGED_IN' | 'INVALID' | 'INVALID_COUNTRY' | 'INVALID_DISCOUNT' | 'INVALID_RESPONSE' | 'SERVER_ERROR' | 'ERROR' | `HTTP_${number}`;
export interface GraphQLError {
    message: string;
    extensions?: {
        code?: string;
    };
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
export declare class TetherError extends Error {
    readonly name: "TetherError";
    readonly code: TetherErrorCode;
    readonly status: number | undefined;
    readonly errors: readonly GraphQLError[] | undefined;
    readonly userErrors: readonly UserError[] | undefined;
    constructor(message: string, { status, errors, userErrors, code }?: TetherErrorDetails);
}
/** What a request needs from a config: the browser's `cfg`, or a config the server helpers build. */
export type StorefrontConfig = Pick<TetherConfig, 'domain' | 'token' | 'apiVersion' | 'country' | 'language' | 'maxAge' | 'retries' | 'requestTimeout'> & {
    fetch?: typeof fetch;
};
/** Checks a query's `data` before its caller reads it as a `T`. */
export type DataCheck<T> = (data: unknown) => data is T;
/**
 * The structure of JSON a check accepts: a `typeof` name, `'object'` for a plain object, `[item]` for a list of
 * items, an object's fields, or a check of its own. Fields it doesn't name aren't checked, so a shape names only what
 * its reader walks without a fallback. A field's `undefined` is the type of one `ShapeOf` leaves out, and checks
 * nothing.
 */
export type Shape = 'string' | 'number' | 'boolean' | 'object' | ((value: unknown) => boolean) | readonly [Shape] | {
    readonly [key: string]: Shape | undefined;
};
/** @returns True when `value` has the structure `shape` describes. */
export declare function matches(value: unknown, shape: Shape): boolean;
/**
 * The shapes that describe a `T`: every structure such a shape names is one `T` declares at that place, and a check
 * in it is a type guard for a type `T` accepts there. A shape for `T` therefore can't name a field `T` lacks or claim
 * a type `T` contradicts, so a change to `T` that its shape no longer agrees with fails to compile. Fields of `T` the
 * shape doesn't name stay unchecked (`Shape`).
 */
export type ShapeOf<T> = unknown extends T ? Shape : KnownShapeOf<T>;
type KnownShapeOf<T> = DataCheck<T> | (string extends T ? 'string' : never) | (number extends T ? 'number' : never) | (boolean extends T ? 'boolean' : never) | ListShapeOf<T> | FieldsShapeOf<T>;
type ListShapeOf<T> = T extends readonly (infer Item)[] ? readonly [ShapeOf<Item>] : never;
type FieldsShapeOf<T> = T extends readonly unknown[] ? never : T extends object ? 'object' | {
    readonly [Key in keyof T]?: ShapeOf<T[Key]>;
} : never;
/** @returns A check that `value` is `null` or has the structure `shape` describes. */
export declare const orNull: <T>(shape: ShapeOf<T>) => DataCheck<T | null>;
/**
 * @returns A check that `data` has the structure `shape` describes. `ShapeOf` ties `shape` to `T`; fields `shape`
 *   doesn't name are `T`'s claim.
 */
export declare const shaped: <T>(shape: ShapeOf<T>) => DataCheck<T>;
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
export declare function endpoint(conf?: Pick<TetherConfig, 'domain' | 'apiVersion'>): string;
/**
 * The operation of a document Tether didn't write (`Tether.query()`, the server's `query()`). Outside strings and
 * comments, any `mutation` keyword makes it a mutation: a document that starts with a fragment still has its
 * operation found, and a misread errs on the side that is never sent twice.
 */
export declare function operationOf(document: string): Operation;
/**
 * `inContext` for any country and language, as the public `Tether.withContext` takes them: one that isn't a valid
 * code is left out, so page input never becomes query text.
 */
export declare function withContext(query: string, ctx?: {
    country?: string | undefined;
    language?: string | undefined;
}): string;
/**
 * Runs `send` with a signal that aborts it, the answer's body included, after `ms` milliseconds (`0`: never), as
 * `AbortSignal.timeout` would; Safari before 16 lacks that. A request that never settles would hold every cart change
 * queued behind it (`enqueue`) for as long as the browser keeps the connection open.
 */
export declare function withTimeout<T>(ms: number, send: (signal: AbortSignal | null) => Promise<T>): Promise<T>;
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
export declare function request<T>(conf: StorefrontConfig, query: QueryText, variables: Record<string, unknown>, isData: DataCheck<T>, { context, operation }?: RequestOptions): Promise<T>;
/** `request` with the browser's shared config. */
export declare function gql<T>(query: QueryText, variables: Record<string, unknown>, isData: DataCheck<T>, options?: RequestOptions): Promise<T>;
/** The check of `Tether.query()` and the server's `query()`, whose callers read `data` themselves. */
export declare const hasData: (data: unknown) => data is object;
/**
 * `Tether.query()` and the server's `query()`: a document Tether didn't write, sent with `conf`.
 *
 * @returns Shopify's `data`, checked only for being an object: the caller's own query decides its shape, so the caller
 *   checks the fields it reads.
 */
export declare function untypedQuery(conf: StorefrontConfig, text: string, variables?: Record<string, unknown>, options?: Omit<RequestOptions, 'operation'>): Promise<object>;
/** `Tether.query()`: `untypedQuery` with the browser's shared config. */
export declare function query(text: string, variables?: Record<string, unknown>, options?: Omit<RequestOptions, 'operation'>): Promise<object>;
/**
 * @param payload A mutation's payload.
 * @param name The mutation, for the error message.
 * @throws {TetherError} `ERROR` on an empty payload or on user errors (in `userErrors`).
 */
export declare function unwrap<Payload extends {
    userErrors?: readonly UserError[] | null;
}>(payload: Payload | null | undefined, name: string): Payload;
export {};
