/**
 * Pure serializer for the segment model (spec §2.3). Turns committed segments
 * plus the live (native-input) segment into one markdown string — the exact
 * shape that leaves as message content.
 */
import type { Segment } from './segment-model';

function renderSegment(quote: string | null, text: string): string {
  if (quote == null) return text.trim() ? text : '';
  const quoted = quote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return text.trim() ? `${quoted}\n\n${text}` : quoted;
}

export function serializeComposition(committed: Segment[], live: { quote: string | null; text: string }): string {
  const rendered = [...committed.map((segment) => renderSegment(segment.quote, segment.text)), renderSegment(live.quote, live.text)];
  return rendered.filter((block) => block !== '').join('\n\n').trim();
}
