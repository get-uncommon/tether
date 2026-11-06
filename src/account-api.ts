/**
 * The core's side of customer accounts, which are an optional part: whether a page needs the part, and
 * `Tether.account`, whose functions load it on first call. Every function returns a promise, the part's own sync ones
 * (`isLoggedIn`) too, because the part may still have to load.
 */
import { cfg, reportError } from './config.ts';
import { attr } from './dom.ts';
import { loadPart } from './lazy.ts';
import { within } from './mounting.ts';
import { hintKey, isLoginOutcome } from './account-marks.ts';
import { getStored } from './storage.ts';
import type { Parts } from './lazy.ts';

type AccountPart = Parts['account'];
type AccountResult<Name extends keyof AccountPart> = Awaited<ReturnType<AccountPart[Name]>>;
type AccountFunction<Name extends keyof AccountPart> = (
  ...args: Parameters<AccountPart[Name]>
) => Promise<AccountResult<Name>>;
type AccountApi = { [Name in keyof AccountPart]: AccountFunction<Name> };

/** The attributes of the account markup: a page with one of them loads the part. */
const ACCOUNT_ATTRIBUTES = [
  'account-login',
  'account-bind',
  'account-link',
  'orders',
  'order',
  'addresses',
  'subscriptions',
  'profile-form',
  'address-form',
];

/** @returns A selector for every element the account part fills in or shows. */
const accountSelector = (): string =>
  [...ACCOUNT_ATTRIBUTES.map((name) => `[${attr(name)}]`), `[${attr('show')}^="logged-"]`].join(',');

/**
 * Whether this browser keeps the "may be logged in" hint, so checkout on a page without account markup still knows
 * the customer.
 *
 * @returns False where the browser blocks storage, which then holds no hint.
 */
function hasLoginHint(): boolean {
  return Boolean(getStored(hintKey()));
}

/**
 * Loads the account part and mounts it on `root`, when accounts are configured and the page needs them: account
 * markup in `root`, a login coming back from the Worker (`?account=`), or the "may be logged in" hint.
 */
export function mountAccountIfUsed(root: ParentNode): void {
  if (!cfg.account) return;
  const needed =
    within(root, accountSelector()).length > 0 ||
    isLoginOutcome(new URLSearchParams(window.location.search).get('account')) ||
    hasLoginHint();
  if (!needed) return;
  loadPart('account')
    .then((part) => part.mountAccount(root))
    .catch((error: unknown) => {
      reportError(error, 'account');
    });
}

/** @returns `name` of the account part, called once the part has loaded. */
function fromPart<Name extends keyof AccountPart>(name: Name): AccountFunction<Name> {
  return (...args) =>
    loadPart('account').then((part) => {
      // `Name` picks one function of the part, and `args` are that function's parameters.
      const call = part[name] as (
        ...callArgs: Parameters<AccountPart[Name]>
      ) => AccountResult<Name> | PromiseLike<AccountResult<Name>>;
      return call(...args);
    });
}

/**
 * `Tether.account`: the account part's functions, each loading the part on first call. A plain object, so `await
 * Tether.account` and `Object.keys(Tether.account)` behave as for any object.
 */
export const accountApi: AccountApi = {
  login: fromPart('login'),
  logout: fromPart('logout'),
  isLoggedIn: fromPart('isLoggedIn'),
  customer: fromPart('customer'),
  orders: fromPart('orders'),
  order: fromPart('order'),
  updateProfile: fromPart('updateProfile'),
  addresses: fromPart('addresses'),
  saveAddress: fromPart('saveAddress'),
  deleteAddress: fromPart('deleteAddress'),
  subscriptions: fromPart('subscriptions'),
  subscriptionAction: fromPart('subscriptionAction'),
  requestReturn: fromPart('requestReturn'),
  render: fromPart('render'),
  mountAccount: fromPart('mountAccount'),
};
