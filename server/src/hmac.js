/**
 * Shopify webhook signatures and the Worker's bearer secret. `X-Shopify-Hmac-Sha256` is base64(HMAC-SHA256(raw body,
 * secret)); the secret is the app's client secret, or the key shown under Settings → Notifications → Webhooks for
 * webhooks created in the admin.
 */

const encoder = new TextEncoder();

/** @param {string | ArrayBuffer | Uint8Array<ArrayBuffer>} body */
function bodyBytes(body) {
  if (typeof body === 'string') return encoder.encode(body);
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}

/** @param {string} secret @param {KeyUsage} usage */
function hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** @param {string} base64 @returns {Uint8Array<ArrayBuffer> | null} `null` when it isn't base64. */
function fromBase64(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    // atob throws on anything that isn't base64: not a signature.
    return null;
  }
}

/**
 * The signature Shopify would send for `body`. For tests and tools that send webhooks.
 *
 * @param {string | ArrayBuffer | Uint8Array<ArrayBuffer>} body
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function signShopify(body, secret) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), bodyBytes(body));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * True when `header` is the signature of `body` under `secret`. Web Crypto's verify compares in constant time.
 *
 * @param {string | ArrayBuffer | Uint8Array<ArrayBuffer>} body
 * @param {string | null | undefined} header The `X-Shopify-Hmac-Sha256` value.
 * @param {string} secret
 */
export async function verifyShopifyHmac(body, header, secret) {
  if (!header || !secret) return false;
  const signature = fromBase64(header.trim());
  if (!signature) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), signature, bodyBytes(body));
}

/** @param {string} text */
async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * True when the `Authorization` header is `Bearer <secret>`. Both sides are hashed first, so the comparison takes the
 * same time whatever their lengths and contents.
 *
 * @param {string | null} authorization
 * @param {string} secret
 */
export async function bearerMatches(authorization, secret) {
  if (!authorization || !secret) return false;
  const [given, expected] = await Promise.all([digest(authorization), digest(`Bearer ${secret}`)]);
  let difference = 0;
  given.forEach((byte, index) => {
    difference |= byte ^ (expected[index] ?? 0);
  });
  return difference === 0;
}
