/**
 * ReadMoreBubble — wraps user-message content with a WhatsApp-style
 * "Read more / Show less" clamp when the rendered text exceeds CHAR_THRESHOLD.
 *
 * Clamping strategy: character-length heuristic (jsdom has no layout engine to
 * measure rendered line height). Short content falls through to the untruncated
 * path. The fade gradient uses `--mf-um-fade` so it matches the card background
 * in both light and dark modes without relying on `bg-mf-um-card` (which is a
 * gradient and cannot be used as a Tailwind color utility).
 *
 * Keep-ours per the assistant-ui inventory (there is no native truncation gate).
 */
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Tuning
// ─────────────────────────────────────────────────────────────────────────────

const CHAR_THRESHOLD = 600;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractTextLength(node: ReactNode): number {
  if (typeof node === 'string') return node.length;
  if (typeof node === 'number') return String(node).length;
  if (Array.isArray(node)) {
    return node.reduce<number>((acc, child) => acc + extractTextLength(child), 0);
  }
  if (node !== null && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractTextLength(props?.children);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadMoreBubbleProps {
  children: ReactNode;
  className?: string;
}

/**
 * Clamps long message content behind a "Read more" button.
 *
 * The fade overlay sits above the last visible line and uses
 * `--mf-um-fade` (the solid end-stop of the card gradient) so the
 * transition looks seamless on both light and dark skins.
 */
export function ReadMoreBubble({ children, className }: ReadMoreBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const textLength = extractTextLength(children);
  const needsToggle = textLength > CHAR_THRESHOLD;
  const collapsed = needsToggle && !expanded;

  return (
    <div className={cn('relative', className)}>
      <div
        data-clamp={needsToggle ? '' : undefined}
        data-text-part
        className={cn(
          // Base prose styles — matched to the artboard type spec
          'text-body leading-relaxed tracking-tight',
          // Clamp to 6 lines when collapsed
          collapsed && 'line-clamp-6',
        )}
      >
        {children}
      </div>

      {/* Gradient fade-out at the last visible line */}
      {collapsed && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-6 left-0 right-0 h-8"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--mf-um-fade))' }}
        />
      )}

      {needsToggle && (
        <button
          data-testid="chat-user-readmore-toggle"
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-caption font-semibold text-primary hover:underline"
          aria-label={expanded ? 'Show less' : 'Read more'}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
