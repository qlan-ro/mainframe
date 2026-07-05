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
import { useTheme } from '@/store/theme';
import { buildBaseExtensions, createEditorCompartments, makeWarmTheme, resolveLanguage } from './cm-setup';
import { setActiveMergeView, clearActiveMergeView } from './diff-nav';

/** Line selection payload reported by onLineSelect. */
export interface LineSelection {
  /** 1-based line number in the modified document. */
  line: number;
  /** The full text of that line (without the trailing newline). */
  text: string;
}

// ── Warm-chrome diff theme overlay ──────────────────────────────────────────
//
// @codemirror/merge decorates changed/inserted/deleted lines with specific CSS
// classes. We override their backgrounds + borders to match the warm-chrome
// palette from --mf-diff-* tokens (defined in styles/globals.css).

const diffTheme = EditorView.theme({
  '.cm-insertedLine': {
    backgroundColor: 'var(--mf-diff-add-bg)',
  },
  '.cm-deletedLine': {
    backgroundColor: 'var(--mf-diff-del-bg)',
  },
  '.cm-changedLine': {
    backgroundColor: 'var(--mf-diff-add-bg)',
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

export interface DiffStats {
  /** Number of added lines across all chunks. */
  additions: number;
  /** Number of deleted lines across all chunks. */
  deletions: number;
}

export interface CmDiffEditorProps {
  original: string;
  modified: string;
  language: LangPackId;
  /** Reserved: file path for future view-state caching. */
  path: string;
  readOnly?: boolean;
  /**
   * Called after the MergeView mounts with the initial chunk count.
   * Allows parent controls (e.g. DiffHeader) to show an accurate change count
   * without polling the global singleton.
   */
  onChunksChange?: (count: number) => void;
  /**
   * Called after the MergeView mounts with line-level add/del statistics.
   * Enables DiffHeader to show separate +N / −N counts.
   */
  onStats?: (stats: DiffStats) => void;
  /**
   * Optional. Called when the user clicks a line in the MODIFIED (right) pane.
   * Reports the 1-based line number and the text of that line.
   * When undefined (the default), the click handler is not installed — existing
   * behaviour is completely unchanged.
   */
  onLineSelect?: (sel: LineSelection) => void;
}

export function CmDiffEditor({
  original,
  modified,
  language,
  readOnly = false,
  onChunksChange,
  onStats,
  onLineSelect,
}: CmDiffEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  // Stable ref so the mount-only effect can always read the latest callback
  // without needing to re-run (which would destroy/recreate the MergeView).
  const onLineSelectRef = useRef(onLineSelect);
  onLineSelectRef.current = onLineSelect;

  // Drives both panes' theme compartment dark flag; re-renders on a mode flip.
  const mode = useTheme((s) => s.mode);

  // Per-pane compartments — one set for a (original), one for b (modified).
  // Each must be a separate instance: sharing Compartments across EditorViews
  // causes reconfigure() to target the wrong state tree.
  const aCompartmentsRef = useRef(createEditorCompartments());
  const bCompartmentsRef = useRef(createEditorCompartments());

  // ── Mount / unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!hostRef.current) return;

    const { lang: aLang, readOnly: aRo, theme: aTheme } = aCompartmentsRef.current;
    const { lang: bLang, readOnly: bRo, theme: bTheme } = bCompartmentsRef.current;
    const langExt = resolveLanguage(language);
    const baseExts = buildBaseExtensions();
    // Initial dark flag from the store (kept in sync by the effect below).
    const themeExt = makeWarmTheme(useTheme.getState().mode === 'dark');

    // Click handler for the modified (b) pane — installed only when onLineSelect
    // is provided. Uses EditorView.domEventHandlers so it is additive and does
    // not interfere with existing CM6 event handling.
    const bClickExt = EditorView.domEventHandlers({
      click(event, view) {
        const cb = onLineSelectRef.current;
        if (!cb) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const lineObj = view.state.doc.lineAt(pos);
        cb({ line: lineObj.number, text: lineObj.text });
        return false; // do not consume the event
      },
    });

    // MergeView builds each pane's state itself from `config.a/b` read as an
    // EditorStateConfig (`{ doc, selection, extensions }`). We must pass that
    // shape — NOT a pre-built EditorState, whose `.extensions` is undefined, which
    // would silently drop lineNumbers, syntax highlighting, the warm theme, and
    // the diff-tint overlay (leaving only MergeView's built-in decorations).
    const mv = new MergeView({
      a: {
        doc: original,
        extensions: [
          ...baseExts,
          aTheme.of(themeExt),
          diffTheme,
          aLang.of(langExt),
          aRo.of(EditorState.readOnly.of(true)), // original is always read-only
        ],
      },
      b: {
        doc: modified,
        extensions: [
          ...baseExts,
          bTheme.of(themeExt),
          diffTheme,
          bLang.of(langExt),
          bRo.of(EditorState.readOnly.of(readOnly)),
          bClickExt,
        ],
      },
      parent: hostRef.current,
      highlightChanges: true,
      gutter: true,
    });

    mergeViewRef.current = mv;
    // Register the live MergeView so nextChange()/prevChange() can navigate.
    // The mv object itself is long-lived; diff-nav reads mv.chunks at call time,
    // so registering once at mount is sufficient.
    setActiveMergeView(mv);
    // Report the initial chunk count synchronously after construction so that
    // parent controls (DiffHeader) can display an accurate count without
    // polling the global singleton or using a timer.
    onChunksChange?.(mv.chunks.length);
    // Compute and report add/del line statistics from chunks.
    if (onStats) {
      let additions = 0;
      let deletions = 0;
      for (const chunk of mv.chunks) {
        additions += chunk.toB - chunk.fromB;
        deletions += chunk.toA - chunk.fromA;
      }
      onStats({ additions, deletions });
    }

    return () => {
      clearActiveMergeView(mv);
      mv.destroy();
      mergeViewRef.current = null;
    };
    // Mount-only: language/readOnly are kept in sync by separate effects below.
    // onLineSelect is read via ref so no dep needed.
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

  // ── Sync light↔dark mode changes ─────────────────────────────────────────
  // Reconfigure both panes' theme compartment so the CM6 `dark` flag tracks a
  // live mode flip (colors already track the CSS vars).

  useEffect(() => {
    const mv = mergeViewRef.current;
    if (!mv) return;
    const themeExt = makeWarmTheme(mode === 'dark');
    const { theme: aTheme } = aCompartmentsRef.current;
    const { theme: bTheme } = bCompartmentsRef.current;
    mv.a.dispatch({ effects: aTheme.reconfigure(themeExt) });
    mv.b.dispatch({ effects: bTheme.reconfigure(themeExt) });
  }, [mode]);

  return <div ref={hostRef} data-testid="editor-diff" className="mf-editor-selectable h-full overflow-auto" />;
}
