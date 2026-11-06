/** The text of anything thrown: an `Error`'s message, or the value itself written as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
