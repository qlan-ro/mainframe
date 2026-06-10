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
import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractText } from '../parts/extract-text';

// ─────────────────────────────────────────────────────────────────────────────
// Tuning
// ─────────────────────────────────────────────────────────────────────────────

const CHAR_THRESHOLD = 600;

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

  const textLength = extractText(children).length;
  const needsToggle = textLength > CHAR_THRESHOLD;
  const collapsed = needsToggle && !expanded;

  return (
    <div className={cn('relative', className)}>
      <div
        data-clamp={needsToggle ? '' : undefined}
        data-text-part
        className={cn(
          // aui-md re-enables text selection (chrome sets user-select:none on
          // body) — desktop parity: user-bubble text is selectable/copyable.
          'aui-md',
          // Base prose styles — matched to the artboard type spec
          'text-body leading-relaxed tracking-normal',
          // Clamp to 4 lines when collapsed
          collapsed && 'line-clamp-4',
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
          className="mt-1 inline-flex items-center gap-0.5 text-caption font-semibold text-primary hover:underline"
          aria-label={expanded ? 'Show less' : 'Read more'}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read more'}
          {expanded ? (
            <ChevronsUpDown size={10} className="text-primary" />
          ) : (
            <ChevronDown size={10} className="text-primary" />
          )}
        </button>
      )}
    </div>
  );
}
