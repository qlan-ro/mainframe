/**
 * CmDiffEditor — side-by-side diff editor using @codemirror/merge MergeView.
 *
 * Props:
 *   original  — base document string (always read-only)
 *   modified  — changed document string
 *   language  — CM6 lang-pack id (see lib/editor/file-types.ts)
 *   path      — file path; reserved for future view-state caching (unused by render)
 *   readOnly  — when true, the modified pane is also read-only (default false)
 *
 * Warm-chrome diff tints come from the existing --mf-diff-* tokens in globals.css
 * applied via an EditorView.theme overlay on both panes.
 *
 * setActiveMergeView is called on mount so that external nav controls
 * (nextChange / prevChange in diff-nav.ts) always hold the live MergeView.
 */
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MergeView } from '@codemirror/merge';
import type { LangPackId } from '@/lib/editor/file-types';
import { buildBaseExtensions, createEditorCompartments, resolveLanguage } from './cm-setup';
import { setActiveMergeView, clearActiveMergeView } from './diff-nav';

// ── Warm-chrome diff theme overlay ──────────────────────────────────────────
//
// @codemirror/merge decorates changed/inserted/deleted lines with specific CSS
// classes. We override their backgrounds + borders to match the warm-chrome
// palette from --mf-diff-* tokens (defined in styles/globals.css).

const diffTheme = EditorView.theme({
  '.cm-insertedLine': {
    backgroundColor: 'var(--mf-diff-add-bg)',
    borderLeft: '2px solid var(--mf-diff-add-border)',
  },
  '.cm-deletedLine': {
    backgroundColor: 'var(--mf-diff-del-bg)',
    borderLeft: '2px solid var(--mf-diff-del-border)',
  },
  '.cm-changedLine': {
    backgroundColor: 'var(--mf-diff-add-bg)',
    borderLeft: '2px solid var(--mf-diff-add-border)',
  },
  '.cm-changedText': {
    backgroundColor: 'color-mix(in srgb, var(--mf-diff-add-bg) 60%, transparent)',
  },
  '.cm-mergeGap': {
    borderLeft: '1px solid var(--mf-diff-add-border)',
    borderRight: '1px solid var(--mf-diff-del-border)',
  },
});

// ── Component ────────────────────────────────────────────────────────────────

export interface CmDiffEditorProps {
  original: string;
  modified: string;
  language: LangPackId;
  /** Reserved: file path for future view-state caching. */
  path: string;
  readOnly?: boolean;
}

export function CmDiffEditor({ original, modified, language, readOnly = false }: CmDiffEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  // Per-pane compartments — one set for a (original), one for b (modified).
  // Each must be a separate instance: sharing Compartments across EditorViews
  // causes reconfigure() to target the wrong state tree.
  const aCompartmentsRef = useRef(createEditorCompartments());
  const bCompartmentsRef = useRef(createEditorCompartments());

  // ── Mount / unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!hostRef.current) return;

    const { lang: aLang, readOnly: aRo } = aCompartmentsRef.current;
    const { lang: bLang, readOnly: bRo } = bCompartmentsRef.current;
    const langExt = resolveLanguage(language);
    const baseExts = buildBaseExtensions();

    const aState = EditorState.create({
      doc: original,
      extensions: [
        ...baseExts,
        diffTheme,
        aLang.of(langExt),
        aRo.of(EditorState.readOnly.of(true)), // original is always read-only
      ],
    });

    const bState = EditorState.create({
      doc: modified,
      extensions: [...baseExts, diffTheme, bLang.of(langExt), bRo.of(EditorState.readOnly.of(readOnly))],
    });

    const mv = new MergeView({
      a: aState,
      b: bState,
      parent: hostRef.current,
      highlightChanges: true,
      gutter: true,
    });

    mergeViewRef.current = mv;
    // Register the live MergeView so nextChange()/prevChange() can navigate.
    // The mv object itself is long-lived; diff-nav reads mv.chunks at call time,
    // so registering once at mount is sufficient.
    setActiveMergeView(mv);

    return () => {
      clearActiveMergeView(mv);
      mv.destroy();
      mergeViewRef.current = null;
    };
    // Mount-only: language/readOnly are kept in sync by separate effects below.
  }, []);

  // ── Sync language changes ────────────────────────────────────────────────

  useEffect(() => {
    const mv = mergeViewRef.current;
    if (!mv) return;
    const langExt = resolveLanguage(language);
    const { lang: aLang } = aCompartmentsRef.current;
    const { lang: bLang } = bCompartmentsRef.current;
    mv.a.dispatch({ effects: aLang.reconfigure(langExt) });
    mv.b.dispatch({ effects: bLang.reconfigure(langExt) });
  }, [language]);

  // ── Sync readOnly changes ────────────────────────────────────────────────

  useEffect(() => {
    const mv = mergeViewRef.current;
    if (!mv) return;
    const { readOnly: bRo } = bCompartmentsRef.current;
    mv.b.dispatch({
      effects: bRo.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return <div ref={hostRef} data-testid="editor-diff" className="mf-editor-selectable h-full overflow-auto" />;
}
