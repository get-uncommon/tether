/**
 * Arithmetic on Shopify's money amounts, which are decimal strings (`'27.50'`). Comparisons go digit by digit, as
 * integers of the smallest unit present, so two amounts that differ only past float precision aren't misjudged. Sums
 * and differences are taken in the currency's own smallest unit, so JPY stays whole and KWD keeps its three digits.
 */
import type { Money } from './shopify-values.js';
/** @returns True when both are decimal numbers and `amount` is the larger one. */
export declare function isGreaterAmount(amount: string | null | undefined, other: string | null | undefined): boolean;
/** @returns The amount in the currency's smallest unit (cents, yen, fils), rounded to a whole one. */
export declare function toMinorUnits(money: Money): number;
/** @returns The amount written with the currency's own number of digits. */
export declare function fromMinorUnits(minorUnits: number, currencyCode: string): Money;
