/**
 * The customer's subscriptions (`tether-subscriptions`), with `tether-show="subscriptions-loading"`,
 * `subscriptions-empty` and `subscriptions-error`. Each row's `tether-subscription-show` conditions and action buttons
 * follow the contract's status and its next billing cycle.
 */
import { reportError } from '../config.ts';
import { attr, formatDate, formatMoney, get, qsa, repeat, sel, setImage, setText } from '../dom.ts';
import { bindsIn, enumText, ownValue, showIn } from './markup.ts';
import { subscriptions } from './operations.ts';
import type { SubscriptionContract, SubscriptionLine } from './page-answers.ts';

/** @returns The row's `tether-subscription-show` conditions, `can-<action>` among them. */
function conditionsOf(contract: SubscriptionContract): Record<string, boolean> {
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

/** @returns `month`, `3 months`; `''` without a delivery policy. */
function intervalText(contract: SubscriptionContract): string {
  const unit = enumText(contract.deliveryPolicy?.interval);
  if (!unit) return '';
  const count = contract.deliveryPolicy?.intervalCount?.count ?? 1;
  return count <= 1 ? unit : `${String(count)} ${unit}s`;
}

/** @returns The text of each `tether-subscription-bind` value. */
function contractTexts(contract: SubscriptionContract): Record<string, string> {
  const lines = contract.lines.nodes;
  const total = lines.reduce((sum, line) => sum + Number.parseFloat(line.lineDiscountedPrice?.amount ?? '0'), 0);
  return {
    status: enumText(contract.status),
    next: formatDate(contract.nextBillingDate),
    interval: intervalText(contract),
    products: lines.map((line) => `${String(line.quantity)}× ${line.title ?? ''}`).join(', '),
    total: formatMoney(
      lines.length && contract.currencyCode ? { amount: String(total), currencyCode: contract.currencyCode } : null,
    ),
    delivery: formatMoney(contract.deliveryPrice),
  };
}

function fillLine(row: HTMLElement, line: SubscriptionLine): void {
  const texts: Record<string, string> = {
    title: line.title ?? '',
    'variant-title': line.variantTitle || '',
    quantity: String(line.quantity),
    price: formatMoney(line.currentPrice),
  };
  bindsIn(row, 'subscription-line').forEach((el) => {
    const key = get(el, 'subscription-line') ?? '';
    if (key === 'image') {
      if (line.image) setImage(el, line.image.url, line.image.altText || line.title || '');
      return;
    }
    const text = ownValue(texts, key);
    if (text !== undefined) setText(el, text);
  });
}

function fillContract(row: HTMLElement, contract: SubscriptionContract): void {
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

/** Loads and renders the subscriptions. A failure is reported and shows `subscriptions-error`. */
export async function renderSubscriptions(root: ParentNode): Promise<void> {
  const boxes = qsa(root, sel('subscriptions'));
  if (!boxes.length) return;
  showIn(root, 'show', { 'subscriptions-loading': true, 'subscriptions-empty': false });
  let list: SubscriptionContract[];
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
