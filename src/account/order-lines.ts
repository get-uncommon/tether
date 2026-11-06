/**
 * The products of an order (`tether-order-lines`), for the order list and the order page alike. The order page's
 * lines also carry price, total, sku and what can be returned; the order list's document has none of those, so they
 * render empty there, and its rows get no return controls.
 */
import { formatMoney, get, qsa, repeat, sel, setImage, setText } from '../dom.ts';
import { bindsIn, ownValue, showIn } from './markup.ts';
import type { AccountOrderLine } from '../../server/src/shared/account-orders.ts';
import type { OrderDetailLine } from './page-answers.ts';

/** A line of the order list, or of the order page, which has the fields after `image` too. */
type OrderLine = AccountOrderLine &
  Partial<Pick<OrderDetailLine, 'id' | 'name' | 'sku' | 'price' | 'totalPrice' | 'suggestedReturnReasonDefinitions'>>;
/** Line id → how many of it can still be returned. */
type Returnable = ReadonlyMap<string, number>;

/**
 * @param returnable `null` in the order list, which knows nothing of returns.
 * @returns The text of each `tether-order-line` value.
 */
const lineTexts = (line: OrderLine, returnable: number | null): Record<string, string | undefined> => ({
  title: line.title || line.name || '',
  'variant-title': line.variantTitle || '',
  quantity: String(line.quantity),
  price: formatMoney(line.price),
  total: formatMoney(line.totalPrice),
  sku: line.sku || '',
  returnable: returnable === null ? undefined : String(returnable),
});

const isInput = (el: HTMLElement): el is HTMLInputElement => el.tagName === 'INPUT';

/** The return controls of one line: how many can be returned, and Shopify's suggested reasons. */
function fillReturnControls(row: HTMLElement, line: OrderLine & { id: string }, returnable: number): void {
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
 * @param returns `null` for the order list.
 */
export function fillLines(box: HTMLElement, lines: readonly OrderLine[], returns: Returnable | null): void {
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
