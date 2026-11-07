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
 * the Worker. Storage keeps the keys until a page removes them, and a visitor can return to a site after any length of
 * time, so no release can tell they are gone: this runs on every `init()` and stays until Tether stops supporting
 * upgrades from sites that last ran 0.6, which is a breaking change of its own.
 */
export declare function forgetBrowserModeTokens(): void;
export declare const isLoginOutcome: (value: string | null) => value is LoginOutcome;
export {};
