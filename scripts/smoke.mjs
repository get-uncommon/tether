/**
 * Live check against a real Storefront API: every query and mutation Tether
 * sends must validate against Shopify's schema.
 *
 *   npm run smoke                                   # Shopify's public Hydrogen demo store
 *   TETHER_DOMAIN=x.myshopify.com TETHER_TOKEN=... TETHER_COLLECTION=all npm run smoke
 *   TETHER_API_VERSION=2026-10 npm run smoke         # check a newer API version first
 *
 * Creates (and empties) a throwaway cart on that store. Run against your own
 * dev store to also test selling plans.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver, Option: dom.window.Option,
});

const { default: Tether } = await import('../src/index.js');

const domain = process.env.TETHER_DOMAIN || 'hydrogen-preview.myshopify.com';
const token = process.env.TETHER_TOKEN || '3b580e70970c4528da70c98e097c2fa0'; // public demo token
const country = process.env.TETHER_COUNTRY || 'NL';
const collection = process.env.TETHER_COLLECTION || null;
const apiVersion = process.env.TETHER_API_VERSION || undefined; // try a new version before bumping the default

await Tether.init({ domain, token, country, metafields: ['custom.material'], autoMount: false, ...(apiVersion ? { apiVersion } : {}) });

const ok = (m) => console.log(`  ok  ${m}`);
let failed = 0;
async function step(name, fn) {
  try { await fn(); ok(name); } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log(`Smoke test against ${domain} (country ${country}, API ${Tether.config.apiVersion})`);

await step('diagnose: token reachable', async () => {
  const r = await Tether.diagnose({ silent: true });
  if (!r.reachable) throw new Error(r.problems.map((p) => p.message).join('; '));
  if (!r.apiVersion.ok) throw new Error(`apiVersion ${r.apiVersion.version}: ${r.apiVersion.note}`);
});

let products = [];
await step('search products', async () => {
  const r = await Tether.getProducts({ query: '', first: 5 });
  products = r.products;
  if (!products.length) throw new Error('no products');
});

if (collection) {
  await step(`collection "${collection}"`, async () => {
    const r = await Tether.getProducts({ collection, first: 5, sortKey: 'BEST_SELLING' });
    if (!r.collection) throw new Error('no collection');
  });
}

let product;
await step('product by handle (batched)', async () => {
  Tether.clearProductCache();
  const [a, b] = await Promise.all([Tether.getProduct(products[0].handle), Tether.getProduct(products[1]?.handle || products[0].handle)]);
  product = a;
  if (!a || !b) throw new Error('missing');
});

await step('product by numeric id', async () => {
  Tether.clearProductCache();
  const id = product.id.split('/').pop();
  const p = await Tether.getProduct(id);
  if (p.handle !== product.handle) throw new Error('mismatch');
});

await step('recommendations', async () => { await Tether.getRecommendations(product.id); });

await step('unknown handle rejects with NOT_FOUND', async () => {
  try { await Tether.getProduct('tether-smoke-does-not-exist'); } catch (e) {
    if (e.code !== 'NOT_FOUND') throw new Error(`code ${e.code}`);
    return;
  }
  throw new Error('resolved');
});

const withPlans = products.find((p) => Tether.plans.hasPlans(p));
console.log(withPlans
  ? `  ..  selling plans found on "${withPlans.handle}": ${Tether.plans.allPlans(withPlans).map((p) => p.name).join(', ')}`
  : '  ..  no product with selling plans on this store (subscription path not exercised live)');

const variant = (withPlans || product).variants.nodes.find((v) => v.availableForSale) || product.variants.nodes[0];
const planId = withPlans ? Tether.plans.allPlans(withPlans).find((p) => Tether.plans.allocationFor(variant, p.id))?.id : null;

await step('cart create + add', async () => {
  localStorage.clear();
  await Tether.cart.add({ variantId: variant.id, quantity: 1, attributes: { _source: 'tether-smoke' }, sellingPlanId: planId || undefined });
  if (Tether.cart.count !== 1) throw new Error(`count ${Tether.cart.count}`);
});
if (planId) {
  await step('line has selling plan', async () => {
    if (!Tether.cart.lines[0].sellingPlanAllocation) throw new Error('no allocation on line');
  });
  await step('switch line to one-time (sellingPlanId: null)', async () => {
    await Tether.cart.updateLine(Tether.cart.lines[0].id, { sellingPlanId: null });
    if (Tether.cart.lines[0].sellingPlanAllocation) throw new Error('still has a plan');
  });
}
await step('add second line (array)', async () => {
  await Tether.cart.add([{ variantId: variant.id, quantity: 1, attributes: { _group: 'smoke' } }]);
});
await step('update quantity', async () => { await Tether.cart.updateLine(Tether.cart.lines[0].id, 2); });
await step('note', async () => { await Tether.cart.setNote('smoke test'); });
await step('attributes', async () => { await Tether.cart.setAttributes({ source: 'tether' }); });
await step('discount (invalid code is fine)', async () => { await Tether.cart.setDiscountCodes(['TETHERSMOKE']); });
await step('buyer identity', async () => { await Tether.cart.setBuyerIdentity({ countryCode: 'DE' }); });
await step('checkoutUrl present', async () => { if (!Tether.cart.state.checkoutUrl) throw new Error('none'); });
await step('reload cart from storage', async () => { const c = await Tether.cart.init(); if (!c) throw new Error('lost'); });
await step('clear', async () => { await Tether.cart.clear(); if (Tether.cart.count) throw new Error('not empty'); });

console.log(failed ? `\n${failed} step(s) failed` : '\nAll steps passed');
process.exit(failed ? 1 : 0);
