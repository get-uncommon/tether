import type { AccountCustomer } from './answers.js';
/** The Worker's answer, or a 401: the session cookie is missing, has expired, or Shopify ended the login. */
export type ServerAnswer = {
    kind: 'answer';
    data: Record<string, unknown>;
} | {
    kind: 'logged-out';
};
type ServerLogin = {
    loggedIn: true;
    customer: AccountCustomer;
} | {
    loggedIn: false;
};
export interface ServerRequest {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
}
/**
 * One request to the Worker, with the session cookie. A POST carries the header the Worker requires against
 * cross-site forms.
 *
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`, `INVALID` for refused input, `HTTP_<status>` for
 *   any other failure but a 401, with the Worker's `userErrors`; `NETWORK` when the Worker can't be reached or takes
 *   longer than `requestTimeout`.
 */
export declare function serverFetch(path: string, { method, body }?: ServerRequest): Promise<ServerAnswer>;
/**
 * Who is logged in, asked once (callers at the same time share the request) and then kept; the "may be logged in"
 * hint follows the answer. An answer to a request sent before a logout or a change of the customer's data can be
 * from before it: it is dropped, and the Worker asked again.
 *
 * @throws {TetherError} When the Worker can't be reached or fails: that says nothing about the login.
 */
export declare function serverLogin(): Promise<ServerLogin>;
/** @returns True when the Worker last said a customer is logged in. */
export declare const isServerLoggedIn: () => boolean;
/** Asks the Worker again on the next `serverLogin()`, after a change of the customer's data. */
export declare function forgetServerLogin(): void;
/**
 * To the Worker's login, which comes back to `returnTo` with `?account=<outcome>`. The cart is linked later, at
 * checkout, through the Worker's protected `POST /cart`.
 *
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
export declare function serverLoginRedirect({ returnTo, locale }: {
    returnTo: string;
    locale?: string | undefined;
}): void;
/**
 * The logged-in customer's checkout, for `Cart.setCheckoutResolver`: the Worker links the cart to the customer and
 * answers with its checkout URL.
 *
 * @returns `null` when nobody is logged in or the Worker linked no cart, so the cart's own checkout URL is used.
 * @throws {TetherError} When the Worker fails; the cart reports it and checks out without the login.
 */
export declare function serverCheckoutUrl(): Promise<string | null>;
/**
 * Ends the session at the Worker, which also unlinks the cart, then goes on to Shopify's logout when the Worker says
 * where. Sends `tether:account-logout`.
 */
export declare function serverLogout(returnTo: string): Promise<'redirected' | 'stayed'>;
export {};
