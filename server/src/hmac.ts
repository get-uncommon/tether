/**
 * Shopify webhook signatures and the Worker's bearer secret. `X-Shopify-Hmac-Sha256` is base64(HMAC-SHA256(raw body,
 * secret)); the secret is the app's client secret, or the key shown under Settings → Notifications → Webhooks for
 * webhooks created in the admin.
 */

import { sha256 } from './crypto.ts';

const encoder = new TextEncoder();

type Body = string | ArrayBuffer | Uint8Array<ArrayBuffer>;

function bodyBytes(body: Body): Uint8Array<ArrayBuffer> {
  if (typeof body === 'string') return encoder.encode(body);
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}

function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** `null` when `base64` isn't base64. */
function fromBase64(base64: string): Uint8Array<ArrayBuffer> | null {
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

/** The signature Shopify would send for `body`. For tests and tools that send webhooks. */
export async function signShopify(body: Body, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), bodyBytes(body));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * True when `header` is the signature of `body` under `secret`. Web Crypto's verify compares in constant time.
 *
 * @param header The `X-Shopify-Hmac-Sha256` value.
 */
export async function verifyShopifyHmac(
  body: Body,
  header: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const signature = fromBase64(header.trim());
  if (!signature) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), signature, bodyBytes(body));
}

/**
 * True when the `Authorization` header is `Bearer <secret>`. Both sides are hashed first, so the comparison takes the
 * same time whatever their lengths and contents.
 */
export async function bearerMatches(authorization: string | null, secret: string): Promise<boolean> {
  if (!authorization || !secret) return false;
  const [given, expected] = await Promise.all([sha256(authorization), sha256(`Bearer ${secret}`)]);
  let difference = 0;
  given.forEach((byte, index) => {
    difference |= byte ^ (expected[index] ?? 0);
  });
  return difference === 0;
}
