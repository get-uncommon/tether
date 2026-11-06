// A simulated Shopify for the account tests, which signs id tokens with a real RSA key, and the requests a site
// sends to the Worker's account routes.
import assert from 'node:assert/strict';
import { handleAccount, accountSettings, BASE } from '../src/account.ts';

export const SHOP = 'shop.myshopify.com';
export const SITE = 'https://shop.example';
export const WORKER = 'https://shop.example'; // a route on the shop's own domain
export const env = {
  ACCOUNT_CLIENT_ID: 'client-1',
  ACCOUNT_ORIGINS: SITE,
  SHOPIFY_DOMAIN: SHOP,
  STOREFRONT_TOKEN: 'public-token',
  ACCOUNT_SECRET: 'a-long-account-secret-of-24-plus-chars',
};
/** @param {Uint8Array} bytes */
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
/** @param {unknown} value */
const b64urlJson = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
/**
 * @param {Record<string, unknown>} claims
 * @param {{ tamper?: boolean, kid?: string | null }} [options]
 */
export async function idToken(claims, { tamper = false, kid = 'k1' } = {}) {
  const header = b64urlJson(kid ? { alg: 'RS256', kid } : { alg: 'RS256' });
  const payload = b64urlJson(claims);
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`)),
  );
  const sent = tamper ? signature.map((byte, index) => (index === 5 ? byte ^ 1 : byte)) : signature;
  return `${header}.${payload}.${b64url(sent)}`;
}

/** @typedef {{ tamper?: boolean, wrongNonce?: boolean, kid?: string | null, claims?: Record<string, unknown> }} ShopifyOptions */

/**
 * A request the simulated Shopify received: each one by its URL, and each Customer Account API call again by its
 * operation.
 *
 * @typedef {{ url: string, init: RequestInit, op?: undefined, variables?: undefined, auth?: undefined }
 *   | { op: string | undefined, variables: Record<string, unknown>, auth: string | null, url?: undefined,
 *       init?: undefined }} ShopifyCall
 */

/** @param {ShopifyOptions} [options] */
export function shopify({ tamper = false, wrongNonce = false, kid = 'k1', claims = {} } = {}) {
  /** @type {ShopifyCall[]} */
  const calls = [];
  /** @type {string | null} */
  let lastNonce = null;
  /** @type {typeof globalThis.fetch} */
  const fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });
    const headers = new Headers(init.headers);
    /**
     * @param {unknown} data
     * @param {number} [status]
     */
    const ok = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (target.endsWith('/.well-known/openid-configuration')) {
      return ok({
        issuer: 'https://shopify.com/authentication/1',
        authorization_endpoint: 'https://shopify.com/authentication/1/oauth/authorize',
        token_endpoint: 'https://shopify.com/authentication/1/oauth/token',
        end_session_endpoint: 'https://shopify.com/authentication/1/logout',
        jwks_uri: 'https://shopify.com/authentication/1/.well-known/jwks.json',
      });
    }
    if (target.endsWith('/.well-known/customer-account-api'))
      return ok({ graphql_api: 'https://shopify.com/1/account/customer/api/2026-10/graphql' });
    if (target.endsWith('/jwks.json')) return ok({ keys: [jwk] });
    if (target.endsWith('/oauth/token')) {
      const body = init.body;
      assert.ok(body instanceof URLSearchParams, 'a form body');
      assert.equal(headers.get('Origin'), SITE, 'the site origin, as Shopify expects');
      if (body.get('grant_type') === 'refresh_token') return ok({ access_token: 'access-2', expires_in: 3600 });
      const token = await idToken(
        {
          iss: 'https://shopify.com/authentication/1',
          aud: 'client-1',
          nonce: wrongNonce ? 'other' : lastNonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          sub: 'gid://shopify/Customer/1',
          ...claims,
        },
        { tamper, kid },
      );
      return ok({ access_token: 'access-1', refresh_token: 'refresh-1', id_token: token, expires_in: 3600 });
    }
    if (target.includes('/account/customer/api/')) {
      assert.ok(typeof init.body === 'string', 'a JSON body');
      const { query, variables = {} } = JSON.parse(init.body);
      const op = query.match(/(?:query|mutation)\s+(\w+)/)?.[1];
      calls.push({ op, variables, auth: headers.get('Authorization') });
      /** @param {string} id */
      const mine = (id) =>
        ['gid://shopify/Order/1', 'gid://shopify/SubscriptionContract/1', 'gid://shopify/CustomerAddress/1'].includes(
          id,
        );
      if (op === 'TetherOrder')
        return ok({
          data: {
            order: mine(variables.id)
              ? {
                  id: variables.id,
                  name: '#1001',
                  lineItems: { nodes: [{ id: 'gid://shopify/LineItem/1', title: 'Tee', quantity: 1 }] },
                  returnInformation: {
                    returnableLineItems: { nodes: [{ quantity: 1, lineItem: { id: 'gid://shopify/LineItem/1' } }] },
                  },
                }
              : null,
          },
        });
      if (op === 'TetherAddresses')
        return ok({
          data: {
            customer: {
              defaultAddress: { id: 'gid://shopify/CustomerAddress/1' },
              addresses: {
                nodes: [
                  { id: 'gid://shopify/CustomerAddress/1', city: 'Utrecht' },
                  { id: 'gid://shopify/CustomerAddress/2', city: 'Delft' },
                ],
              },
            },
          },
        });
      if (op === 'TetherSubscriptions')
        return ok({
          data: {
            customer: {
              subscriptionContracts: { nodes: [{ id: 'gid://shopify/SubscriptionContract/1', status: 'ACTIVE' }] },
            },
          },
        });
      if (op === 'TetherContract')
        return ok({
          data: {
            customer: {
              subscriptionContract: mine(variables.id)
                ? {
                    id: variables.id,
                    status: 'ACTIVE',
                    upcomingBillingCycles: { nodes: [{ cycleIndex: 3, skipped: false }] },
                  }
                : null,
            },
          },
        });
      if (op === 'TetherProfile')
        return ok({ data: { customerUpdate: { customer: variables.input, userErrors: [] } } });
      if (op === 'TetherAddressCreate')
        return ok({
          data: {
            customerAddressCreate: {
              customerAddress: { id: 'gid://shopify/CustomerAddress/9', ...variables.address },
              userErrors: variables.address.city ? [] : [{ field: ['city'], message: 'City is required' }],
            },
          },
        });
      if (op === 'TetherAddressUpdate')
        return ok({
          data: {
            customerAddressUpdate: { customerAddress: { id: variables.id, ...variables.address }, userErrors: [] },
          },
        });
      if (op === 'TetherAddressDelete')
        return ok({ data: { customerAddressDelete: { deletedAddressId: variables.id, userErrors: [] } } });
      if (op === 'TetherPause')
        return ok({
          data: { subscriptionContractPause: { contract: { id: variables.id, status: 'PAUSED' }, userErrors: [] } },
        });
      if (op === 'TetherResume')
        return ok({
          data: { subscriptionContractActivate: { contract: { id: variables.id, status: 'ACTIVE' }, userErrors: [] } },
        });
      if (op === 'TetherCancel')
        return ok({
          data: { subscriptionContractCancel: { contract: { id: variables.id, status: 'CANCELLED' }, userErrors: [] } },
        });
      if (op === 'TetherSkip')
        return ok({
          data: {
            subscriptionBillingCycleSkip: {
              billingCycle: { cycleIndex: variables.input.selector.index, skipped: true },
              userErrors: [],
            },
          },
        });
      if (op === 'TetherReturn')
        return ok({
          data: {
            orderRequestReturn: { return: { id: 'gid://shopify/Return/1', status: 'REQUESTED' }, userErrors: [] },
          },
        });
      if (/TetherOrders/.test(query))
        return ok({
          data: {
            customer: {
              orders: { nodes: [{ id: 'o1', name: '#1001', totalPrice: { amount: '10.0', currencyCode: 'EUR' } }] },
            },
          },
        });
      return ok({
        data: {
          customer: {
            id: 'c1',
            firstName: 'Ada',
            lastName: 'L',
            displayName: 'Ada L',
            emailAddress: { emailAddress: 'ada@x.test' },
            defaultAddress: null,
          },
        },
      });
    }
    if (target.includes(`${SHOP}/api/`))
      return ok({
        data: {
          cartBuyerIdentityUpdate: { cart: { checkoutUrl: 'https://shop.example/checkouts/c/1' }, userErrors: [] },
        },
      });
    throw new Error(`unexpected ${target}`);
  };
  return {
    fetch,
    calls,
    /** @param {string | null} nonce */
    setNonce: (nonce) => {
      lastNonce = nonce;
    },
  };
}

/**
 * An account request.
 *
 * @param {string} path Under the account routes' base.
 * @param {{ method?: string, origin?: string, cookie?: string, body?: unknown, header?: boolean }} [options]
 */
export const req = (path, { method = 'GET', origin, cookie, body, header = true } = {}) =>
  new Request(`${WORKER}${BASE}${path}`, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST' && header ? { 'X-Tether-Account': '1', 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** @param {Response} res A redirect. */
export function location(res) {
  const value = res.headers.get('location');
  assert.ok(value !== null, 'a redirect');
  return value;
}

/**
 * The settings of an env with an `ACCOUNT_CLIENT_ID`, without which there are none.
 *
 * @param {Record<string, unknown>} rawEnv
 */
export function configured(rawEnv) {
  const settings = accountSettings(rawEnv);
  assert.ok(settings);
  return settings;
}

/** @param {Response} res */
export const cookiesOf = (res) => res.headers.getSetCookie();
/**
 * @param {Response} res
 * @param {string} name
 * @returns {string} The cookie's `name=value`, or `''` when `res` doesn't set it.
 */
export const pick = (res, name) =>
  (cookiesOf(res).find((cookie) => cookie.startsWith(`${name}=`)) ?? '').split(';')[0] ?? '';

/**
 * Every request these tests send is under the account routes' base, which `handleAccount` always answers.
 *
 * @param {Parameters<typeof handleAccount>[0]} request
 * @param {Parameters<typeof handleAccount>[1]} environment
 * @param {Parameters<typeof handleAccount>[2]} [options]
 */
export async function answer(request, environment, options) {
  const response = await handleAccount(request, environment, options);
  assert.ok(response, 'an account route is answered');
  return response;
}

/** @typedef {typeof globalThis.fetch} Fetch */

/**
 * @param {ShopifyOptions & { memory?: import('../src/account/kv.ts').MemoryEntries, wrapFetch?: (inner: Fetch) => Fetch,
 *   sessionCookie?: string }} [options]
 */
export async function loginFlow({ memory = new Map(), wrapFetch = (inner) => inner, sessionCookie, ...opts } = {}) {
  const sh = shopify(opts);
  const fetch = wrapFetch(sh.fetch);
  /** @param {Request} request */
  const run = (request) => answer(request, env, { fetch, memory });
  const start = await run(req(`/login?returnTo=${encodeURIComponent(`${SITE}/account`)}`));
  const authorize = new URL(location(start));
  sh.setNonce(authorize.searchParams.get('nonce'));
  const loginCookie = pick(start, '__Host-tether-login');
  const callbackPath = `/callback?code=the-code&state=${authorize.searchParams.get('state')}`;
  const back = await run(req(callbackPath, { cookie: [loginCookie, sessionCookie].filter(Boolean).join('; ') }));
  return {
    sh,
    memory,
    run,
    start,
    authorize,
    back,
    loginCookie,
    callbackPath,
    cookie: pick(back, '__Host-tether-account'),
  };
}

/** @param {import('../src/account/kv.ts').MemoryEntries} memory */
export const sessionKeys = (memory) => [...memory.keys()].filter((key) => key.startsWith('s:'));

/**
 * A login from `returnTo` to its landing page, with what it logged as a warning.
 *
 * @param {string} returnTo
 */
export async function loginFrom(returnTo) {
  const sh = shopify();
  /** @param {Request} request */
  const run = (request) => answer(request, env, { fetch: sh.fetch, memory: new Map() });
  /** @type {string[]} */
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    const start = await run(req(`/login?returnTo=${encodeURIComponent(returnTo)}`));
    const loginCookie = pick(start, '__Host-tether-login');
    const authorize = new URL(location(start));
    sh.setNonce(authorize.searchParams.get('nonce'));
    const back = await run(
      req(`/callback?code=c&state=${authorize.searchParams.get('state')}`, { cookie: loginCookie }),
    );
    return { loginCookie, landed: location(back), warned };
  } finally {
    console.warn = realWarn;
  }
}
