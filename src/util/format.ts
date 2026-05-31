/** Shared formatting helpers for tool responses. */

/** Truncate text to `max` characters (adding an ellipsis), or `null` if empty. */
export function truncate(text: string | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Convert an epoch-millisecond timestamp to an ISO-8601 string, or `null`. */
export function toIso(epochMs: number | undefined): string | null {
  return typeof epochMs === "number" ? new Date(epochMs).toISOString() : null;
}
