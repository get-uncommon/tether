/**
 * Arithmetic on Shopify's money amounts, which are decimal strings (`'27.50'`). Comparisons go digit by digit, as
 * integers of the smallest unit present, so two amounts that differ only past float precision aren't misjudged. Sums
 * and differences are taken in the currency's own smallest unit, so JPY stays whole and KWD keeps its three digits.
 */
/** @import { Money } from './shopify-values.js' */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * @param {string} amount
 * @param {number} fractionDigits Digits after the point to scale to.
 * @returns {bigint | null} The amount in units of 10^-fractionDigits, `null` when it isn't a decimal number.
 */
function toScaledInteger(amount, fractionDigits) {
  const match = DECIMAL.exec(amount.trim());
  if (!match) return null;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const digits = BigInt(`${whole}${fraction.padEnd(fractionDigits, '0')}`);
  return sign === '-' ? -digits : digits;
}

/** @param {string} amount */
const fractionLength = (amount) => amount.split('.')[1]?.length ?? 0;

/**
 * @param {string | null | undefined} amount
 * @param {string | null | undefined} other
 * @returns {boolean} True when both are decimal numbers and `amount` is the larger one.
 */
export function isGreaterAmount(amount, other) {
  if (amount == null || other == null) return false;
  const fractionDigits = Math.max(fractionLength(amount.trim()), fractionLength(other.trim()));
  const scaled = toScaledInteger(amount, fractionDigits);
  const scaledOther = toScaledInteger(other, fractionDigits);
  if (scaled === null || scaledOther === null) return false;
  return scaled > scaledOther;
}

/** For a currency code Intl doesn't know: most currencies have two digits, and `formatMoney` then shows two too. */
const DEFAULT_FRACTION_DIGITS = 2;

/** @type {Map<string, number>} Currency code → its fraction digits, which never change on a page. */
const fractionDigitsByCurrency = new Map();

/**
 * @param {string} currencyCode
 * @returns {number} The digits after the point the currency has: 0 for JPY, 2 for EUR, 3 for KWD.
 */
function currencyFractionDigits(currencyCode) {
  const known = fractionDigitsByCurrency.get(currencyCode);
  if (known !== undefined) return known;
  let digits = DEFAULT_FRACTION_DIGITS;
  try {
    const format = new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode });
    digits = format.resolvedOptions().maximumFractionDigits ?? DEFAULT_FRACTION_DIGITS;
  } catch {
    // A code Intl doesn't know (RangeError): see DEFAULT_FRACTION_DIGITS.
  }
  fractionDigitsByCurrency.set(currencyCode, digits);
  return digits;
}

/**
 * @param {Money} money
 * @returns {number} The amount in the currency's smallest unit (cents, yen, fils), rounded to a whole one.
 */
export function toMinorUnits(money) {
  return Math.round(parseFloat(money.amount) * 10 ** currencyFractionDigits(money.currencyCode));
}

/**
 * @param {number} minorUnits
 * @param {string} currencyCode
 * @returns {Money} The amount written with the currency's own number of digits.
 */
export function fromMinorUnits(minorUnits, currencyCode) {
  const digits = currencyFractionDigits(currencyCode);
  return { amount: (minorUnits / 10 ** digits).toFixed(digits), currencyCode };
}
