import type { Parts } from './lazy.js';
type AccountPart = Parts['account'];
type AccountResult<Name extends keyof AccountPart> = Awaited<ReturnType<AccountPart[Name]>>;
type AccountFunction<Name extends keyof AccountPart> = (...args: Parameters<AccountPart[Name]>) => Promise<AccountResult<Name>>;
type AccountApi = {
    [Name in keyof AccountPart]: AccountFunction<Name>;
};
/**
 * Loads the account part and mounts it on `root`, when accounts are configured and the page needs them: account
 * markup in `root`, a login coming back from the Worker (`?account=`), or the "may be logged in" hint.
 */
export declare function mountAccountIfUsed(root: ParentNode): void;
/**
 * `Tether.account`: the account part's functions, each loading the part on first call. A plain object, so `await
 * Tether.account` and `Object.keys(Tether.account)` behave as for any object.
 */
export declare const accountApi: AccountApi;
export {};
