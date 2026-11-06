/**
 * The core's side of customer accounts, which are an optional part: whether a page needs the part, and
 * `Tether.account`, whose functions load it on first call. Every function returns a promise, the part's own sync ones
 * (`isLoggedIn`) too, because the part may still have to load.
 */
import { cfg, reportError } from './config.js';
import { attr } from './dom.js';
import { loadPart } from './lazy.js';
import { within } from './mounting.js';
import { hintKey, isLoginOutcome, pendingLoginKey, sessionKey } from './account-marks.js';
/** @import { Parts } from './lazy.js' */

/** @typedef {Parts['account']} AccountPart */
/**
 * @template {keyof AccountPart} Name
 * @typedef {Awaited<ReturnType<AccountPart[Name]>>} AccountResult
 */
/**
 * @template {keyof AccountPart} Name
 * @typedef {(...args: Parameters<AccountPart[Name]>) => Promise<AccountResult<Name>>} AccountFunction
 */
/** @typedef {{ [Name in keyof AccountPart]: AccountFunction<Name> }} AccountApi */

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

/** @returns {string} A selector for every element the account part fills in or shows. */
const accountSelector = () =>
  [...ACCOUNT_ATTRIBUTES.map((name) => `[${attr(name)}]`), `[${attr('show')}^="logged-"]`].join(',');

/**
 * @param {'session' | 'local'} area
 * @param {string} key
 * @returns {boolean} True when `area` holds `key`; false where the browser blocks storage, which then holds nothing.
 */
function isStoredIfAllowed(area, key) {
  try {
    return Boolean((area === 'local' ? localStorage : sessionStorage).getItem(key));
  } catch {
    return false;
  }
}

/**
 * Whether this browser keeps an account session or the hint of one, so checkout on a page without account markup
 * still knows the customer.
 *
 * @returns {boolean}
 */
function hasSavedSession() {
  return (
    isStoredIfAllowed('session', sessionKey()) ||
    isStoredIfAllowed('local', sessionKey()) ||
    isStoredIfAllowed('local', hintKey())
  );
}

/**
 * Whether this page is a login coming back: in server mode the Worker's `?account=` mark, in browser mode Shopify's
 * answer (`?state=` with `code` or `error`) to a login this tab started. A `?code=` alone is often something else,
 * such as a discount link, and doesn't load the part.
 *
 * @param {URLSearchParams} params The page's query.
 * @returns {boolean}
 */
function isLoginCallback(params) {
  if (cfg.account?.server) return isLoginOutcome(params.get('account'));
  const answered = params.has('state') && (params.has('code') || params.has('error'));
  return answered && isStoredIfAllowed('session', pendingLoginKey());
}

/**
 * Loads the account part and mounts it on `root`, when accounts are configured and the page needs them: account
 * markup in `root`, a login coming back (`isLoginCallback`), or a saved session.
 *
 * @param {ParentNode} root
 */
export function mountAccountIfUsed(root) {
  if (!cfg.account?.clientId && !cfg.account?.server) return;
  const needed =
    within(root, accountSelector()).length > 0 ||
    isLoginCallback(new URLSearchParams(window.location.search)) ||
    hasSavedSession();
  if (!needed) return;
  loadPart('account')
    .then((part) => part.mountAccount(root))
    .catch((/** @type {unknown} */ error) => {
      reportError(error, 'account');
    });
}

/**
 * @template {keyof AccountPart} Name
 * @param {Name} name
 * @returns {AccountFunction<Name>} `name` of the account part, called once the part has loaded.
 */
function fromPart(name) {
  return (...args) =>
    loadPart('account').then((part) => {
      // `Name` picks one function of the part, and `args` are that function's parameters.
      const call =
        /**
         * @type {(...callArgs: Parameters<AccountPart[Name]>) => AccountResult<Name> | PromiseLike<AccountResult<Name>>}
         */ (part[name]);
      return call(...args);
    });
}

/**
 * `Tether.account`: the account part's functions, each loading the part on first call. A plain object, so `await
 * Tether.account` and `Object.keys(Tether.account)` behave as for any object.
 *
 * @type {AccountApi}
 */
export const accountApi = {
  login: fromPart('login'),
  logout: fromPart('logout'),
  handleCallback: fromPart('handleCallback'),
  getToken: fromPart('getToken'),
  isLoggedIn: fromPart('isLoggedIn'),
  query: fromPart('query'),
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
