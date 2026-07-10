/** Deterministic fallback title: the first user message, cleaned and truncated at a word boundary. */
export function deriveTitleFromMessage(content: string): string {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 50) return cleaned;
  const truncated = cleaned.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…';
}
