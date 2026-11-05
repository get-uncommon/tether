/**
 * The customer account operations the Worker allows, as fixed GraphQL documents with validated
 * inputs: no query passthrough. Every one runs with the logged-in customer's own Customer Account
 * API token, so Shopify only ever returns or changes that customer's data; ids are also checked
 * for their type, and subscription contracts are looked up through the customer first.
 *
 * Used by the Worker (server mode); the browser part has the same documents for browser mode.
 */

const MONEY = 'amount currencyCode';
const ADDRESS = 'id firstName lastName company address1 address2 city province zoneCode zip country countryCode phoneNumber formatted';

export const Q = {
  order: `query TetherOrder($id: ID!) { order(id: $id) {
  id name number processedAt cancelledAt financialStatus fulfillmentStatus statusPageUrl requiresShipping
  totalPrice { ${MONEY} } subtotal { ${MONEY} } totalShipping { ${MONEY} } totalTax { ${MONEY} }
  shippingAddress { ${ADDRESS} } billingAddress { ${ADDRESS} }
  lineItems(first: 50) { nodes { id name title variantTitle quantity sku image { url altText } price { ${MONEY} } totalPrice { ${MONEY} }
    suggestedReturnReasonDefinitions(first: 10) { nodes { id name handle } } } }
  fulfillments(first: 10) { nodes { id status createdAt estimatedDeliveryAt latestShipmentStatus trackingInformation { company number url } } }
  returnInformation { returnableLineItems(first: 50) { nodes { quantity lineItem { id } } } }
  returns(first: 10) { nodes { id status } }
} }`,
  addresses: `query TetherAddresses { customer { defaultAddress { id } addresses(first: 20) { nodes { ${ADDRESS} } } } }`,
  subscriptions: `query TetherSubscriptions { customer { subscriptionContracts(first: 20, reverse: true) { nodes {
  id status nextBillingDate currencyCode deliveryPrice { ${MONEY} }
  deliveryPolicy { interval intervalCount { count } }
  lines(first: 20) { nodes { id name title variantTitle quantity sku currentPrice { ${MONEY} } lineDiscountedPrice { ${MONEY} } image { url altText } } }
  upcomingBillingCycles(first: 3) { nodes { cycleIndex skipped billingAttemptExpectedDate } }
} } } }`,
  contract: `query TetherContract($id: ID!) { customer { subscriptionContract(id: $id) { id status upcomingBillingCycles(first: 3) { nodes { cycleIndex skipped } } } } }`,
};

const M = {
  profile: 'mutation TetherProfile($input: CustomerUpdateInput!) { customerUpdate(input: $input) { customer { firstName lastName } userErrors { field message } } }',
  addressCreate: `mutation TetherAddressCreate($address: CustomerAddressInput!, $default: Boolean) { customerAddressCreate(address: $address, defaultAddress: $default) { customerAddress { ${ADDRESS} } userErrors { field message } } }`,
  addressUpdate: `mutation TetherAddressUpdate($id: ID!, $address: CustomerAddressInput, $default: Boolean) { customerAddressUpdate(addressId: $id, address: $address, defaultAddress: $default) { customerAddress { ${ADDRESS} } userErrors { field message } } }`,
  addressDelete: 'mutation TetherAddressDelete($id: ID!) { customerAddressDelete(addressId: $id) { deletedAddressId userErrors { field message } } }',
  pause: 'mutation TetherPause($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }',
  resume: 'mutation TetherResume($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }',
  cancel: 'mutation TetherCancel($id: ID!) { subscriptionContractCancel(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }',
  skip: 'mutation TetherSkip($input: SubscriptionBillingCycleInput!) { subscriptionBillingCycleSkip(billingCycleInput: $input) { billingCycle { cycleIndex skipped } userErrors { field message } } }',
  unskip: 'mutation TetherUnskip($input: SubscriptionBillingCycleInput!) { subscriptionBillingCycleUnskip(billingCycleInput: $input) { billingCycle { cycleIndex skipped } userErrors { field message } } }',
  returnRequest: 'mutation TetherReturn($orderId: ID!, $lines: [RequestedLineItemInput!]!) { orderRequestReturn(orderId: $orderId, requestedLineItems: $lines) { return { id status } userErrors { field message } } }',
};

// ---------------------------------------------------------------- input checks

export class InputError extends Error {}
const gid = (type) => new RegExp(`^gid://shopify/${type}/\\d+(\\?[\\w=&.-]{1,80})?$`);
const IDS = {
  Order: gid('Order'), CustomerAddress: gid('CustomerAddress'), SubscriptionContract: gid('SubscriptionContract'),
  LineItem: gid('LineItem'), ReturnReasonDefinition: gid('ReturnReasonDefinition'),
};
/** A gid of exactly this type ('123' becomes gid://shopify/Type/123). */
export function idOf(type, value) {
  const v = /^\d{1,20}$/.test(String(value ?? '')) ? `gid://shopify/${type}/${value}` : String(value ?? '');
  if (!IDS[type].test(v)) throw new InputError(`${type} id`);
  return v;
}
const text = (v, max = 255) => {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string' && typeof v !== 'number') throw new InputError('text');
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length > max) throw new InputError('too long');
  return s;
};
const ADDRESS_FIELDS = ['firstName', 'lastName', 'company', 'address1', 'address2', 'city', 'zip', 'zoneCode', 'phoneNumber'];
/**
 * Only the CustomerAddressInput fields, as bounded strings; countryCode two letters. On an update
 * (clear: true) a field sent empty is cleared ('') instead of left out, so an emptied apartment
 * line or phone number really goes away.
 */
export function addressInput(a = {}, { clear = false } = {}) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new InputError('address');
  const out = {};
  ADDRESS_FIELDS.forEach((k) => {
    const v = text(a[k]);
    if (v !== undefined) out[k] = v;
    else if (clear && k in a && (a[k] === '' || a[k] === null)) out[k] = '';
  });
  if (a.countryCode != null && a.countryCode !== '') {
    const c = String(a.countryCode).toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw new InputError('countryCode');
    out.countryCode = c;
  }
  return out;
}
const userErrors = (payload) => {
  const errs = payload?.userErrors || [];
  if (errs.length) { const e = new InputError(errs.map((x) => x.message).join(' | ')); e.userErrors = errs; throw e; }
  return payload;
};

// ---------------------------------------------------------------- operations

/**
 * ask(query, variables) runs a fixed document with the customer's token. Each operation returns
 * plain data for the browser.
 */
export const ops = {
  async order(ask, { id }) {
    const data = await ask(Q.order, { id: idOf('Order', id) });
    return { order: data?.order || null };
  },
  async profile(ask, { firstName, lastName }) {
    const input = {};
    if (firstName !== undefined) input.firstName = text(firstName, 100) ?? '';
    if (lastName !== undefined) input.lastName = text(lastName, 100) ?? '';
    if (!Object.keys(input).length) throw new InputError('nothing to change');
    const p = userErrors((await ask(M.profile, { input }))?.customerUpdate);
    return { customer: p.customer };
  },
  async addresses(ask) {
    const c = (await ask(Q.addresses, {}))?.customer;
    const def = c?.defaultAddress?.id || null;
    return { addresses: (c?.addresses?.nodes || []).map((a) => ({ ...a, isDefault: a.id === def })) };
  },
  async saveAddress(ask, { id, address, isDefault }) {
    const a = addressInput(address || {}, { clear: Boolean(id) });
    const def = isDefault === true ? true : undefined;
    const p = id // an update without fields only sets the default
      ? userErrors((await ask(M.addressUpdate, { id: idOf('CustomerAddress', id), address: Object.keys(a).length ? a : null, default: def ?? null }))?.customerAddressUpdate)
      : userErrors((await ask(M.addressCreate, { address: a, default: def ?? false }))?.customerAddressCreate);
    return { address: p.customerAddress };
  },
  async deleteAddress(ask, { id }) {
    const p = userErrors((await ask(M.addressDelete, { id: idOf('CustomerAddress', id) }))?.customerAddressDelete);
    return { deleted: p.deletedAddressId };
  },
  async subscriptions(ask) {
    return { subscriptions: (await ask(Q.subscriptions, {}))?.customer?.subscriptionContracts?.nodes || [] };
  },
  async subscription(ask, { id, action }) {
    if (!['pause', 'resume', 'skip', 'unskip', 'cancel'].includes(action)) throw new InputError('action');
    const contractId = idOf('SubscriptionContract', id);
    // Looked up through the customer: a contract that isn't theirs is simply not found.
    const contract = (await ask(Q.contract, { id: contractId }))?.customer?.subscriptionContract;
    if (!contract) { const e = new InputError('not found'); e.status = 404; throw e; }
    if (action === 'skip' || action === 'unskip') {
      const cycles = contract.upcomingBillingCycles?.nodes || [];
      const cycle = action === 'skip' ? cycles.find((c) => !c.skipped) : cycles.find((c) => c.skipped);
      if (!cycle) throw new InputError(action === 'skip' ? 'no upcoming delivery to skip' : 'nothing skipped');
      const p = userErrors((await ask(M[action], { input: { contractId, selector: { index: cycle.cycleIndex } } }))?.[action === 'skip' ? 'subscriptionBillingCycleSkip' : 'subscriptionBillingCycleUnskip']);
      return { billingCycle: p.billingCycle };
    }
    const name = { pause: 'subscriptionContractPause', resume: 'subscriptionContractActivate', cancel: 'subscriptionContractCancel' }[action];
    const p = userErrors((await ask(M[action], { id: contractId }))?.[name]);
    return { contract: p.contract };
  },
  async requestReturn(ask, { orderId, lines }) {
    const oid = idOf('Order', orderId);
    if (!Array.isArray(lines) || !lines.length || lines.length > 50) throw new InputError('lines');
    const requested = lines.map((l) => {
      const q = Number(l?.quantity);
      if (!Number.isInteger(q) || q < 1 || q > 1000) throw new InputError('quantity');
      const out = { lineItemId: idOf('LineItem', l.lineItemId), quantity: q };
      if (l.reasonId) out.returnReasonDefinitionId = idOf('ReturnReasonDefinition', l.reasonId);
      const note = text(l.note, 300);
      if (note) out.customerNote = note;
      return out;
    });
    const p = userErrors((await ask(M.returnRequest, { orderId: oid, lines: requested }))?.orderRequestReturn);
    return { return: p.return };
  },
};

/** Worker routes: method + path -> operation, and where its input comes from. */
export const ROUTES = {
  'GET /order': (url) => ['order', { id: url.searchParams.get('id') }],
  'GET /addresses': () => ['addresses', {}],
  'GET /subscriptions': () => ['subscriptions', {}],
  'POST /profile': (url, body) => ['profile', { firstName: body.firstName, lastName: body.lastName }],
  'POST /address': (url, body) => ['saveAddress', { id: body.id, address: body.address, isDefault: body.isDefault }],
  'POST /address/delete': (url, body) => ['deleteAddress', { id: body.id }],
  'POST /subscription': (url, body) => ['subscription', { id: body.id, action: body.action }],
  'POST /return': (url, body) => ['requestReturn', { orderId: body.orderId, lines: body.lines }],
};
