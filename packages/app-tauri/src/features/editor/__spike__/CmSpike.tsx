/**
 * Phase 0 spike (ADR-001 step 1): minimal CodeMirror 6 editor proving the
 * extension wiring Phases 2–3 will build on — EditorView lifecycle in React,
 * a `@codemirror/lang-*` pack, and warm-chrome theming from `--mf-code-*`.
 *
 * Not production code: superseded by `features/editor/CmEditor.tsx` in Phase 2.
 */
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { tags } from '@lezer/highlight';

export type CmSpikeLanguage = 'javascript';

interface CmSpikeProps {
  doc: string;
  language: CmSpikeLanguage;
}

const warmTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--mf-code-bg)',
    color: 'var(--mf-code-fg)',
    fontSize: '12px',
    height: '100%',
  },
  '.cm-content': { fontFamily: 'var(--font-mono, monospace)' },
  '.cm-gutters': {
    backgroundColor: 'var(--mf-code-bg)',
    color: 'var(--mf-code-cmt)',
    border: 'none',
  },
});

const warmHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--mf-code-kw)' },
  { tag: tags.string, color: 'var(--mf-code-str)' },
  { tag: tags.number, color: 'var(--mf-code-num)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--mf-code-fn)' },
  { tag: tags.typeName, color: 'var(--mf-code-type)' },
  { tag: tags.comment, color: 'var(--mf-code-cmt)', fontStyle: 'italic' },
]);

export function CmSpike({ doc, language }: CmSpikeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          language === 'javascript' ? javascript({ typescript: true }) : [],
          warmTheme,
          syntaxHighlighting(warmHighlight),
        ],
      }),
      parent: hostRef.current,
    });
    return () => view.destroy();
    // Spike-only: recreate the view when inputs change (Phase 2 uses compartments).
  }, [doc, language]);

  return <div ref={hostRef} data-testid="editor-cm-spike" className="mf-editor-selectable h-full" />;
}
