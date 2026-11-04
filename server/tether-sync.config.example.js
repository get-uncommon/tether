// Copy to tether-sync.config.js and edit. Secrets never go in this file (see README).
export default {
  shopify: {
    domain: 'your-store.myshopify.com',
    apiVersion: '2026-07',
    // inventory: true,            // needed to map totalInventory (add the read_inventory scope)
    // query: 'status:active',     // limit `import` (disables --prune)
  },
  webflow: {
    collectionId: 'YOUR_COLLECTION_ID',  // Webflow: CMS -> collection settings, or `GET /v2/sites/{id}/collections`
    perMinute: 50,                        // 60/min on Starter/Basic plans, 120 on CMS/Business
    publish: true,                        // publish items right away (false: they go live on the next site publish)
  },
  match: {
    idField: 'shopify-id',                // Plain text field in the collection that stores the Shopify product id
    bySlug: true,                         // adopt existing items whose slug equals the Shopify handle
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
    'main-image': 'image',
    // gallery: 'images',
    // material: 'metafield:custom.material',
    // 'on-sale': (p) => p.compareAtPrice != null,
  },
  // Written when the item is created, never overwritten afterwards, so editors can change them in Webflow.
  webflowOwned: ['description'],
  onDelete: 'archive',   // product deleted in Shopify: 'archive' | 'delete' | 'unpublish'
  inactive: 'archive',   // product set to draft/archived: 'archive' | 'unpublish' | 'keep'
  reconcile: {
    maxChangesPerRun: 20,  // Webflow writes per run; keeps a free Worker under 50 subrequests
    lookbackMinutes: 60,   // first reconcile without a cursor looks back this far
  },
};
