export type EventPayload = Record<string, unknown>;
interface TrackingValues {
    uniqueToken: string;
    visitToken: string;
}
interface DestinationContext {
    getTrackingValues: () => TrackingValues;
}
type Subscriber = (payload: EventPayload, context: DestinationContext) => void;
type Subscribe = (event: string, subscriber: Subscriber) => () => void;
interface BusConfig {
    shop: {
        shopId: string;
        channel: 'headless';
    };
    consent: {
        mode: string;
    };
}
/** What shopify.js registers. */
interface DestinationSpec {
    name: string;
    setup?: (api: {
        subscribe: Subscribe;
        getConfig: () => BusConfig;
    }) => unknown;
}
/** Hydrogen's `window.Shopify.analytics`. */
export interface AnalyticsBus {
    getConfig: () => BusConfig;
    publish: (event: string, payload?: EventPayload) => void;
    addDestination: (destination: DestinationSpec) => () => void;
}
/**
 * Sets up `window.Shopify` for Shopify's scripts and loads them.
 *
 * @param isProductPage Asked by Shopify's script for the page template.
 * @returns The bus, the page's own when a theme already set one up.
 */
export declare function startShopifyAnalytics(isProductPage: () => boolean): Promise<AnalyticsBus>;
export {};
