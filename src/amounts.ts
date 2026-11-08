/**
 * Arithmetic on Shopify's money amounts, which are decimal strings (`'27.50'`). Comparisons go digit by digit, as
 * integers of the smallest unit present, so two amounts that differ only past float precision aren't misjudged. Sums
 * and differences are taken in the currency's own smallest unit, so JPY stays whole and KWD keeps its three digits.
 */
import type { Money } from './shopify-values.ts';

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * @param fractionDigits Digits after the point to scale to.
 * @returns The amount in units of 10^-fractionDigits, `null` when it isn't a decimal number.
 */
function toScaledInteger(amount: string, fractionDigits: number): bigint | null {
  const match = DECIMAL.exec(amount.trim());
  if (!match) return null;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const digits = BigInt(`${whole}${fraction.padEnd(fractionDigits, '0')}`);
  return sign === '-' ? -digits : digits;
}

const fractionLength = (amount: string) => amount.split('.')[1]?.length ?? 0;

/** @returns True when both are decimal numbers and `amount` is the larger one. */
export function isGreaterAmount(amount: string | null | undefined, other: string | null | undefined): boolean {
  if (amount == null || other == null) return false;
  const fractionDigits = Math.max(fractionLength(amount.trim()), fractionLength(other.trim()));
  const scaled = toScaledInteger(amount, fractionDigits);
  const scaledOther = toScaledInteger(other, fractionDigits);
  if (scaled === null || scaledOther === null) return false;
  return scaled > scaledOther;
}

/** For a currency code Intl doesn't know: most currencies have two digits, and `formatMoney` then shows two too. */
const DEFAULT_FRACTION_DIGITS = 2;

/** Currency code → its fraction digits, which never change on a page. */
const fractionDigitsByCurrency = new Map<string, number>();

/** @returns The digits after the point the currency has: 0 for JPY, 2 for EUR, 3 for KWD. */
function currencyFractionDigits(currencyCode: string): number {
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

/** @returns The amount in the currency's smallest unit (cents, yen, fils), rounded to a whole one. */
export function toMinorUnits(money: Money): number {
  return Math.round(parseFloat(money.amount) * 10 ** currencyFractionDigits(money.currencyCode));
}

/** @returns The amount written with the currency's own number of digits. */
export function fromMinorUnits(minorUnits: number, currencyCode: string): Money {
  const digits = currencyFractionDigits(currencyCode);
  return { amount: (minorUnits / 10 ** digits).toFixed(digits), currencyCode };
}
