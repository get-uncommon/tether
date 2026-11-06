/**
 * The `window` globals the specs read inside `page.evaluate`: what the pages, Shopify's scripts and the specs' own init
 * scripts set. The ones a script sets after the page loads are optional, since a spec polls for them.
 */

interface DataLayerEntry {
  event?: string;
  ecommerce?: { currency: string; items: { item_name: string }[] };
}

interface ShopifyCustomerPrivacy {
  setTrackingConsent: (consent: Record<string, unknown>, done: () => void) => void;
}

declare global {
  interface Window {
    dataLayer?: DataLayerEntry[];
    /** The class names `<html>` went through, recorded by an init script. */
    __classes: string[];
    Shopify?: { analytics?: { publish: unknown }; customerPrivacy?: ShopifyCustomerPrivacy };
    TETHER_CONFIG: { token: string };
  }
}

export {};
