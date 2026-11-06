/**
 * The customer's addresses (`tether-addresses`), with `tether-show="addresses-loading"`, `addresses-empty` and
 * `addresses-error`. The last list rendered is kept, so an edit button can fill the address form from it.
 */
import { reportError } from '../config.ts';
import { get, qsa, repeat, sel, setText } from '../dom.ts';
import { addressText, bindsIn, ownValue, showIn } from './markup.ts';
import { addresses } from './operations.ts';
import type { CustomerAddress } from './page-answers.ts';

let shown: readonly CustomerAddress[] = [];

/** @returns The address with this id in the list shown last. */
export const shownAddress = (id: string): CustomerAddress | undefined => shown.find((address) => address.id === id);

/** @returns The text of each `tether-address-bind` value. */
const addressTexts = (address: CustomerAddress): Record<string, string> => ({
  formatted: addressText(address),
  name: [address.firstName, address.lastName].filter(Boolean).join(' '),
  company: address.company || '',
  address1: address.address1 || '',
  address2: address.address2 || '',
  city: address.city || '',
  zip: address.zip || '',
  province: address.province || '',
  country: address.country || '',
  phone: address.phoneNumber || '',
});

function fillAddress(row: HTMLElement, address: CustomerAddress): void {
  row.dataset['tetherAddress'] = address.id;
  const texts = addressTexts(address);
  bindsIn(row, 'address-bind').forEach((el) => {
    const text = ownValue(texts, get(el, 'address-bind') ?? '');
    if (text !== undefined) setText(el, text);
  });
  showIn(row, 'address-show', { default: address.isDefault, 'not-default': !address.isDefault });
}

/** Loads and renders the addresses. A failure is reported and shows `addresses-error`, never "no addresses yet". */
export async function renderAddresses(root: ParentNode): Promise<void> {
  const boxes = qsa(root, sel('addresses'));
  if (!boxes.length) return;
  showIn(root, 'show', { 'addresses-loading': true, 'addresses-empty': false });
  let list: CustomerAddress[];
  try {
    list = await addresses();
  } catch (error) {
    reportError(error, 'addresses');
    showIn(root, 'show', { 'addresses-loading': false, 'addresses-error': true });
    return;
  }
  shown = list;
  showIn(root, 'show', { 'addresses-loading': false, 'addresses-empty': list.length === 0, 'addresses-error': false });
  boxes.forEach((box) => {
    repeat(box, list, fillAddress);
  });
}
