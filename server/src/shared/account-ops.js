/**
 * The customer account operations, as fixed GraphQL documents with validated inputs: there is no query passthrough.
 * Every operation runs with the logged-in customer's own Customer Account API token, and that token is what keeps
 * Shopify to that customer's data. Ids are also checked for their type, so a malformed id never reaches Shopify.
 *
 * The Worker runs them in server mode, behind the routes in `OPERATION_ROUTES`, and the browser runs the same
 * documents in browser mode.
 */
import { field, isRecord } from './json.js';

/**
 * Runs one of the documents below with the customer's token.
 *
 * @typedef {(query: string, variables: Record<string, unknown>) => Promise<Record<string, unknown> | null>} Ask
 */

/** @typedef {Record<string, unknown>} OperationInput */
/** @typedef {Record<string, unknown>} OperationResult */
/** @typedef {{ field?: string[] | null, message: string }} UserError */

/** Input the operation refuses, or a `userErrors` answer from Shopify. Its message is safe to show the customer. */
export class InputError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, userErrors?: UserError[] }} [details]
   */
  constructor(message, { status = 400, userErrors = [] } = {}) {
    super(message);
    this.name = 'InputError';
    /** The HTTP status the Worker answers with. */
    this.status = status;
    /** Shopify's own errors for the input, when it refused it. */
    this.userErrors = userErrors;
  }
}

const MONEY = 'amount currencyCode';
const ADDRESS =
  'id firstName lastName company address1 address2 city province zoneCode zip country countryCode phoneNumber formatted';
const USER_ERRORS = 'userErrors { field message }';

const QUERIES = {
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

const MUTATIONS = {
  profile: `mutation TetherProfile($input: CustomerUpdateInput!) { customerUpdate(input: $input) { customer { firstName lastName } ${USER_ERRORS} } }`,
  addressCreate: `mutation TetherAddressCreate($address: CustomerAddressInput!, $default: Boolean) { customerAddressCreate(address: $address, defaultAddress: $default) { customerAddress { ${ADDRESS} } ${USER_ERRORS} } }`,
  addressUpdate: `mutation TetherAddressUpdate($id: ID!, $address: CustomerAddressInput, $default: Boolean) { customerAddressUpdate(addressId: $id, address: $address, defaultAddress: $default) { customerAddress { ${ADDRESS} } ${USER_ERRORS} } }`,
  addressDelete: `mutation TetherAddressDelete($id: ID!) { customerAddressDelete(addressId: $id) { deletedAddressId ${USER_ERRORS} } }`,
  returnRequest: `mutation TetherReturn($orderId: ID!, $lines: [RequestedLineItemInput!]!) { orderRequestReturn(orderId: $orderId, requestedLineItems: $lines) { return { id status } ${USER_ERRORS} } }`,
};

/**
 * What each subscription action sends: its document and the payload field Shopify answers in.
 *
 * @type {Record<SubscriptionAction, { document: string, payload: string, input: 'contract' | 'billingCycle' }>}
 */
const SUBSCRIPTION_ACTIONS = {
  pause: {
    document: `mutation TetherPause($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) { contract { id status } ${USER_ERRORS} } }`,
    payload: 'subscriptionContractPause',
    input: 'contract',
  },
  resume: {
    document: `mutation TetherResume($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { contract { id status } ${USER_ERRORS} } }`,
    payload: 'subscriptionContractActivate',
    input: 'contract',
  },
  cancel: {
    document: `mutation TetherCancel($id: ID!) { subscriptionContractCancel(subscriptionContractId: $id) { contract { id status } ${USER_ERRORS} } }`,
    payload: 'subscriptionContractCancel',
    input: 'contract',
  },
  skip: {
    document: `mutation TetherSkip($input: SubscriptionBillingCycleInput!) { subscriptionBillingCycleSkip(billingCycleInput: $input) { billingCycle { cycleIndex skipped } ${USER_ERRORS} } }`,
    payload: 'subscriptionBillingCycleSkip',
    input: 'billingCycle',
  },
  unskip: {
    document: `mutation TetherUnskip($input: SubscriptionBillingCycleInput!) { subscriptionBillingCycleUnskip(billingCycleInput: $input) { billingCycle { cycleIndex skipped } ${USER_ERRORS} } }`,
    payload: 'subscriptionBillingCycleUnskip',
    input: 'billingCycle',
  },
};

/** @typedef {'pause' | 'resume' | 'skip' | 'unskip' | 'cancel'} SubscriptionAction */

/** @param {unknown} value @returns {value is SubscriptionAction} */
function isSubscriptionAction(value) {
  return typeof value === 'string' && Object.hasOwn(SUBSCRIPTION_ACTIONS, value);
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function listOf(value) {
  if (!Array.isArray(value)) return [];
  /** @type {unknown[]} */
  const list = value;
  return list;
}

/** @param {unknown} value @returns {unknown[]} */
function nodes(value) {
  return listOf(field(value, 'nodes'));
}

/** @typedef {'Order' | 'CustomerAddress' | 'SubscriptionContract' | 'LineItem' | 'ReturnReasonDefinition'} IdType */

const NUMERIC_ID = /^\d{1,20}$/;

/**
 * A gid of exactly this type; a numeric id becomes `gid://shopify/<type>/<id>`.
 *
 * @param {IdType} type
 * @param {unknown} value
 * @throws {InputError} For anything else.
 */
function idOf(type, value) {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const id = NUMERIC_ID.test(raw) ? `gid://shopify/${type}/${raw}` : raw;
  if (!new RegExp(`^gid://shopify/${type}/\\d+(\\?[\\w=&.-]{1,80})?$`).test(id)) throw new InputError(`${type} id`);
  return id;
}

/** Control characters, which no customer-facing text field needs. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * A bounded single-line text, or `undefined` when empty.
 *
 * @param {unknown} value
 * @param {number} [maxLength]
 * @throws {InputError} For a non-text value or one longer than `maxLength`.
 */
function text(value, maxLength = 255) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') throw new InputError('text');
  const clean = String(value).replace(CONTROL_CHARACTERS, '').trim();
  if (clean.length > maxLength) throw new InputError('too long');
  return clean;
}

const ADDRESS_FIELDS = [
  'firstName',
  'lastName',
  'company',
  'address1',
  'address2',
  'city',
  'zip',
  'zoneCode',
  'phoneNumber',
];

/**
 * Only the `CustomerAddressInput` fields, as bounded strings, with `countryCode` as two letters. On an update
 * (`clear: true`) a field sent empty is cleared (`''`) instead of left out, so an emptied apartment line or phone
 * number really goes away.
 *
 * @param {unknown} address
 * @param {{ clear?: boolean }} [options]
 * @returns {Record<string, string>}
 */
export function addressInput(address, { clear = false } = {}) {
  if (!isRecord(address)) throw new InputError('address');
  const source = address;
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of ADDRESS_FIELDS) {
    const value = text(source[key]);
    if (value !== undefined) out[key] = value;
    else if (clear && key in source && (source[key] === '' || source[key] === null)) out[key] = '';
  }
  const country = text(source['countryCode']);
  if (country !== undefined) {
    const code = country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new InputError('countryCode');
    out['countryCode'] = code;
  }
  return out;
}

/** The message of a user error Shopify sent without one. */
const UNEXPLAINED_USER_ERROR = 'Shopify refused the change';

/**
 * One entry of Shopify's `userErrors`. An entry without a message still refuses the input, so it gets one.
 *
 * @param {unknown} value
 * @returns {UserError}
 */
function userErrorOf(value) {
  const message = field(value, 'message');
  const path = listOf(field(value, 'field'));
  const fieldPath = path.filter((part) => typeof part === 'string');
  return {
    field: path.length && fieldPath.length === path.length ? fieldPath : null,
    message: typeof message === 'string' && message ? message : UNEXPLAINED_USER_ERROR,
  };
}

/**
 * The mutation's payload, or an `InputError` with Shopify's `userErrors`.
 *
 * @param {Record<string, unknown> | null} data
 * @param {string} name The payload field.
 */
function payloadOf(data, name) {
  const payload = field(data, name);
  const userErrors = listOf(field(payload, 'userErrors')).map(userErrorOf);
  if (userErrors.length) {
    throw new InputError(userErrors.map((error) => error.message).join(' | '), { userErrors });
  }
  return payload;
}

/** @typedef {(ask: Ask, input: OperationInput) => Promise<OperationResult>} Operation */

/** @satisfies {Record<string, Operation>} */
export const ops = {
  async order(ask, { id }) {
    const data = await ask(QUERIES.order, { id: idOf('Order', id) });
    return { order: field(data, 'order') ?? null };
  },

  async profile(ask, { firstName, lastName }) {
    /** @type {Record<string, string>} */
    const input = {};
    if (firstName !== undefined) input['firstName'] = text(firstName, 100) ?? '';
    if (lastName !== undefined) input['lastName'] = text(lastName, 100) ?? '';
    if (!Object.keys(input).length) throw new InputError('nothing to change');
    const payload = payloadOf(await ask(MUTATIONS.profile, { input }), 'customerUpdate');
    return { customer: field(payload, 'customer') };
  },

  async addresses(ask) {
    const customer = field(await ask(QUERIES.addresses, {}), 'customer');
    const defaultId = field(field(customer, 'defaultAddress'), 'id') ?? null;
    const addresses = nodes(field(customer, 'addresses')).map((address) => ({
      ...(isRecord(address) ? address : {}),
      isDefault: field(address, 'id') === defaultId,
    }));
    return { addresses };
  },

  async saveAddress(ask, { id, address, isDefault }) {
    const fields = addressInput(address ?? {}, { clear: Boolean(id) });
    const makeDefault = isDefault === true;
    if (!id) {
      const created = await ask(MUTATIONS.addressCreate, { address: fields, default: makeDefault });
      return { address: field(payloadOf(created, 'customerAddressCreate'), 'customerAddress') };
    }
    // An update without fields only sets the default.
    const updated = await ask(MUTATIONS.addressUpdate, {
      id: idOf('CustomerAddress', id),
      address: Object.keys(fields).length ? fields : null,
      default: makeDefault ? true : null,
    });
    return { address: field(payloadOf(updated, 'customerAddressUpdate'), 'customerAddress') };
  },

  async deleteAddress(ask, { id }) {
    const data = await ask(MUTATIONS.addressDelete, { id: idOf('CustomerAddress', id) });
    return { deleted: field(payloadOf(data, 'customerAddressDelete'), 'deletedAddressId') };
  },

  async subscriptions(ask) {
    const contracts = field(field(await ask(QUERIES.subscriptions, {}), 'customer'), 'subscriptionContracts');
    return { subscriptions: nodes(contracts) };
  },

  async subscription(ask, { id, action }) {
    if (!isSubscriptionAction(action)) throw new InputError('action');
    const contractId = idOf('SubscriptionContract', id);
    // Read first because skip and unskip need the contract's upcoming billing cycles; an id that isn't the customer's
    // then answers 404 here rather than as the mutation's less specific error.
    const contract = field(field(await ask(QUERIES.contract, { id: contractId }), 'customer'), 'subscriptionContract');
    if (!contract) throw new InputError('not found', { status: 404 });
    const { document, payload, input } = SUBSCRIPTION_ACTIONS[action];
    if (input === 'contract') {
      return { contract: field(payloadOf(await ask(document, { id: contractId }), payload), 'contract') };
    }
    const cycles = nodes(field(contract, 'upcomingBillingCycles'));
    const wantSkipped = action === 'unskip';
    const cycle = cycles.find((candidate) => Boolean(field(candidate, 'skipped')) === wantSkipped);
    if (!cycle) throw new InputError(wantSkipped ? 'nothing skipped' : 'no upcoming delivery to skip');
    const variables = { input: { contractId, selector: { index: field(cycle, 'cycleIndex') } } };
    return { billingCycle: field(payloadOf(await ask(document, variables), payload), 'billingCycle') };
  },

  async requestReturn(ask, { orderId, lines }) {
    const order = idOf('Order', orderId);
    if (!Array.isArray(lines) || !lines.length || lines.length > 50) throw new InputError('lines');
    const requested = lines.map((/** @type {unknown} */ line) => {
      const quantity = Number(field(line, 'quantity'));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new InputError('quantity');
      /** @type {Record<string, unknown>} */
      const out = { lineItemId: idOf('LineItem', field(line, 'lineItemId')), quantity };
      const reason = field(line, 'reasonId');
      if (reason) out['returnReasonDefinitionId'] = idOf('ReturnReasonDefinition', reason);
      const note = text(field(line, 'note'), 300);
      if (note) out['customerNote'] = note;
      return out;
    });
    const data = await ask(MUTATIONS.returnRequest, { orderId: order, lines: requested });
    return { return: field(payloadOf(data, 'orderRequestReturn'), 'return') };
  },
};

/** @typedef {keyof typeof ops} OperationName */
/** @typedef {{ name: OperationName, input: OperationInput }} OperationCall */

/**
 * The Worker's route for an operation: its method and path under `/_tether/account`, and the input fields it reads,
 * from the query string for a GET and from the JSON body for a POST.
 *
 * @template {OperationName} Name
 * @typedef {{ name: Name, method: 'GET' | 'POST', path: string, fields: readonly string[] }} OperationRoute
 */

/** @satisfies {{ [Name in OperationName]: OperationRoute<Name> }} */
export const OPERATION_ROUTES = {
  order: { name: 'order', method: 'GET', path: '/order', fields: ['id'] },
  addresses: { name: 'addresses', method: 'GET', path: '/addresses', fields: [] },
  subscriptions: { name: 'subscriptions', method: 'GET', path: '/subscriptions', fields: [] },
  profile: { name: 'profile', method: 'POST', path: '/profile', fields: ['firstName', 'lastName'] },
  saveAddress: { name: 'saveAddress', method: 'POST', path: '/address', fields: ['id', 'address', 'isDefault'] },
  deleteAddress: { name: 'deleteAddress', method: 'POST', path: '/address/delete', fields: ['id'] },
  subscription: { name: 'subscription', method: 'POST', path: '/subscription', fields: ['id', 'action'] },
  requestReturn: { name: 'requestReturn', method: 'POST', path: '/return', fields: ['orderId', 'lines'] },
};

/** The route of each `METHOD /path`. */
const ROUTE_BY_REQUEST = new Map(
  Object.values(OPERATION_ROUTES).map((route) => [`${route.method} ${route.path}`, route]),
);

/**
 * The operation a Worker request asks for, with its input read from the query string or the body.
 *
 * @param {string} method
 * @param {string} path The path under `/_tether/account`.
 * @param {URL} url
 * @param {Record<string, unknown>} body The JSON body of a POST; `{}` for a GET.
 * @returns {OperationCall | null} `null` when no operation has this method and path.
 */
export function operationCall(method, path, url, body) {
  const route = ROUTE_BY_REQUEST.get(`${method} ${path}`);
  if (!route) return null;
  /** @type {OperationInput} */
  const input = {};
  for (const name of route.fields) input[name] = route.method === 'GET' ? url.searchParams.get(name) : body[name];
  return { name: route.name, input };
}

/**
 * The method and path (with its query string, for a GET) the browser requests an operation with in server mode. A
 * POST sends the input as its JSON body.
 *
 * @param {OperationName} name
 * @param {OperationInput} input
 * @returns {{ method: 'GET' | 'POST', path: string }}
 */
export function operationRequest(name, input) {
  const route = OPERATION_ROUTES[name];
  if (route.method === 'POST') return { method: 'POST', path: route.path };
  const query = new URLSearchParams();
  for (const fieldName of route.fields) {
    const value = input[fieldName];
    if (typeof value === 'string' || typeof value === 'number') query.set(fieldName, String(value));
  }
  const search = query.toString();
  return { method: 'GET', path: search ? `${route.path}?${search}` : route.path };
}
