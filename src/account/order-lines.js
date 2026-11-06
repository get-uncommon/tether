/**
 * The products of an order (`tether-order-lines`), for the order list and the order page alike. The order page's
 * lines also carry price, total, sku and what can be returned; the order list's document has none of those, so they
 * render empty there, and its rows get no return controls.
 */
import { formatMoney, get, qsa, repeat, sel, setImage, setText } from '../dom.js';
import { bindsIn, ownValue, showIn } from './markup.js';
/** @import { AccountOrderLine } from './answers.js' */
/** @import { OrderDetailLine } from './page-answers.js' */

/**
 * @typedef {AccountOrderLine
 *   & Partial<Pick<OrderDetailLine, 'id' | 'name' | 'sku' | 'price' | 'totalPrice' | 'suggestedReturnReasonDefinitions'>>}
 *   OrderLine A line of the order list, or of the order page, which has the fields after `image` too.
 */
/** @typedef {ReadonlyMap<string, number>} Returnable Line id → how many of it can still be returned. */

/**
 * @param {OrderLine} line
 * @param {number | null} returnable `null` in the order list, which knows nothing of returns.
 * @returns {Record<string, string | undefined>} The text of each `tether-order-line` value.
 */
const lineTexts = (line, returnable) => ({
  title: line.title || line.name || '',
  'variant-title': line.variantTitle || '',
  quantity: String(line.quantity),
  price: formatMoney(line.price),
  total: formatMoney(line.totalPrice),
  sku: line.sku || '',
  returnable: returnable === null ? undefined : String(returnable),
});

/**
 * @param {HTMLElement} el
 * @returns {el is HTMLInputElement}
 */
const isInput = (el) => el.tagName === 'INPUT';

/**
 * The return controls of one line: how many can be returned, and Shopify's suggested reasons.
 *
 * @param {HTMLElement} row
 * @param {OrderLine & { id: string }} line
 * @param {number} returnable
 */
function fillReturnControls(row, line, returnable) {
  showIn(row, 'order-line-show', { returnable: returnable > 0 });
  qsa(row, sel('return-quantity')).forEach((input) => {
    if (!isInput(input)) return;
    input.max = String(returnable);
    input.min = '0';
    if (!input.value) input.value = '0';
    input.disabled = returnable < 1;
  });
  qsa(row, `select${sel('return-reason')}`).forEach((select) => {
    // A select keeps its options across renders of the same line: they are added once.
    if (select.dataset['tetherFilled'] === line.id) return;
    select.dataset['tetherFilled'] = line.id;
    (line.suggestedReturnReasonDefinitions?.nodes ?? []).forEach((reason) => {
      select.appendChild(new Option(reason.name ?? '', reason.id));
    });
  });
}

/**
 * Renders `lines` into a `tether-order-lines` repeater.
 *
 * @param {HTMLElement} box
 * @param {readonly OrderLine[]} lines
 * @param {Returnable | null} returns `null` for the order list.
 */
export function fillLines(box, lines, returns) {
  repeat(box, lines, (row, line) => {
    const id = line.id;
    const returnable = returns && id ? (returns.get(id) ?? 0) : null;
    if (id) row.dataset['tetherLine'] = id;
    const texts = lineTexts(line, returnable);
    bindsIn(row, 'order-line').forEach((el) => {
      const key = get(el, 'order-line') ?? '';
      if (key === 'image') {
        if (line.image) setImage(el, line.image.url, line.image.altText || line.title || '');
        return;
      }
      const text = ownValue(texts, key);
      if (text !== undefined) setText(el, text);
    });
    if (id && returnable !== null) fillReturnControls(row, { ...line, id }, returnable);
  });
}
