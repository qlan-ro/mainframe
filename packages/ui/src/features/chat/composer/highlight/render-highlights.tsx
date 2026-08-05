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
 *                   'session'                        → text-mf-directive-session
 *
 * A draft spells a session reference as the bare `@<label>` (#240), which no
 * pattern can recognize on its own — a title has spaces. So `sessionLabels`
 * (the draft's recorded labels) is matched first, and the formatter runs on
 * what is left; the wire `@session[…]` form still tints, for a body pasted back
 * into the composer.
 */
import type { ReactNode } from 'react';
import { mainframeUserFormatter, mainframeUserInlineFormatter } from '@/features/chat/messages/user-directives';
import { findSessionMentions } from '@/features/chat/session-references/session-mention';

const colorClass: Record<string, string> = {
  command: 'text-primary',
  mention: 'text-primary',
  file: 'text-primary',
  skill: 'text-mf-directive-skill',
  session: 'text-mf-directive-session',
};

/** Appends the formatter's segments for `text`, which starts at `base` in the whole value. */
function pushFormatted(nodes: ReactNode[], text: string, base: number): void {
  if (text === '') return;
  // Only a chunk at index 0 can hold the leading /command.
  const formatter = base === 0 ? mainframeUserFormatter : mainframeUserInlineFormatter;
  let offset = base;

  for (const seg of formatter.parse(text)) {
    if (seg.kind === 'text') {
      nodes.push(seg.text);
      offset += seg.text.length;
      continue;
    }
    // mention segment — use label (includes the leading @ or /)
    nodes.push(
      <span key={offset} className={colorClass[seg.type] ?? 'text-primary'}>
        {seg.label}
      </span>,
    );
    offset += seg.label.length;
  }
}

/**
 * Returns an array of React nodes (plain strings or colored spans) whose
 * concatenated textContent equals `text` exactly.
 */
export function renderHighlights(text: string, sessionLabels: readonly string[] = []): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;

  for (const mention of findSessionMentions(text, sessionLabels)) {
    pushFormatted(nodes, text.slice(last, mention.start), last);
    nodes.push(
      <span key={mention.start} className={colorClass.session}>
        {text.slice(mention.start, mention.end)}
      </span>,
    );
    last = mention.end;
  }
  pushFormatted(nodes, text.slice(last), last);

  return nodes;
}
