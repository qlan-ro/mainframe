/**
 * CmEditor — a controlled CodeMirror 6 editor component.
 *
 * Props:
 *   value      — current document string (controlled; updated via applyValueUpdate)
 *   language   — CM6 lang-pack id (see lib/editor/file-types.ts LangPackId)
 *   readOnly   — EditorState.readOnly compartment
 *   onChange   — called with the new value on every document change
 *   path       — absolute file path; used as the view-state cache key
 *
 * On unmount the current selection + scroll are saved to store/editor.ts and
 * restored on remount with the same path.
 */
import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { LangPackId } from '@/lib/editor/file-types';
import { applyValueUpdate } from '@/lib/editor/apply-value-update';
import { useEditorStore } from '@/store/editor';
import { buildBaseExtensions, createEditorCompartments, resolveLanguage } from './cm-setup';

// ── Component ────────────────────────────────────────────────────────────────

export interface CmEditorProps {
  value: string;
  language: LangPackId;
  readOnly: boolean;
  onChange: (value: string) => void;
  path: string;
  /**
   * Optional extra extensions to inject at mount time (e.g. the comment gutter).
   * These are static — they are not reconfigured on prop changes.
   */
  extraExtensions?: Extension[];
  /**
   * Ref callback for callers that need direct EditorView access (e.g. to
   * dispatch addCommentEffect from outside the CM6 extension system).
   */
  onViewReady?: (view: EditorView) => void;
}

export function CmEditor({ value, language, readOnly, onChange, path, extraExtensions, onViewReady }: CmEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Per-instance compartments — created once on first render, never replaced.
  // Must be per-instance: sharing Compartment objects across EditorViews causes
  // reconfigure() to target the wrong state tree.
  const compartmentsRef = useRef(createEditorCompartments());

  // Stable refs so the EditorView listener closure never stales.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const pathRef = useRef(path);
  pathRef.current = path;

  // ── Mount / unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!hostRef.current) return;
    const { lang, readOnly: roComp } = compartmentsRef.current;
    const savedState = useEditorStore.getState().getViewState(path);

    const startState = EditorState.create({
      doc: value,
      extensions: [
        ...buildBaseExtensions(),
        lang.of(resolveLanguage(language)),
        roComp.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        ...(extraExtensions ?? []),
      ],
    });

    const view = new EditorView({ state: startState, parent: hostRef.current });
    viewRef.current = view;
    onViewReady?.(view);

    // Restore view state if we have one saved for this path.
    if (savedState) {
      const { selectionAnchor, selectionHead, scrollTop } = savedState;
      const docLen = view.state.doc.length;
      try {
        view.dispatch({
          selection: {
            anchor: Math.min(selectionAnchor, docLen),
            head: Math.min(selectionHead, docLen),
          },
        });
        view.scrollDOM.scrollTop = scrollTop;
      } catch (err) {
        // Clamping guard: doc length may be 0 on fresh mount — expected.
        console.warn('[CmEditor] view-state restore skipped:', err);
      }
    }

    return () => {
      // Save view state on unmount.
      const { main } = view.state.selection;
      useEditorStore.getState().saveViewState(pathRef.current, {
        selectionAnchor: main.anchor,
        selectionHead: main.head,
        scrollTop: view.scrollDOM.scrollTop,
      });
      view.destroy();
      viewRef.current = null;
    };
    // Mount-only effect: value/language/readOnly are kept in sync by the three
    // separate effects below via imperative compartment reconfiguration. The
    // stable refs (onChangeRef, pathRef) give the listener closure access to
    // current values without re-mounting the EditorView.
  }, []);

  // ── Sync value changes ───────────────────────────────────────────────────

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    applyValueUpdate(view, value);
  }, [value]);

  // ── Sync language changes ────────────────────────────────────────────────

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { lang } = compartmentsRef.current;
    view.dispatch({ effects: lang.reconfigure(resolveLanguage(language)) });
  }, [language]);

  // ── Sync readOnly changes ────────────────────────────────────────────────

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { readOnly: roComp } = compartmentsRef.current;
    view.dispatch({
      effects: roComp.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return <div ref={hostRef} data-testid="editor-code" className="mf-editor-selectable h-full" />;
}
