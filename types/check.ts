// Compile-only check of the public types (npm run test:types). Not shipped.
import Tether, { init, type TetherConfig, type ShopifyCart, TetherError } from '@occluze/tether';
import { barbaPreset } from '@occluze/tether/presets/barba';

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
