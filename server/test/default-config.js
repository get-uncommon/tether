// Frozen copy of the shipped default config, for the tests (a deployed copy may customize its own).
// Default config: works as-is with a "standard" Products collection (see README), with the
// store and collection from the environment (SHOPIFY_DOMAIN, WEBFLOW_COLLECTION_ID).
// Edit it in your fork for a custom mapping, or set FIELD_MAP / WEBFLOW_OWNED in the environment.
// Secrets never go in this file.
export default {
  shopify: {
    domain: '',                       // or SHOPIFY_DOMAIN, e.g. your-store.myshopify.com
    apiVersion: '2026-07',
    // inventory: true,               // needed to map totalInventory (add the read_inventory scope)
    // query: 'status:active',        // limit `import` (disables --prune)
  },
  webflow: {
    collectionId: '',                 // or WEBFLOW_COLLECTION_ID
    perMinute: 50,                    // 60/min on Starter/Basic plans, 120 on CMS/Business
    publish: true,                    // publish items right away (false: they go live on the next site publish)
    skipMissingFields: true,          // mapped fields that don't exist in the collection are left out
  },
  match: {
    idField: 'shopify-id',            // Plain text field in the collection that stores the Shopify product id
    bySlug: true,                     // adopt existing items whose slug equals the Shopify handle
  },
  // Webflow field slug: Shopify source. Sources: any key of the normalized product
  // (title, handle, legacyId, description, descriptionHtml, vendor, productType, tags, tagsText,
  // status, price, maxPrice, compareAtPrice, currency, image, images, available, totalInventory,
  // sku, seoTitle, seoDescription, onlineStoreUrl, createdAt, updatedAt, publishedAt),
  // a dotted path ('variants.0.sku', 'images.1'), 'metafield:namespace.key', '=constant',
  // or a function (product) => value.
  fields: {
    name: 'title',
    slug: 'handle',
    'shopify-id': 'legacyId',
    'shopify-handle': 'handle',
    description: 'descriptionHtml',
    price: 'price',
    'compare-at-price': 'compareAtPrice',
    'main-image': 'image',
    gallery: 'images',
    vendor: 'vendor',
    'product-type': 'productType',
    tags: 'tagsText',
    sku: 'sku',
    available: 'available',
    // material: 'metafield:custom.material',
    // 'on-sale': (p) => p.compareAtPrice != null,
  },
  // Written when the item is created, never overwritten afterwards, so editors can change them in Webflow.
  webflowOwned: ['description'],
  onDelete: 'archive',   // product deleted in Shopify: 'archive' | 'delete' | 'unpublish'
  inactive: 'archive',   // product set to draft/archived: 'archive' | 'unpublish' | 'keep'
  reconcile: {
    maxChangesPerRun: 20,    // Webflow writes per run
    maxProductsPerRun: 200,  // products checked per run (1 KV read each)
    maxPagesPerRun: 10,      // Shopify pages per run
    overlapMinutes: 5,       // re-read the end of the last window (Shopify's search index lags)
    lookbackMinutes: 60,     // first reconcile without a cursor looks back this far
    // A Worker also stops at MAX_SUBREQUESTS (env, default 45) and continues next run.
  },
};
