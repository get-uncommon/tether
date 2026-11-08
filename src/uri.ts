/**
 * Decoding of percent-escaped text the page hands Tether (a path segment, a cookie value), which nothing guarantees
 * is well formed.
 */

/** @returns `text` decoded, or as written when it has a malformed escape (`%E0%A4%A`). */
export function decodeOrKeep(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch (error) {
    if (error instanceof URIError) return text;
    throw error;
  }
}
