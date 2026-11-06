/**
 * The core's side of customer accounts, which are an optional part: whether a page needs the part, and
 * `Tether.account`, whose functions load it on first call. Every function returns a promise, the part's own sync ones
 * (`isLoggedIn`) too, because the part may still have to load.
 */
import { cfg, reportError } from './config.js';
import { attr } from './dom.js';
import { loadPart } from './lazy.js';
import { within } from './mounting.js';
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
 * Whether this browser keeps an account session or the hint of one, so a page without account markup still finishes
 * a login. Storage throws where the browser blocks it, and then there is no session.
 *
 * @returns {boolean}
 */
function hasSavedSession() {
  const sessionKey = `${cfg.prefix}:account:${cfg.domain}`;
  const hintKey = `${cfg.prefix}:account-hint:${cfg.domain}`;
  try {
    return Boolean(
      sessionStorage.getItem(sessionKey) || localStorage.getItem(sessionKey) || localStorage.getItem(hintKey),
    );
  } catch {
    return false;
  }
}

/**
 * Loads the account part and mounts it on `root`, when accounts are configured and the page needs them: account
 * markup in `root`, a login coming back from Shopify (`?code=`), or a saved session.
 *
 * @param {ParentNode} root
 */
export function mountAccountIfUsed(root) {
  if (!cfg.account?.clientId && !cfg.account?.server) return;
  const needed =
    within(root, accountSelector()).length > 0 || /[?&]code=/.test(window.location.search) || hasSavedSession();
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
