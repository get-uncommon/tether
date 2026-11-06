/**
 * Sealing for anything the Worker stores or hands to a browser: AES-GCM with one HKDF-derived key per purpose, bound
 * to where the value lives (a KV key or a cookie name) so a sealed value cannot be moved elsewhere. Web Crypto only,
 * so it runs in Workers and Node 20+.
 */

import { fromBase64Url, toBase64Url } from './base64url.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Fixed HKDF salt. Changing it makes every stored session and cached token unreadable. */
const KEY_SALT = encoder.encode('tether-account-v1');

/** @param {string} text */
export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** @param {Uint8Array} bytes */
export function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @type {Map<string, Promise<CryptoKey>>} */
const keys = new Map();

/**
 * @param {string} secret
 * @param {string} purpose
 */
function aesKey(secret, purpose) {
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
 * @param {string} secret
 * @param {string} purpose
 * @param {string} bind
 * @param {unknown} data
 * @returns {Promise<string>} `iv.ciphertext`, both base64url.
 */
export async function seal(secret, purpose, bind, data) {
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
 *
 * @param {string} secret
 * @param {string} purpose
 * @param {string} bind
 * @param {unknown} sealed
 * @returns {Promise<unknown>}
 */
export async function open(secret, purpose, bind, sealed) {
  if (typeof sealed !== 'string') return null;
  const [iv, ciphertext] = sealed.split('.');
  if (!iv || !ciphertext) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: encoder.encode(bind) },
      await aesKey(secret, purpose),
      fromBase64Url(ciphertext),
    );
    /** @type {unknown} */
    const data = JSON.parse(decoder.decode(plain));
    return data;
  } catch {
    // AES-GCM rejects a wrong key, bind or tampered value: all mean "not ours".
    return null;
  }
}
