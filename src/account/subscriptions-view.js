/**
 * The customer's subscriptions (`tether-subscriptions`), with `tether-show="subscriptions-loading"`,
 * `subscriptions-empty` and `subscriptions-error`. Each row's `tether-subscription-show` conditions and action buttons
 * follow the contract's status and its next billing cycle.
 */
import { reportError } from '../config.js';
import { attr, formatMoney, get, qsa, repeat, sel, setImage, setText } from '../dom.js';
import { bindsIn, enumText, ownValue, showIn } from './markup.js';
import { subscriptions } from './operations.js';
import { localDate } from '../account-links.js';
/** @import { Money } from '../shopify-values.js' */

/**
 * @typedef {object} SubscriptionLine
 * @property {string} title
 * @property {string | null} variantTitle
 * @property {number} quantity
 * @property {Money} currentPrice
 * @property {Money | null} lineDiscountedPrice
 * @property {{ url: string, altText: string | null } | null} image
 */
/**
 * @typedef {object} SubscriptionContract The subscriptions document in account-ops.js.
 * @property {string} id
 * @property {'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED' | 'FAILED'} status
 * @property {string | null} nextBillingDate
 * @property {string} currencyCode
 * @property {Money | null} deliveryPrice
 * @property {{ interval: string | null, intervalCount: { count: number } | null } | null} deliveryPolicy
 * @property {{ nodes: SubscriptionLine[] }} lines
 * @property {{ nodes: { cycleIndex: number, skipped: boolean }[] }} upcomingBillingCycles
 */

/**
 * @param {SubscriptionContract} contract
 * @returns {Record<string, boolean>} The row's `tether-subscription-show` conditions, `can-<action>` among them.
 */
function conditionsOf(contract) {
  const next = contract.upcomingBillingCycles.nodes[0];
  const status = contract.status;
  const active = status === 'ACTIVE';
  return {
    active,
    paused: status === 'PAUSED',
    cancelled: status === 'CANCELLED',
    expired: status === 'EXPIRED',
    failed: status === 'FAILED',
    skipped: Boolean(next?.skipped),
    'can-pause': active,
    'can-resume': status === 'PAUSED' || status === 'FAILED',
    'can-skip': active && next !== undefined && !next.skipped,
    'can-unskip': active && Boolean(next?.skipped),
    'can-cancel': active || status === 'PAUSED' || status === 'FAILED',
  };
}

/**
 * @param {SubscriptionContract} contract
 * @returns {string} `month`, `3 months`; `''` without a delivery policy.
 */
function intervalText(contract) {
  const unit = enumText(contract.deliveryPolicy?.interval);
  if (!unit) return '';
  const count = contract.deliveryPolicy?.intervalCount?.count ?? 1;
  return count <= 1 ? unit : `${count} ${unit}s`;
}

/**
 * @param {SubscriptionContract} contract
 * @returns {Record<string, string>} The text of each `tether-subscription-bind` value.
 */
function contractTexts(contract) {
  const lines = contract.lines.nodes;
  const total = lines.reduce((sum, line) => sum + Number.parseFloat(line.lineDiscountedPrice?.amount ?? '0'), 0);
  return {
    status: enumText(contract.status),
    next: contract.nextBillingDate ? localDate(contract.nextBillingDate) : '',
    interval: intervalText(contract),
    products: lines.map((line) => `${line.quantity}× ${line.title}`).join(', '),
    total: lines.length ? formatMoney({ amount: String(total), currencyCode: contract.currencyCode }) : '',
    delivery: formatMoney(contract.deliveryPrice),
  };
}

/**
 * @param {HTMLElement} row
 * @param {SubscriptionLine} line
 */
function fillLine(row, line) {
  /** @type {Record<string, string>} */
  const texts = {
    title: line.title,
    'variant-title': line.variantTitle || '',
    quantity: String(line.quantity),
    price: formatMoney(line.currentPrice),
  };
  bindsIn(row, 'subscription-line').forEach((el) => {
    const key = get(el, 'subscription-line') ?? '';
    if (key === 'image') {
      if (line.image) setImage(el, line.image.url, line.image.altText || line.title);
      return;
    }
    const text = ownValue(texts, key);
    if (text !== undefined) setText(el, text);
  });
}

/**
 * @param {HTMLElement} row
 * @param {SubscriptionContract} contract
 */
function fillContract(row, contract) {
  row.dataset['tetherSubscription'] = contract.id;
  row.setAttribute(attr('subscription-status'), enumText(contract.status));
  const texts = contractTexts(contract);
  qsa(row, sel('subscription-bind')).forEach((el) => {
    const text = ownValue(texts, get(el, 'subscription-bind') ?? '');
    if (text !== undefined) setText(el, text);
  });
  qsa(row, sel('subscription-lines')).forEach((box) => {
    repeat(box, contract.lines.nodes, fillLine);
  });
  const conditions = conditionsOf(contract);
  showIn(row, 'subscription-show', conditions);
  qsa(row, sel('subscription-action')).forEach((button) => {
    const allowed = ownValue(conditions, `can-${get(button, 'subscription-action') ?? ''}`) === true;
    if ('disabled' in button) button.disabled = !allowed;
    button.classList.toggle('is-disabled', !allowed);
  });
}

/**
 * Loads and renders the subscriptions. A failure is reported and shows `subscriptions-error`.
 *
 * @param {ParentNode} root
 */
export async function renderSubscriptions(root) {
  const boxes = qsa(root, sel('subscriptions'));
  if (!boxes.length) return;
  showIn(root, 'show', { 'subscriptions-loading': true, 'subscriptions-empty': false });
  /** @type {SubscriptionContract[]} */
  let list;
  try {
    list = await subscriptions();
  } catch (error) {
    reportError(error, 'subscriptions');
    showIn(root, 'show', { 'subscriptions-loading': false, 'subscriptions-error': true });
    return;
  }
  showIn(root, 'show', {
    'subscriptions-loading': false,
    'subscriptions-empty': list.length === 0,
    'subscriptions-error': false,
  });
  boxes.forEach((box) => {
    repeat(box, list, fillContract);
  });
}
