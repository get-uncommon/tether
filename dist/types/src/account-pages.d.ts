export { setup, order, updateProfile, addresses, saveAddress, deleteAddress, subscriptions, subscriptionAction, requestReturn, } from './account/operations.js';
/** Renders the order page, profile form, addresses and subscriptions in `root`: only what it has. */
export declare function renderPages(root?: ParentNode): Promise<void>;
/**
 * The error state of every account page in `root`, for when nobody can say whether a customer is logged in (the
 * Worker or Shopify can't be reached).
 */
export declare function showUnavailable(root: ParentNode): void;
