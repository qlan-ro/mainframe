import React, { useState, useEffect } from 'react';
import { useComposerRuntime } from '@assistant-ui/react';
import { renderHighlights } from '../message-parsing';

// Overlay that renders the visible (highlighted) text behind the transparent textarea.
// Both share the inner wrapper inside ComposerCard, so they wrap at the same width and
// scroll together — no manual scrollTop sync required.
//
// The trailing '\u200B' forces the overlay to render a line after a trailing '\n',
// mirroring the empty line a <textarea> keeps for the caret. Without it,
// `white-space: pre-wrap` absorbs the trailing '\n' and the caret lands below the
// overlay's last visible line.
export function ComposerHighlight() {
  const composerRuntime = useComposerRuntime();
  // Initialize from the current runtime state, not an empty string. If the overlay mounts
  // after the composer already contains text (e.g. an ancestor remounted after a permission
  // prompt closed), subscribe() only fires on future changes — the initial value would
  // otherwise be lost and the overlay would render nothing until the user typed another key.
  const [text, setText] = useState(() => {
    try {
      return composerRuntime.getState()?.text ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      setText(composerRuntime.getState()?.text ?? '');
    } catch {
      /* not ready */
    }
    const unsub = composerRuntime.subscribe(() => {
      try {
        setText(composerRuntime.getState()?.text ?? '');
      } catch {
        /* disposed */
      }
    });
    return unsub;
  }, [composerRuntime]);

  return (
    <div
      className="absolute inset-0 px-3 py-2 font-sans text-mf-chat text-mf-text-primary pointer-events-none whitespace-pre-wrap break-words"
      aria-hidden="true"
    >
      {text ? renderHighlights(text + '\u200B') : null}
    </div>
  );
}
