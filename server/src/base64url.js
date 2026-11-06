/** Base64url (RFC 4648 §5, no padding) and random tokens, for the Worker's OAuth code, cookies and sealed values. */

/** @param {ArrayBuffer | Uint8Array} bytes */
export function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** @param {string} text */
export function fromBase64Url(text) {
  const base64 = text
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** A random URL-safe token of `bytes` random bytes. */
export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
