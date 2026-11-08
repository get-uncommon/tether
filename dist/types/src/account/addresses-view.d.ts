import type { CustomerAddress } from './page-answers.js';
/** @returns The address with this id in the list shown last. */
export declare const shownAddress: (id: string) => CustomerAddress | undefined;
/** Loads and renders the addresses. A failure is reported and shows `addresses-error`, never "no addresses yet". */
export declare function renderAddresses(root: ParentNode): Promise<void>;
