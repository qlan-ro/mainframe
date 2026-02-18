import React, { useState, useRef, useEffect } from 'react';
import { useComposerRuntime } from '@assistant-ui/react';
import { renderHighlights } from '../message-parsing';

export function ComposerHighlight() {
  const composerRuntime = useComposerRuntime();
  const [text, setText] = useState('');
  const mirrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = composerRuntime.subscribe(() => {
      try {
        setText(composerRuntime.getState()?.text ?? '');
      } catch {}
    });
    return unsub;
  }, [composerRuntime]);

  useEffect(() => {
    const el = mirrorRef.current;
    const textarea = el?.parentElement?.querySelector('textarea');
    if (!textarea || !el) return;
    const sync = () => {
      el.scrollTop = textarea.scrollTop;
    };
    textarea.addEventListener('scroll', sync);
    return () => textarea.removeEventListener('scroll', sync);
  }, []);

  if (!text) return null;

  return (
    <div
      ref={mirrorRef}
      className="absolute inset-0 px-3 py-2 font-sans text-mf-chat text-mf-text-primary pointer-events-none overflow-hidden whitespace-pre-wrap break-words"
      aria-hidden="true"
    >
      {renderHighlights(text)}
    </div>
  );
}
