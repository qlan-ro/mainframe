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
import { renderHighlights } from './render-highlights';

/** Color-only overlay rendered behind the transparent composer textarea. */
export function ComposerHighlight(): ReactElement {
  const text = useAuiState((s) => s.composer.text) ?? '';

  return (
    <div
      data-testid="composer-prompt-highlight"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-[14px] pt-[10px] pb-[4px] font-sans text-body leading-relaxed text-foreground"
    >
      {text ? renderHighlights(text + '​') : null}
    </div>
  );
}
