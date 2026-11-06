/**
 * Reading a request body up to a size limit, for the webhook endpoint in the Worker (a web `Request`) and in the Node
 * server (an `IncomingMessage`): reading stops at the limit, so a body past it is never buffered whole.
 */

/**
 * The body, or `null` once it passes `maxBytes`; the source is then left unread.
 */
export async function readCapped(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > maxBytes) return null;
    parts.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/** A web stream's chunks. Stopping early (`readCapped` past its limit) cancels the stream. */
export async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = stream.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      yield value;
    }
  } finally {
    if (!finished) await reader.cancel();
  }
}
