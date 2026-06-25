/**
 * renderHighlights — maps mainframeUserFormatter.parse() segments to React nodes
 * for the color-only composer overlay.
 *
 * Contract:
 *  - The concatenated textContent of the returned nodes MUST equal the input text
 *    char-for-char (no inserted or removed characters).
 *  - Only color / font-weight may differ from the surrounding text — no padding,
 *    margin, border, or font-size changes that could drift the caret.
 *  - Mention types: 'command' | 'mention' | 'file' → text-primary
 *                   'skill'                          → text-mf-directive-skill
 */
import type { ReactNode } from 'react';
import { mainframeUserFormatter } from '@/features/chat/messages/user-directives';

const colorClass: Record<string, string> = {
  command: 'text-primary',
  mention: 'text-primary',
  file: 'text-primary',
  skill: 'text-mf-directive-skill',
};

/**
 * Returns an array of React nodes (plain strings or colored spans) whose
 * concatenated textContent equals `text` exactly.
 */
export function renderHighlights(text: string): ReactNode[] {
  const segments = mainframeUserFormatter.parse(text);
  let offset = 0;
  const nodes: ReactNode[] = [];

  for (const seg of segments) {
    if (seg.kind === 'text') {
      nodes.push(seg.text);
      offset += seg.text.length;
    } else {
      // mention segment — use label (includes the leading @ or /)
      const label = seg.label;
      const cls = colorClass[seg.type] ?? 'text-primary';
      nodes.push(
        <span key={offset} className={cls}>
          {label}
        </span>,
      );
      offset += label.length;
    }
  }

  return nodes;
}
