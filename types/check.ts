// Compile-only check of the public types (npm run test:types). Not shipped.
import Tether, { init, type TetherConfig, type ShopifyCart, TetherError } from '@occluze/tether';
import { barbaPreset } from '@occluze/tether/presets/barba';
import { createStorefront } from '@occluze/tether/server';
import tetherAstro from '@occluze/tether/astro';

const shop = createStorefront({ PUBLIC_SHOPIFY_DOMAIN: 'x.myshopify.com', PUBLIC_SHOPIFY_STOREFRONT_TOKEN: 't', country: 'NL' });
async function server() {
  const all = await shop.allProducts({ collection: 'coffee' });
  const one = await shop.getProduct(all[0].handle);
  const html: string = shop.hydrate(one ? [one] : []);
  const price: string = shop.formatMoney(all[0].priceRange.minVariantPrice);
  const img: string = shop.imageUrl(all[0].featuredImage?.url, { width: 800 });
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
  void hide; void found; void maybe;
}
void docsPatterns;
// @ts-expect-error: a typo in the options is caught
createStorefront({ domian: 'x.myshopify.com' });
const env: Record<string, string> = {};
createStorefront({ ...env, country: 'NL' }); // import.meta.env-style spreads still work
tetherAstro({ country: 'NL', inject: true });
// @ts-expect-error: functions can't go through the integration
tetherAstro({ onError: () => {} });
const unsub: () => void = Tether.cart.subscribe((cart, { count }) => console.log(cart?.id, count));
unsub();

const config: TetherConfig = { domain: 'x.myshopify.com', token: 't', country: 'NL', markets: { detect: true, locales: { de: { country: 'DE' } } }, onError: (e, ctx) => console.log((e as TetherError).code, ctx) };
init({ ...config, ...barbaPreset({ lenis: () => null }) });

async function demo() {
  const cart: ShopifyCart = await Tether.cart.add({ variantId: '123', quantity: 2, sellingPlanId: null, attributes: { Gift: 'yes' } });
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
const sp: SP | null = null; void sp;
Tether.cart.subscribe((c, { loaded, warnings }) => { if (loaded && warnings.length) console.log(warnings[0].code, c?.lines.nodes[0]?.cost.totalAmount); });
const im: string = Tether.imageUrl('https://cdn.shopify.com/a.jpg', { width: 160 }); void im;
void Tether.cart.changeQuantity('gid://shopify/CartLine/1', 1);
void Tether.setCountry('DE', { locale: 'de-DE', language: null });
