const money = (amount, currencyCode = 'EUR') => ({ amount: String(amount), currencyCode });

export const PLAN_MONTH = 'gid://shopify/SellingPlan/111';
export const PLAN_2MONTH = 'gid://shopify/SellingPlan/222';

const allocation = (planId, price) => ({
  sellingPlan: { id: planId },
  checkoutChargeAmount: money(price),
  remainingBalanceChargeAmount: money(0),
  priceAdjustments: [
    { price: money(price), compareAtPrice: money(30), perDeliveryPrice: money(price), unitPrice: null },
  ],
});

const variant = (id, size, allocations, available = true) => ({
  id: `gid://shopify/ProductVariant/${id}`,
  title: size,
  availableForSale: available,
  currentlyNotInStock: false,
  quantityAvailable: 10,
  sku: `SKU-${id}`,
  barcode: null,
  selectedOptions: [{ name: 'Size', value: size }],
  image: null,
  price: money(30),
  compareAtPrice: null,
  unitPrice: null,
  sellingPlanAllocations: { nodes: allocations },
});

export const product = {
  id: 'gid://shopify/Product/1',
  handle: 'coffee-box',
  title: 'Coffee Box',
  description: 'Fresh beans',
  descriptionHtml: '<p>Fresh beans</p>',
  productType: 'Coffee',
  vendor: 'Test',
  tags: ['coffee', 'hidden'],
  availableForSale: true,
  publishedAt: '2026-01-01T00:00:00Z',
  onlineStoreUrl: null,
  requiresSellingPlan: false,
  seo: { title: null, description: null },
  featuredImage: { url: 'https://cdn.shopify.com/a.jpg', altText: null, width: 10, height: 10 },
  images: { nodes: [{ url: 'https://cdn.shopify.com/a.jpg', altText: null, width: 10, height: 10 }] },
  options: [
    {
      name: 'Size',
      optionValues: [
        { name: '250g', swatch: null },
        { name: '1kg', swatch: null },
      ],
    },
  ],
  priceRange: { minVariantPrice: money(30), maxVariantPrice: money(30) },
  compareAtPriceRange: { minVariantPrice: money(0), maxVariantPrice: money(0) },
  metafields: [
    { namespace: 'custom', key: 'origin', type: 'single_line_text_field', value: 'Ethiopia', reference: null },
  ],
  sellingPlanGroups: {
    nodes: [
      {
        name: 'Subscribe & save',
        appName: 'Shopify Subscriptions',
        options: [{ name: 'Delivery every', values: ['1 month', '2 months'] }],
        sellingPlans: {
          nodes: [
            {
              id: PLAN_MONTH,
              name: 'Every month',
              description: null,
              recurringDeliveries: true,
              options: [{ name: 'Delivery every', value: '1 month' }],
              priceAdjustments: [
                {
                  orderCount: null,
                  adjustmentValue: { __typename: 'SellingPlanPercentagePriceAdjustment', adjustmentPercentage: 10 },
                },
              ],
            },
            {
              id: PLAN_2MONTH,
              name: 'Every 2 months',
              description: null,
              recurringDeliveries: true,
              options: [{ name: 'Delivery every', value: '2 months' }],
              priceAdjustments: [
                {
                  orderCount: null,
                  adjustmentValue: { __typename: 'SellingPlanPercentagePriceAdjustment', adjustmentPercentage: 5 },
                },
              ],
            },
          ],
        },
      },
    ],
  },
  variants: {
    nodes: [
      variant(10, '250g', [allocation(PLAN_MONTH, 27), allocation(PLAN_2MONTH, 28.5)]),
      // 1kg is only on the 2-month plan
      variant(20, '1kg', [allocation(PLAN_2MONTH, 28.5)]),
    ],
  },
};

export function cartFrom(lines) {
  const total = lines.reduce((s, l) => s + l.quantity * (l.sellingPlanId ? 27 : 30), 0);
  return {
    id: 'gid://shopify/Cart/abc',
    checkoutUrl: 'https://shop.test/checkout/abc',
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    note: null,
    createdAt: '',
    updatedAt: '',
    attributes: [],
    buyerIdentity: { countryCode: 'NL', email: null },
    discountCodes: [],
    cost: { subtotalAmount: money(total), totalAmount: money(total), checkoutChargeAmount: money(total) },
    lines: {
      nodes: lines.map((l, i) => ({
        id: `gid://shopify/CartLine/${i + 1}`,
        quantity: l.quantity,
        attributes: l.attributes || [],
        cost: {
          totalAmount: money(l.quantity * (l.sellingPlanId ? 27 : 30)),
          subtotalAmount: money(l.quantity * 30),
          amountPerQuantity: money(l.sellingPlanId ? 27 : 30),
          compareAtAmountPerQuantity: null,
        },
        discountAllocations: [],
        sellingPlanAllocation: l.sellingPlanId
          ? {
              sellingPlan: {
                id: l.sellingPlanId,
                name: 'Every month',
                description: null,
                recurringDeliveries: true,
                options: [],
              },
              checkoutChargeAmount: money(27),
              priceAdjustments: [{ price: money(27), compareAtPrice: money(30), perDeliveryPrice: money(27) }],
            }
          : null,
        merchandise: {
          id: l.merchandiseId,
          title: '250g',
          sku: 'SKU-10',
          availableForSale: true,
          requiresShipping: true,
          image: null,
          price: money(30),
          compareAtPrice: null,
          selectedOptions: [{ name: 'Size', value: '250g' }],
          product: {
            id: product.id,
            title: product.title,
            handle: product.handle,
            vendor: 'Test',
            featuredImage: null,
          },
        },
      })),
    },
  };
}
