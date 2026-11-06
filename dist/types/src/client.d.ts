import type { TetherConfig } from './config.js';
export type TetherErrorCode = 'NOT_FOUND' | 'NETWORK' | 'NOT_CONFIGURED' | 'NOT_LOGGED_IN' | 'INVALID' | 'INVALID_COUNTRY' | 'INVALID_DISCOUNT' | 'ERROR' | `HTTP_${number}`;
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
    code?: TetherErrorCode;
    /** The HTTP status of the response that failed. */
    status?: number;
    /** The GraphQL errors of that response. */
    errors?: GraphQLError[];
    /** A mutation's user errors. */
    userErrors?: readonly UserError[];
}
export declare class TetherError extends Error {
    name: "TetherError";
    code: TetherErrorCode;
    status: number | undefined;
    errors: GraphQLError[] | undefined;
    userErrors: readonly UserError[] | undefined;
    constructor(message: string, { status, errors, userErrors, code }?: TetherErrorDetails);
}
/** What a request needs from a config: the browser's `cfg`, or a config the server helpers build. */
export type StorefrontConfig = Pick<TetherConfig, 'domain' | 'token' | 'apiVersion' | 'country' | 'language' | 'maxAge' | 'retries'> & {
    fetch?: typeof fetch;
};
/** Checks a query's `data` before its caller reads it as a `T`. */
export type DataCheck<T> = (data: unknown) => data is T;
/**
 * The structure of JSON a check accepts: a `typeof` name, `'object'` for a plain object, `[item]` for a list of
 * items, an object's fields, or a check of its own. Fields it doesn't name aren't checked, so a shape names only what
 * its reader walks without a fallback.
 */
export type Shape = 'string' | 'number' | 'boolean' | 'object' | ((value: unknown) => boolean) | readonly [Shape] | {
    readonly [key: string]: Shape;
};
/** @returns True when `value` has the structure `shape` describes. */
export declare function matches(value: unknown, shape: Shape): boolean;
/** @returns The shape of `null` or a value with the structure `shape` describes. */
export declare const orNull: (shape: Shape) => (value: unknown) => boolean;
/** @returns A check that `data` has the structure `shape` describes, which `T` states. */
export declare const shaped: <T>(shape: Shape) => DataCheck<T>;
/** `context: false` sends the query without `@inContext`. */
interface RequestOptions {
    context?: boolean;
}
/** What the store's token may read beyond the defaults. */
export interface StoreAccess {
    inventory: boolean;
}
/**
 * A query's text, or a function that writes it for what the token may read: Tether's own queries, built from
 * `fragments.ts`, leave out inventory for a token that can't read it.
 */
export type QueryText = string | ((access: StoreAccess) => string);
/** @returns The Storefront GraphQL endpoint of `conf`'s store. */
export declare function endpoint(conf?: Pick<TetherConfig, 'domain' | 'apiVersion'>): string;
/**
 * `inContext` for any country and language, as the public `Tether.withContext` takes them: one that isn't a valid
 * code is left out, so page input never becomes query text.
 */
export declare function withContext(query: string, ctx?: {
    country?: string | undefined;
    language?: string | undefined;
}): string;
/**
 * One Storefront API request, for any config: the browser's shared one (`gql`) or one the server helpers build.
 * Queries carry a time bucket so Shopify's cache of an identical query text is at most `maxAge` seconds old. A query
 * written for the store's access leaves out inventory once the token turns out not to read it (`INVENTORY_FIELD`);
 * a fixed query text is the caller's own, and that refusal is its error.
 *
 * @param isData Checks that `data` has what the caller then reads, so a malformed answer fails here.
 * @throws {TetherError} `NOT_CONFIGURED` without a domain or token, `NETWORK` when the store can't be reached,
 *   `HTTP_<status>` for an HTTP or GraphQL failure, or for `data` that `isData` refuses.
 */
export declare function request<T>(conf: StorefrontConfig, query: QueryText, variables: Record<string, unknown>, isData: DataCheck<T>, { context }?: RequestOptions): Promise<T>;
/** `request` with the browser's shared config. */
export declare function gql<T>(query: QueryText, variables: Record<string, unknown>, isData: DataCheck<T>, options?: RequestOptions): Promise<T>;
/** The check of `Tether.query()` and the server's `query()`, whose callers read `data` themselves. */
export declare const hasData: (data: unknown) => data is object;
/** `Tether.query()`: the caller's own query text decides the shape of `data`, and the caller's `T` states it. */
export declare function query<T>(text: QueryText, variables?: Record<string, unknown>, options?: RequestOptions): Promise<T>;
/**
 * @param payload A mutation's payload.
 * @param name The mutation, for the error message.
 * @throws {TetherError} `ERROR` on an empty payload or on user errors (in `userErrors`).
 */
export declare function unwrap<Payload extends {
    userErrors?: readonly UserError[] | null;
}>(payload: Payload | null | undefined, name: string): Payload;
export {};
