/**
 * Shopify's own analytics for the analytics part. Tether sets up the same event bus Hydrogen uses
 * (`window.Shopify.analytics`) and loads Shopify's consent script and shopify.js, which build and send the events.
 * Nothing is delivered before the Customer Privacy API allows analytics.
 */
import { cfg, log, reportError } from './config.ts';
import { gql, shaped } from './client.ts';
import type { AnalyticsConfig } from './config.ts';

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
  shop: { shopId: string; channel: 'headless' };
  consent: { mode: string };
}

/** What shopify.js registers. */
interface DestinationSpec {
  name: string;
  setup?: (api: { subscribe: Subscribe; getConfig: () => BusConfig }) => unknown;
}

/** Hydrogen's `window.Shopify.analytics`. */
export interface AnalyticsBus {
  getConfig: () => BusConfig;
  publish: (event: string, payload?: EventPayload) => void;
  addDestination: (destination: DestinationSpec) => () => void;
}

type TokenReader = (options: { generateFallback: boolean; tag: string }) => string;

/** The parts of Shopify's Customer Privacy API (`window.Shopify.customerPrivacy`) that decide tracking. */
interface CustomerPrivacy {
  consentStatus?: string;
  currentVisitorConsent?: () => { analytics?: string } | undefined;
  analyticsProcessingAllowed?: () => boolean;
  __internal?: { uniqueToken?: TokenReader; visitToken?: TokenReader };
  config?: object;
}

/** `window.Shopify`, which Shopify's scripts read and extend. */
interface ShopifyGlobal {
  analytics?: AnalyticsBus;
  customerPrivacy?: CustomerPrivacy;
  country?: string;
  locale?: string;
  shop?: string;
  routes?: object;
}

interface BufferedEvent {
  event: string;
  payload: EventPayload;
}

interface Destination {
  name: string;
  /** The index of the next buffered event it gets. */
  next: number;
  subscribers: Map<string, Set<Subscriber>>;
  context: DestinationContext;
}

/** Events kept for destinations that register late (shopify.js loads after the first page view). */
const BUFFER_SIZE = 500;
const CONSENT_SCRIPTS = {
  'default-banner': 'https://cdn.shopify.com/shopifycloud/privacy-banner/storefront-banner.js',
  other: 'https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js',
};
const ANALYTICS_SCRIPT = 'https://cdn.shopify.com/storefront/analytics/shopify.js';

/** The page, where Shopify's scripts keep `window.Shopify` in the shape they define. */
const page = (): Window & { Shopify?: ShopifyGlobal } => window;

const shopifyGlobal = (): ShopifyGlobal | undefined => page().Shopify;

/** The `analytics.shopify` options; `true` sets none. */
function shopifyOptions(): Exclude<NonNullable<AnalyticsConfig['shopify']>, boolean> {
  const shopify = cfg.analytics?.shopify;
  return typeof shopify === 'object' ? shopify : {};
}

/**
 * Shopify's privacy API can throw while its script is still setting up. An answer it can't give counts as "not
 * allowed", so nothing is sent without consent; the next consent event asks again.
 */
function trackingAllowed(): boolean {
  try {
    const privacy = shopifyGlobal()?.customerPrivacy;
    return (
      privacy?.consentStatus === 'loaded' &&
      privacy.currentVisitorConsent?.()?.analytics !== 'no' &&
      Boolean(privacy.analyticsProcessingAllowed?.())
    );
  } catch {
    return false;
  }
}

/** @param name The destination's name, Hydrogen tags its tokens with it. */
function destinationContext(name: string): DestinationContext {
  const tag = `hydrogen:${name}`;
  return {
    getTrackingValues: () => {
      const internal = trackingAllowed() ? shopifyGlobal()?.customerPrivacy?.__internal : undefined;
      return {
        uniqueToken: internal?.uniqueToken?.({ generateFallback: true, tag }) ?? '',
        visitToken: internal?.visitToken?.({ generateFallback: true, tag }) ?? '',
      };
    },
  };
}

const subscriberOf =
  (destination: Destination): Subscribe =>
  (event, subscriber) => {
    const subscribers = destination.subscribers.get(event) ?? new Set();
    destination.subscribers.set(event, subscribers);
    subscribers.add(subscriber);
    return () => destination.subscribers.get(event)?.delete(subscriber);
  };

/** A bus that buffers events and delivers them to each destination once consent allows. */
function createBus(shopId: string): AnalyticsBus {
  const destinations: Destination[] = [];
  const buffer: BufferedEvent[] = [];
  const config: BusConfig = {
    shop: { shopId, channel: 'headless' },
    consent: { mode: shopifyOptions().consent || 'no-banner' },
  };
  const deliver = () => {
    if (!trackingAllowed()) return;
    for (const destination of destinations) {
      for (; destination.next < buffer.length; destination.next += 1) {
        const buffered = buffer[destination.next];
        if (buffered) deliverTo(destination, buffered);
      }
    }
  };
  const bus: AnalyticsBus = {
    getConfig: () => config,
    publish(event, payload = {}) {
      buffer.push({ event, payload: { shop: config.shop, url: window.location.href, ...payload } });
      if (buffer.length > BUFFER_SIZE) {
        buffer.shift();
        for (const destination of destinations) destination.next = Math.max(0, destination.next - 1);
      }
      deliver();
    },
    addDestination(spec) {
      const destination: Destination = {
        name: spec.name,
        next: 0,
        subscribers: new Map(),
        context: destinationContext(spec.name),
      };
      Promise.resolve(spec.setup?.({ subscribe: subscriberOf(destination), getConfig: bus.getConfig }))
        .then(() => {
          destinations.push(destination);
          deliver();
        })
        .catch((error: unknown) => {
          reportError(error, `analytics ${spec.name}`);
        });
      return () => {
        const index = destinations.indexOf(destination);
        if (index >= 0) destinations.splice(index, 1);
      };
    },
  };
  document.addEventListener('consentTrackingApiLoaded', deliver);
  document.addEventListener('visitorConsentCollected', deliver);
  return bus;
}

function deliverTo(destination: Destination, { event, payload }: BufferedEvent): void {
  destination.subscribers.get(event)?.forEach((subscriber) => {
    try {
      subscriber(payload, destination.context);
    } catch (error) {
      reportError(error, `analytics ${destination.name}`);
    }
  });
}

function loadScript(src: string): void {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Sets up `window.Shopify` for Shopify's scripts and loads them.
 *
 * @param isProductPage Asked by Shopify's script for the page template.
 * @returns The bus, the page's own when a theme already set one up.
 */
export async function startShopifyAnalytics(isProductPage: () => boolean): Promise<AnalyticsBus> {
  const existing = shopifyGlobal();
  if (existing?.analytics) return existing.analytics;
  const data = await gql(
    'query TetherShopId { shop { id } }',
    {},
    shaped<{ shop: { id: string } }>({ shop: { id: 'string' } }),
    { context: false },
  );
  const shopify = shopifyGlobal() ?? {};
  page().Shopify = shopify;
  shopify.country = cfg.country ?? 'US';
  // Shopify's script requires a language, not a full locale.
  const [language = 'en'] = (cfg.locale || 'en').split('-');
  shopify.locale = language.toLowerCase();
  shopify.shop = cfg.domain;
  shopify.routes = {
    root: '/',
    match: () => ({ pageTemplateName: isProductPage() ? 'product' : 'page' }),
    ...shopify.routes,
  };
  // A same-origin Storefront API path gives Shopify exact visitor counts.
  const { proxy, consent } = shopifyOptions();
  shopify.customerPrivacy = {
    ...shopify.customerPrivacy,
    config: proxy
      ? { isHeadless: true, asyncConsent: true, asyncVisitorState: true, consentDomain: window.location.host }
      : { isHeadless: true, storefrontAccessToken: cfg.token, checkoutRootDomain: cfg.domain },
  };
  const bus = createBus(data.shop.id);
  shopify.analytics = bus;
  loadScript(consent === 'default-banner' ? CONSENT_SCRIPTS['default-banner'] : CONSENT_SCRIPTS.other);
  loadScript(ANALYTICS_SCRIPT);
  log('shopify analytics ready', data.shop.id);
  return bus;
}
