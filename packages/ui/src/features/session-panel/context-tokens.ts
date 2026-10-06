/**
 * context-tokens — token sizes for the panel's context rows.
 *
 * `ContextFile` ships its full content but no token count, so the size is a
 * client-side chars/4 estimate. `formatTokens` keeps the tilde that makes the
 * approximation visible; `formatTokenCount` is the same scale without it, for
 * the CLI-reported counts that are exact.
 */

/** Rough tokenizer stand-in: four characters per token, rounded up. */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/** `3.2k` / `200k` / `999`. */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  // "1M" / "200K" — the same spelling `modelDisplayLabel` uses for the window.
  if (tokens >= 1_000_000) {
    const millions = (tokens / 1_000_000).toFixed(1);
    return `${millions.endsWith('.0') ? millions.slice(0, -2) : millions}M`;
  }
  const thousands = (tokens / 1000).toFixed(1);
  return `${thousands.endsWith('.0') ? thousands.slice(0, -2) : thousands}K`;
}

/** `~3.2k` — the tilde marks an estimate rather than a measurement. */
export function formatTokens(tokens: number): string {
  return `~${formatTokenCount(tokens)}`;
}
