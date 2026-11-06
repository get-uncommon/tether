// @ts-nocheck
/**
 * Shopify webhook signature: X-Shopify-Hmac-Sha256 is base64(HMAC-SHA256(raw body, secret)).
 * The secret is your app's client secret (or the key shown under
 * Settings -> Notifications -> Webhooks for webhooks created in the admin).
 */

function toBase64(bytes) {
  let s = '';
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

export async function signShopify(rawBody, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const body = typeof rawBody === 'string' ? new TextEncoder().encode(rawBody) : new Uint8Array(rawBody);
  const sig = await crypto.subtle.sign('HMAC', key, body);
  return toBase64(new Uint8Array(sig));
}

/** Constant-time comparison of two strings. */
export function safeEqual(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export async function verifyShopifyHmac(rawBody, header, secret) {
  if (!header || !secret) return false;
  return safeEqual(await signShopify(rawBody, secret), header.trim());
}
