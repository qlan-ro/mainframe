/** `L42–46` / `L42` — shared snippet helpers for review-comment cards. */
import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Numbered mono snippet rows (line numbers from `start`) — shared with
 *  ReviewCommentCard. select-text keeps the code copyable despite the
 *  chrome-wide user-select:none; the gutter stays select-none. */
export function SnippetLines({ lines, start }: { lines: readonly string[]; start: number }) {
  return (
    <>
      {lines.map((line, i) => (
        // 18px line-height pins the line-number gutter alignment — a fixed
        // layout metric (matches the prototype), not a typography token.
        <div key={i} className="flex min-h-[18px] font-mono text-label" style={{ lineHeight: '18px' }}>
          <span className="w-10 flex-shrink-0 select-none pr-3 text-right text-caption text-mf-text-3">
            {start + i}
          </span>
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

// ─────────────────────────────────────────────────────────────────────────────
// SnippetBlock — collapse/expand clamp (design 7.8, UMCodeRef)
// ─────────────────────────────────────────────────────────────────────────────

/** Snippets longer than this render behind a fade + "Show all N lines" expander. */
const COLLAPSED_LINES = 7;
/** Line height used by SnippetLines (18px) × COLLAPSED_LINES. */
const COLLAPSED_HEIGHT_PX = COLLAPSED_LINES * 18;
/** Scroll cap once expanded (design: max-height 240px). */
const EXPANDED_MAX_HEIGHT_PX = 240;

/**
 * Wraps SnippetLines with the design's collapse/expand behavior (UMCodeRef,
 * 11-usermessages.jsx:324-365): a long snippet (> COLLAPSED_LINES) starts
 * clamped behind a fade with a persistent full-width footer-bar toggle —
 * collapsed reads "Show all N lines" with a down chevron; expanded reads
 * "Collapse" with an up chevron and re-collapses on click. The toggle never
 * unmounts (two-way state), matching the artboard footer bar.
 *
 * `id` scopes the testids — callers that render multiple SnippetBlocks in one
 * tree (e.g. ReviewCommentCard's per-comment sections) must pass a stable,
 * per-instance id so `chat-user-snippet-scroll-${id}` /
 * `chat-user-snippet-expand-${id}` stay unique.
 */
export function SnippetBlock({ id, lines, start }: { id: string; lines: readonly string[]; start: number }) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = lines.length > COLLAPSED_LINES;
  const collapsed = needsClamp && !expanded;

  return (
    <div className="relative">
      <div
        data-testid={`chat-user-snippet-scroll-${id}`}
        style={
          collapsed ? { maxHeight: COLLAPSED_HEIGHT_PX } : expanded ? { maxHeight: EXPANDED_MAX_HEIGHT_PX } : undefined
        }
        className={cn(collapsed && 'overflow-hidden', expanded && 'max-h-[240px] overflow-y-auto')}
      >
        <SnippetLines lines={lines} start={start} />
      </div>

      {collapsed && (
        // Matches the fade pattern in ReadMoreBubble — inline gradient, not a
        // Tailwind gradient-stop utility, since --mf-raised is a CSS var.
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-6"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--mf-raised))' }}
        />
      )}

      {needsClamp && (
        <button
          data-testid={`chat-user-snippet-expand-${id}`}
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-px flex w-full items-center justify-center gap-[5px] border-t-[0.5px] border-border bg-mf-content2 py-[7px] text-caption font-semibold text-primary hover:bg-mf-raised"
        >
          {expanded ? 'Collapse' : `Show all ${lines.length} lines`}
          {expanded ? <ChevronUpIcon size={10} /> : <ChevronDownIcon size={10} />}
        </button>
      )}
    </div>
  );
}
