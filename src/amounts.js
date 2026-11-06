/**
 * Shopify sends money amounts as decimal strings (`'27.50'`). Comparing them as floats can misjudge two amounts that
 * differ only past float precision, so they are compared digit by digit, as integers of the smallest unit present.
 */

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
