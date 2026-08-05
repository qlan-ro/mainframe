'use client';

/**
 * ComposerHighlight — color-only overlay rendered behind the transparent textarea.
 *
 * Both the overlay and the textarea share the same wrapper (relative max-h-48
 * overflow-y-auto), so they wrap at the same width and scroll together — no
 * manual scrollTop sync required.
 *
 * The trailing '​' (zero-width space) forces the overlay to render a line
 * after a trailing '\n', mirroring the empty caret line a <textarea> keeps.
 * Without it, white-space:pre-wrap absorbs the trailing '\n' and the caret
 * lands below the overlay's last visible line.
 *
 * Typography MUST exactly match the textarea:
 *   font-sans text-body leading-relaxed px-[14px] pt-[10px] pb-[4px]
 *   whitespace-pre-wrap break-words
 * Any deviation drifts the caret position.
 */
import type { ReactElement } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useSessionReferences } from '../sessions/session-reference-store';
import { renderHighlights } from './render-highlights';

const NO_LABELS: string[] = [];

/** Color-only overlay rendered behind the transparent composer textarea. */
export function ComposerHighlight(): ReactElement {
  const text = useAuiState((s) => s.composer.text) ?? '';
  const threadId = useActiveThreadId();
  // The draft's own labels: a bare `@<label>` mention is only tintable against them (#240).
  const references = useSessionReferences((s) => (threadId == null ? undefined : s.byThread[threadId]));
  const labels = references ? Object.keys(references) : NO_LABELS;

  return (
    <div
      data-testid="composer-prompt-highlight"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-[14px] pt-[10px] pb-[4px] font-sans text-body leading-relaxed text-foreground"
    >
      {text ? renderHighlights(text + '​', labels) : null}
    </div>
  );
}
