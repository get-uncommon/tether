/**
 * The customer's addresses (`tether-addresses`), with `tether-show="addresses-loading"`, `addresses-empty` and
 * `addresses-error`. The last list rendered is kept, so an edit button can fill the address form from it.
 */
import { reportError } from '../config.js';
import { get, qsa, repeat, sel, setText } from '../dom.js';
import { addressText, bindsIn, ownValue, showIn } from './markup.js';
import { addresses } from './operations.js';

/**
 * @typedef {object} CustomerAddress An address of account-ops.js's documents, with `isDefault` added.
 * @property {string} id
 * @property {string | null} firstName
 * @property {string | null} lastName
 * @property {string | null} company
 * @property {string | null} address1
 * @property {string | null} address2
 * @property {string | null} city
 * @property {string | null} province
 * @property {string | null} zoneCode
 * @property {string | null} zip
 * @property {string | null} country
 * @property {string | null} countryCode
 * @property {string | null} phoneNumber
 * @property {string[]} formatted
 * @property {boolean} isDefault
 */

/** @type {readonly CustomerAddress[]} */
let shown = [];

/**
 * @param {string} id
 * @returns {CustomerAddress | undefined} The address with this id in the list shown last.
 */
export const shownAddress = (id) => shown.find((address) => address.id === id);

/**
 * @param {CustomerAddress} address
 * @returns {Record<string, string>} The text of each `tether-address-bind` value.
 */
const addressTexts = (address) => ({
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

/**
 * @param {HTMLElement} row
 * @param {CustomerAddress} address
 */
function fillAddress(row, address) {
  row.dataset['tetherAddress'] = address.id;
  const texts = addressTexts(address);
  bindsIn(row, 'address-bind').forEach((el) => {
    const text = ownValue(texts, get(el, 'address-bind') ?? '');
    if (text !== undefined) setText(el, text);
  });
  showIn(row, 'address-show', { default: address.isDefault, 'not-default': !address.isDefault });
}

/**
 * Loads and renders the addresses. A failure is reported and shows `addresses-error`, never "no addresses yet".
 *
 * @param {ParentNode} root
 */
export async function renderAddresses(root) {
  const boxes = qsa(root, sel('addresses'));
  if (!boxes.length) return;
  showIn(root, 'show', { 'addresses-loading': true, 'addresses-empty': false });
  /** @type {CustomerAddress[]} */
  let list;
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
