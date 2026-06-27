/** `L42–46` / `L42` — shared snippet helpers for review-comment cards. */

/** Numbered mono snippet rows (line numbers from `start`) — shared with
 *  ReviewCommentCard. select-text keeps the code copyable despite the
 *  chrome-wide user-select:none; the gutter stays select-none. */
export function SnippetLines({ lines, start }: { lines: readonly string[]; start: number }) {
  return (
    <>
      {lines.map((line, i) => (
        // 18px line-height pins the line-number gutter alignment — a fixed
        // layout metric (matches the prototype), not a typography token.
        <div key={i} className="flex min-h-[18px] font-mono text-caption" style={{ lineHeight: '18px' }}>
          <span className="w-10 flex-shrink-0 select-none pr-3 text-right text-micro text-mf-text-4">{start + i}</span>
          <span className="flex-1 whitespace-pre pr-3 text-foreground">{line}</span>
        </div>
      ))}
    </>
  );
}

/** `L42–46` / `L42` — shared with ReviewCommentCard. */
export function rangeLabel(range: { start: number; end?: number }): string {
  return range.end != null && range.end !== range.start ? `L${range.start}–${range.end}` : `L${range.start}`;
}
