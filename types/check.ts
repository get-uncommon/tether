// Compile-only check of the published types (npm run test:types), the declarations generated into .test-dist/types:
// the package used the way the docs show, under a site's strict settings. Not shipped.
import Tether, { init, type TetherConfig, type ShopifyCart, type CartStatus, type TetherError } from '@occluze/tether';
import { barbaPreset } from '@occluze/tether/presets/barba';
import { createStorefront } from '@occluze/tether/server';
import tetherAstro from '@occluze/tether/astro';

const shop = createStorefront({
  PUBLIC_SHOPIFY_DOMAIN: 'x.myshopify.com',
  PUBLIC_SHOPIFY_STOREFRONT_TOKEN: 't',
  country: 'NL',
});
async function server() {
  const all = await shop.allProducts({ collection: 'coffee' });
  const one = await shop.getProduct(all[0].handle);
  const html: string = shop.hydrate(one ? [one] : []);
  const price: string = shop.formatMoney(all[0].priceRange.minVariantPrice);
  const img: string | undefined = shop.imageUrl(all[0].featuredImage?.url, { width: 800 });
  void img;
  return [html, price, shop.productUrl(all[0].handle)];
}
void server;
// The docs' patterns compile under strict: non-null state for a product, null-tolerant lookups.
async function docsPatterns(params: URLSearchParams, handle: string | undefined) {
  const p = await shop.getProduct(handle);
  if (!p) return;
  const state = shop.initialState(p, { variant: params.get('variant') });
  const hide: boolean = !state.show['plenty-in-stock'] || !state.show['has-savings'];
  const found = await shop.getProducts({ query: params.get('q') });
  const maybe = shop.initialState(null);
  void hide;
  void found;
  void maybe;
}
void docsPatterns;
// @ts-expect-error: a typo in the options is caught
createStorefront({ domian: 'x.myshopify.com' });
const env: Record<string, string> = {};
createStorefront({ ...env, country: 'NL' }); // import.meta.env-style spreads still work
tetherAstro({ country: 'NL', inject: true });

// Astro 5's `AstroIntegration`, as far as the integration has to fit it (astro isn't installed here).
type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };
interface AstroLikeConfig {
  root: URL;
  env: { schema: Record<string, { type: 'string'; context: 'client' | 'server'; access: 'public' | 'secret' }> };
}
interface AstroLikeIntegration {
  name: string;
  hooks: {
    'astro:config:setup'?: (options: {
      config: AstroLikeConfig;
      command: 'dev' | 'build' | 'preview' | 'sync';
      isRestart: boolean;
      updateConfig: (newConfig: DeepPartial<AstroLikeConfig>) => AstroLikeConfig;
      addWatchFile: (path: URL | string) => void;
      injectScript: (stage: 'before-hydration' | 'head-inline' | 'page' | 'page-ssr', content: string) => void;
      logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
    }) => void | Promise<void>;
    'astro:build:done'?: (options: { dir: URL }) => void | Promise<void>;
  };
}
const integration: AstroLikeIntegration = tetherAstro();
void integration;
// @ts-expect-error: functions can't go through the integration
tetherAstro({ onError: () => {} });
const unsub: () => void = Tether.cart.subscribe((cart, { count }) => console.log(cart?.id, count));
unsub();

const config: TetherConfig = {
  domain: 'x.myshopify.com',
  token: 't',
  country: 'NL',
  markets: { detect: true, locales: { de: { country: 'DE' } } },
  searchDelay: 200,
  account: { server: '/_tether/account', navigate: (url) => console.log(url) },
  onError: (e, ctx) => console.log((e as TetherError).code, ctx),
};
init({ ...config, ...barbaPreset({ lenis: () => null }) });

async function demo() {
  const cart: ShopifyCart = await Tether.cart.add({
    variantId: '123',
    quantity: 2,
    sellingPlanId: null,
    attributes: { Gift: 'yes' },
  });
  await Tether.cart.updateLine(cart.lines.nodes[0].id, { sellingPlanId: null });
  const p = await Tether.getProduct('coffee-box');
  const plans = Tether.plans.allPlans(p).map((pl) => pl.name);
  const scope = Tether.getScope(document.body);
  scope?.selectPlan(plans[0]);
  const report = await Tether.diagnose({ silent: true });
  const ok: boolean = report.reachable;
  const off = Tether.on('variant-changed', (d) => console.log(d.variant.id, d.sellingPlanId, ok));
  off();
  window.Tether.mount(document);
  // @ts-expect-error: unknown purchase mode
  scope?.setPurchase('weekly');
}
void demo;

import type { ShopifyProduct as SP } from '@occluze/tether/server';
const sp: SP | null = null;
void sp;
Tether.cart.subscribe((c, { loaded, warnings }) => {
  if (loaded && warnings.length) console.log(warnings[0].code, c?.lines.nodes[0]?.cost.totalAmount);
});
const im: string = Tether.imageUrl('https://cdn.shopify.com/a.jpg', { width: 160 });
void im;
void Tether.cart.changeQuantity('gid://shopify/CartLine/1', 1);
void Tether.setCountry('DE', { locale: 'de-DE', language: null });

// The cart's status is a union: each state carries what it has.
function cartSummary(status: CartStatus): string {
  switch (status.kind) {
    case 'unknown':
      return 'loading';
    case 'empty':
      return 'empty';
    case 'ready':
      return status.cart.id;
    case 'error':
      return status.cart?.id ?? String(status.error);
  }
}
void cartSummary(Tether.cart.status);
Tether.cart.setCheckoutResolver(null);
Tether.cart.setCheckoutResolver(async () => null);
async function accountAndMarkets() {
  const loggedIn: boolean = await Tether.account.isLoggedIn();
  await Tether.account.render(document);
  const report = await Tether.diagnose({ silent: true });
  const inUse: string | null = report.market.country;
  const source = report.market.detected?.sources?.country;
  const detected = await Tether.detectMarket();
  void [loggedIn, inUse, source, detected.country];
}
void accountAndMarkets;

// The account answers are typed: nullable fields stay nullable, logged out is null / [].
async function accountShapes() {
  const me = await Tether.account.customer();
  const name: string | null = me?.displayName ?? null;
  const orders = await Tether.account.orders({ first: 5 });
  const firstLine: string | null | undefined = orders[0]?.lineItems.nodes[0]?.title;
  const detail = await Tether.account.order('1');
  const tracking = detail?.fulfillments.nodes[0]?.trackingInformation[0]?.url;
  const contracts = await Tether.account.subscriptions();
  const change = await Tether.account.subscriptionAction(contracts[0]?.id ?? '', 'skip');
  const skipped = 'billingCycle' in change ? change.billingCycle.skipped : change.contract.status;
  const opened: string | null = (await Tether.account.requestReturn('1', [])).status;
  const failure = Tether.on('account-error', ({ error }) => console.log(error));
  failure();
  Tether.cart.forgetSaved();
  const url: string | null = shop.productUrl('coffee');
  void [name, firstLine, tracking, skipped, opened, url];
}
void accountShapes;
const loggedOutCode: TetherError['code'] = 'NOT_LOGGED_IN';
void loggedOutCode;

// The names a site imports, and the window globals of the <script> build.
import type {
  Tether as TetherApi,
  ResolvedTetherConfig,
  ShopifyProduct,
  ShopifyVariant,
  ProductScope,
  AccountCustomer,
  AccountOrder,
  OrderDetail,
  SubscriptionContract,
  TetherEvents,
} from '@occluze/tether';
import type { Storefront, InitialState } from '@occluze/tether/server';
const api: TetherApi = window.Tether;
const resolved: ResolvedTetherConfig = api.config;
window.TETHER_CONFIG = { domain: 'x.myshopify.com', token: 't', autoMount: false };
const country: string | undefined = window.TETHER_COUNTRY;
const storefront: Storefront = shop;
const first: InitialState | null = storefront.initialState(null);
type Answers = [AccountCustomer | null, AccountOrder[], OrderDetail | null, SubscriptionContract[]];
const answers: Promise<Answers> = Promise.all([
  api.account.customer(),
  api.account.orders(),
  api.account.order('1'),
  api.account.subscriptions(),
]);
const added: TetherEvents['product-added'] | null = null;
function variantOf(scope: ProductScope, product: ShopifyProduct): ShopifyVariant | null {
  return scope.product === product ? scope.variant : null;
}
// @ts-expect-error: Tether.on listens only to the events Tether dispatches
api.on('my-event', (detail) => console.log(detail));
// @ts-expect-error: TetherError is a type here; the class is Tether.TetherError
void ({} instanceof TetherError);
void [resolved.prefix, country, first, answers, added, variantOf];
