/**
 * Shopify's own analytics for the analytics part. Tether sets up the same event bus Hydrogen uses
 * (`window.Shopify.analytics`) and loads Shopify's consent script and shopify.js, which build and send the events.
 * Nothing is delivered before the Customer Privacy API allows analytics.
 */
import { cfg, log, reportError } from './config.js';
import { gql } from './client.js';

/** @typedef {Record<string, unknown>} EventPayload */
/** @typedef {{ uniqueToken: string, visitToken: string }} TrackingValues */
/** @typedef {{ getTrackingValues: () => TrackingValues }} DestinationContext */
/** @typedef {(payload: EventPayload, context: DestinationContext) => void} Subscriber */
/** @typedef {(event: string, subscriber: Subscriber) => () => void} Subscribe */
/** @typedef {{ shop: { shopId: string, channel: 'headless' }, consent: { mode: string } }} BusConfig */
/**
 * @typedef {object} DestinationSpec What shopify.js registers.
 * @property {string} name
 * @property {(api: { subscribe: Subscribe, getConfig: () => BusConfig }) => unknown} [setup]
 */
/**
 * @typedef {object} AnalyticsBus Hydrogen's `window.Shopify.analytics`.
 * @property {() => BusConfig} getConfig
 * @property {(event: string, payload?: EventPayload) => void} publish
 * @property {(destination: DestinationSpec) => () => void} addDestination
 */

/**
 * The parts of Shopify's Customer Privacy API (`window.Shopify.customerPrivacy`) that decide tracking.
 *
 * @typedef {object} CustomerPrivacy
 * @property {string} [consentStatus]
 * @property {() => { analytics?: string } | undefined} [currentVisitorConsent]
 * @property {() => boolean} [analyticsProcessingAllowed]
 * @property {{ uniqueToken?: TokenReader, visitToken?: TokenReader }} [__internal]
 * @property {object} [config]
 */
/** @typedef {(options: { generateFallback: boolean, tag: string }) => string} TokenReader */
/**
 * `window.Shopify`, which Shopify's scripts read and extend.
 *
 * @typedef {object} ShopifyGlobal
 * @property {AnalyticsBus} [analytics]
 * @property {CustomerPrivacy} [customerPrivacy]
 * @property {string} [country]
 * @property {string} [locale]
 * @property {string} [shop]
 * @property {object} [routes]
 */

/** @typedef {{ event: string, payload: EventPayload }} BufferedEvent */
/**
 * @typedef {object} Destination
 * @property {string} name
 * @property {number} next The index of the next buffered event it gets.
 * @property {Map<string, Set<Subscriber>>} subscribers
 * @property {DestinationContext} context
 */

/** Events kept for destinations that register late (shopify.js loads after the first page view). */
const BUFFER_SIZE = 500;
const CONSENT_SCRIPTS = {
  'default-banner': 'https://cdn.shopify.com/shopifycloud/privacy-banner/storefront-banner.js',
  other: 'https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js',
};
const ANALYTICS_SCRIPT = 'https://cdn.shopify.com/storefront/analytics/shopify.js';

/** @returns {ShopifyGlobal | undefined} `window.Shopify`, whose shape Shopify's scripts define. */
function shopifyGlobal() {
  /** @type {unknown} */
  const shopify = Reflect.get(window, 'Shopify');
  return /** @type {ShopifyGlobal | undefined} */ (shopify);
}

/** @returns {{ consent?: string, proxy?: string }} The `analytics.shopify` options; `true` sets none. */
function shopifyOptions() {
  const shopify = cfg.analytics?.shopify;
  return typeof shopify === 'object' ? shopify : {};
}

/**
 * Shopify's privacy API can throw while its script is still setting up. An answer it can't give counts as "not
 * allowed", so nothing is sent without consent; the next consent event asks again.
 *
 * @returns {boolean}
 */
function trackingAllowed() {
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

/**
 * @param {string} name The destination's name, Hydrogen tags its tokens with it.
 * @returns {DestinationContext}
 */
function destinationContext(name) {
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

/**
 * @param {Destination} destination
 * @returns {Subscribe}
 */
const subscriberOf = (destination) => (event, subscriber) => {
  const subscribers = destination.subscribers.get(event) ?? new Set();
  destination.subscribers.set(event, subscribers);
  subscribers.add(subscriber);
  return () => destination.subscribers.get(event)?.delete(subscriber);
};

/**
 * @param {string} shopId
 * @returns {AnalyticsBus} A bus that buffers events and delivers them to each destination once consent allows.
 */
function createBus(shopId) {
  /** @type {Destination[]} */
  const destinations = [];
  /** @type {BufferedEvent[]} */
  const buffer = [];
  /** @type {BusConfig} */
  const config = {
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
  /** @type {AnalyticsBus} */
  const bus = {
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
      /** @type {Destination} */
      const destination = { name: spec.name, next: 0, subscribers: new Map(), context: destinationContext(spec.name) };
      Promise.resolve(spec.setup?.({ subscribe: subscriberOf(destination), getConfig: bus.getConfig }))
        .then(() => {
          destinations.push(destination);
          deliver();
        })
        .catch((/** @type {unknown} */ error) => {
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

/**
 * @param {Destination} destination
 * @param {BufferedEvent} buffered
 */
function deliverTo(destination, { event, payload }) {
  destination.subscribers.get(event)?.forEach((subscriber) => {
    try {
      subscriber(payload, destination.context);
    } catch (error) {
      reportError(error, `analytics ${destination.name}`);
    }
  });
}

/** @param {string} src */
function loadScript(src) {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Sets up `window.Shopify` for Shopify's scripts and loads them.
 *
 * @param {() => boolean} isProductPage Asked by Shopify's script for the page template.
 * @returns {Promise<AnalyticsBus>} The bus, the page's own when a theme already set one up.
 */
export async function startShopifyAnalytics(isProductPage) {
  const existing = shopifyGlobal();
  if (existing?.analytics) return existing.analytics;
  /** @type {{ shop: { id: string } }} */
  const data = await gql('query TetherShopId { shop { id } }', {}, { context: false });
  const shopify = shopifyGlobal() ?? {};
  Reflect.set(window, 'Shopify', shopify);
  shopify.country = (cfg.country || 'US').toUpperCase();
  // Shopify's script requires a language, not a full locale.
  shopify.locale = (cfg.locale || 'en').split('-')[0]?.toLowerCase() ?? 'en';
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
