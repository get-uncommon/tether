/**
 * What the Worker's login redirect says in `?account=`: `in` after a login, `expired` when the login took too long,
 * `error` when it failed.
 */
type LoginOutcome = 'in' | 'expired' | 'error';
/** The "may be logged in" hint's key: it makes the core load the part on the next page, and holds no secret. */
export declare const hintKey: () => string;
/**
 * Removes the customer tokens and pending login that Tether 0.6's browser-mode accounts kept in this browser. The
 * session held a refresh token with the customer's full scope, so it must not stay behind once accounts run through
 * the Worker. TODO: remove in 0.8.0, when no visitor's browser still holds a 0.6 session.
 */
export declare function forgetBrowserModeTokens(): void;
export declare const isLoginOutcome: (value: string | null) => value is LoginOutcome;
export {};
