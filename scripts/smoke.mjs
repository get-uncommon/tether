/**
 * Live check against a real Storefront API: every query and mutation Tether sends must validate against Shopify's
 * schema.
 *
 *   npm run smoke                                   # Shopify's public Hydrogen demo store
 *   TETHER_DOMAIN=x.myshopify.com TETHER_TOKEN=... TETHER_COLLECTION=all npm run smoke
 *   TETHER_API_VERSION=2026-10 npm run smoke         # check a newer API version first
 *
 * Creates (and empties) a throwaway cart on that store. Run against your own dev store to also test selling plans.
 * It runs the built package (`@occluze/tether` resolves to dist/esm/ through the package's own exports), so it sends
 * the same minified GraphQL the browser build sends, and is typed by the published types/index.d.ts.
 */
import { JSDOM } from 'jsdom';
/** @import { ShopifyProduct, ShopifyVariant } from '@occluze/tether' */

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option,
});

const { default: Tether } = await import('@occluze/tether');

const domain = process.env['TETHER_DOMAIN'] || 'hydrogen-preview.myshopify.com';
// Shopify's public token for its demo store.
const token = process.env['TETHER_TOKEN'] || '3b580e70970c4528da70c98e097c2fa0';
const country = process.env['TETHER_COUNTRY'] || 'NL';
const collection = process.env['TETHER_COLLECTION'] || null;
// A new API version, tried before the default is bumped.
const apiVersion = process.env['TETHER_API_VERSION'];
const PRODUCTS_TO_LOAD = 5;

await Tether.init({
  domain,
  token,
  country,
  metafields: ['custom.material'],
  autoMount: false,
  ...(apiVersion ? { apiVersion } : {}),
});

let failed = 0;

/**
 * @param {string} name
 * @param {() => Promise<void>} check Throws when the step fails.
 */
async function step(name, check) {
  try {
    await check();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @template T
 * @param {T | null | undefined} value
 * @param {string} what
 * @returns {T}
 */
function required(value, what) {
  if (value == null) throw new Error(`no ${what}`);
  return value;
}

console.log(`Smoke test against ${domain} (country ${country}, API ${Tether.config.apiVersion ?? 'default'})`);

await step('diagnose: token reachable', async () => {
  const report = await Tether.diagnose({ silent: true });
  if (!report.reachable) throw new Error(report.problems.map((problem) => problem.message).join('; '));
  if (!report.apiVersion.ok) throw new Error(`apiVersion ${report.apiVersion.version}: ${report.apiVersion.note}`);
});

/** @type {ShopifyProduct[]} */
let products = [];
await step('search products', async () => {
  const page = await Tether.getProducts({ query: '', first: PRODUCTS_TO_LOAD });
  products = page.products;
  if (!products.length) throw new Error('no products');
});

if (collection) {
  await step(`collection "${collection}"`, async () => {
    const page = await Tether.getProducts({ collection, first: PRODUCTS_TO_LOAD, sortKey: 'BEST_SELLING' });
    if (!page.collection) throw new Error('no collection');
  });
}

/** @type {{ product: ShopifyProduct | null }} The product the steps after loading it use. */
const loaded = { product: null };
await step('product by handle (batched)', async () => {
  Tether.clearProductCache();
  const first = required(products[0], 'product');
  const [a, b] = await Promise.all([
    Tether.getProduct(first.handle),
    Tether.getProduct(products[1]?.handle ?? first.handle),
  ]);
  loaded.product = a;
  required(b, 'second product');
});

await step('product by numeric id', async () => {
  Tether.clearProductCache();
  const product = required(loaded.product, 'product');
  const byId = await Tether.getProduct(product.id.split('/').pop() ?? product.id);
  if (byId.handle !== product.handle) throw new Error('mismatch');
});

await step('recommendations', async () => {
  await Tether.getRecommendations(required(loaded.product, 'product').id);
});

await step('unknown handle rejects with NOT_FOUND', async () => {
  try {
    await Tether.getProduct('tether-smoke-does-not-exist');
  } catch (error) {
    if (error instanceof Tether.TetherError && error.code === 'NOT_FOUND') return;
    const code = error instanceof Tether.TetherError ? error.code : String(error);
    throw new Error(`code ${code}`, { cause: error });
  }
  throw new Error('resolved');
});

const withPlans = products.find((candidate) => Tether.plans.hasPlans(candidate));
console.log(
  withPlans
    ? `  ..  selling plans found on "${withPlans.handle}": ${Tether.plans
        .allPlans(withPlans)
        .map((plan) => plan.name)
        .join(', ')}`
    : '  ..  no product with selling plans on this store (subscription path not exercised live)',
);

/**
 * @param {ShopifyProduct} cartProduct
 * @returns {ShopifyVariant} A variant for sale, else the first one.
 */
function variantToBuy(cartProduct) {
  const variants = cartProduct.variants.nodes;
  return required(variants.find((candidate) => candidate.availableForSale) ?? variants[0], 'variant');
}

/** @returns {import('@occluze/tether').ShopifyCartLine} */
const firstLine = () => required(Tether.cart.lines[0], 'cart line');

/** @param {ShopifyProduct} cartProduct */
async function cartSteps(cartProduct) {
  const variant = variantToBuy(withPlans ?? cartProduct);
  const planId = withPlans
    ? Tether.plans.allPlans(withPlans).find((plan) => Tether.plans.allocationFor(variant, plan.id))?.id
    : undefined;

  await step('cart create + add', async () => {
    localStorage.clear();
    await Tether.cart.add({
      variantId: variant.id,
      quantity: 1,
      attributes: { _source: 'tether-smoke' },
      ...(planId ? { sellingPlanId: planId } : {}),
    });
    if (Tether.cart.count !== 1) throw new Error(`count ${Tether.cart.count}`);
  });
  if (planId) {
    await step('line has selling plan', async () => {
      if (!firstLine().sellingPlanAllocation) throw new Error('no allocation on line');
    });
    await step('switch line to one-time (sellingPlanId: null)', async () => {
      await Tether.cart.updateLine(firstLine().id, { sellingPlanId: null });
      if (firstLine().sellingPlanAllocation) throw new Error('still has a plan');
    });
  }
  await marketSteps();
  await step('add second line (array)', async () => {
    await Tether.cart.add([{ variantId: variant.id, quantity: 1, attributes: { _group: 'smoke' } }]);
  });
  await changeSteps();
}

async function marketSteps() {
  /** @type {{ isoCode: string }[]} */
  let countries = [];
  await step('localization (tether-country-select data)', async () => {
    const localization = await Tether.getLocalization();
    countries = localization.availableCountries;
    if (!countries.length) throw new Error('no availableCountries');
  });
  const other = countries.find((candidate) => candidate.isoCode !== country)?.isoCode;
  if (!other) return;
  await step(`setCountry(${other}) updates the cart market`, async () => {
    await Tether.setCountry(other, { remember: false });
    const cartCountry = Tether.cart.state?.buyerIdentity?.countryCode;
    if (cartCountry !== other) throw new Error(`cart country ${String(cartCountry)}`);
    await Tether.setCountry(country, { remember: false });
  });
}

async function changeSteps() {
  await step('update quantity', async () => {
    await Tether.cart.updateLine(firstLine().id, 2);
  });
  await step('note', async () => {
    await Tether.cart.setNote('smoke test');
  });
  await step('attributes', async () => {
    await Tether.cart.setAttributes({ source: 'tether' });
  });
  await step('discount (invalid code is fine)', async () => {
    await Tether.cart.setDiscountCodes(['TETHERSMOKE']);
  });
  await step('buyer identity', async () => {
    await Tether.cart.setBuyerIdentity({ countryCode: 'DE' });
  });
  await step('checkoutUrl present', async () => {
    if (!Tether.cart.state?.checkoutUrl) throw new Error('none');
  });
  await step('reload cart from storage', async () => {
    required(await Tether.cart.init(), 'cart after reload');
  });
  await step('clear', async () => {
    await Tether.cart.clear();
    if (Tether.cart.count) throw new Error('not empty');
  });
}

if (loaded.product) await cartSteps(loaded.product);
else {
  failed++;
  console.log('  FAIL cart steps: no product to add');
}

console.log(failed ? `\n${failed} step(s) failed` : '\nAll steps passed');
process.exit(failed ? 1 : 0);
