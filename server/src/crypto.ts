/**
 * Sealing for anything the Worker stores or hands to a browser: AES-GCM with one HKDF-derived key per purpose, bound
 * to where the value lives (a KV key or a cookie name) so a sealed value cannot be moved elsewhere. Web Crypto only,
 * so it runs in Workers and Node alike.
 */

import { fromBase64Url, toBase64Url } from './base64url.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Fixed HKDF salt. Changing it makes every stored session and cached token unreadable. */
const KEY_SALT = encoder.encode('tether-account-v1');

export async function sha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const keys = new Map<string, Promise<CryptoKey>>();

function aesKey(secret: string, purpose: string): Promise<CryptoKey> {
  const id = `${purpose}:${secret}`;
  let key = keys.get(id);
  if (!key) {
    key = crypto.subtle
      .importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: KEY_SALT, info: encoder.encode(purpose) },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    keys.set(id, key);
  }
  return key;
}

/**
 * Encrypts `data` (as JSON) for one purpose, bound to `bind`.
 *
 * @returns `iv.ciphertext`, both base64url.
 */
export async function seal(secret: string, purpose: string, bind: string, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(bind) },
    await aesKey(secret, purpose),
    encoder.encode(JSON.stringify(data)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

/**
 * The data `seal` encrypted with the same secret, purpose and bind; `null` for anything else, including a value
 * sealed for another purpose or place, a tampered one, or one that was never sealed.
 */
export async function open(secret: string, purpose: string, bind: string, sealed: unknown): Promise<unknown> {
  if (typeof sealed !== 'string') return null;
  const [iv, ciphertext] = sealed.split('.');
  if (!iv || !ciphertext) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: encoder.encode(bind) },
      await aesKey(secret, purpose),
      fromBase64Url(ciphertext),
    );
    const data: unknown = JSON.parse(decoder.decode(plain));
    return data;
  } catch {
    // AES-GCM rejects a wrong key, bind or tampered value: all mean "not ours".
    return null;
  }
}
