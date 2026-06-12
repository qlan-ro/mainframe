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
import { EditorView, keymap } from '@codemirror/view';
import type { LangPackId } from '@/lib/editor/file-types';
import { applyValueUpdate } from '@/lib/editor/apply-value-update';
import { useEditorStore } from '@/store/editor';
import { buildBaseExtensions, createEditorCompartments, resolveLanguage } from './cm-setup';
import { createNavigationKeymap } from './lsp/navigation';

/** Scroll a line/character position into view and place the cursor there. */
function revealPosition(view: EditorView, line: number, character: number): void {
  try {
    // CM6 lines are 1-based; LSP lines are 0-based.
    const docLine = view.state.doc.line(line + 1);
    const pos = Math.min(docLine.from + character, docLine.to);
    view.dispatch({
      selection: { anchor: pos, head: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
  } catch (err) {
    // Out-of-range line numbers on a freshly loaded doc — expected on edge cases.
    console.warn('[CmEditor] revealPosition skipped:', err);
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export interface CmEditorProps {
  value: string;
  language: LangPackId;
  readOnly: boolean;
  onChange: (value: string) => void;
  path: string;
  /**
   * Optional extra extensions (e.g. LSP hover/diagnostics, comment gutter).
   * Reconfigured via a Compartment whenever the prop identity changes, so LSP
   * extensions built after `lspReady` flips true are applied to the live view.
   */
  extraExtensions?: Extension[];
  /**
   * Ref callback for callers that need direct EditorView access (e.g. to
   * dispatch addCommentEffect from outside the CM6 extension system).
   */
  onViewReady?: (view: EditorView) => void;
  /**
   * Called when the user presses Cmd/Ctrl+S. The editor passes the current
   * document value; the parent should persist it and clear dirty state.
   * When provided, the browser default (page save dialog) is suppressed.
   */
  onSave?: (value: string) => void;
  /**
   * Called whenever the cursor position changes (selection change). Arguments
   * are 1-based line and column numbers. Used by EditorTab to drive the
   * Ln/Col status display in ViewerShell.
   */
  onCursorChange?: (line: number, col: number) => void;
}

export function CmEditor({
  value,
  language,
  readOnly,
  onChange,
  path,
  extraExtensions,
  onViewReady,
  onSave,
  onCursorChange,
}: CmEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Per-instance compartments — created once on first render, never replaced.
  // Must be per-instance: sharing Compartment objects across EditorViews causes
  // reconfigure() to target the wrong state tree.
  const compartmentsRef = useRef(createEditorCompartments());

  // Stable refs so the EditorView listener closure never stales.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  const pathRef = useRef(path);
  pathRef.current = path;

  // ── Mount / unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!hostRef.current) return;
    const { lang, readOnly: roComp, extra } = compartmentsRef.current;
    const savedState = useEditorStore.getState().getViewState(path);

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run(view) {
          const cb = onSaveRef.current;
          if (cb) {
            cb(view.state.doc.toString());
            return true; // prevent browser save dialog
          }
          return false;
        },
      },
    ]);

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
          if (update.selectionSet || update.docChanged) {
            const cb = onCursorChangeRef.current;
            if (cb) {
              const pos = update.state.selection.main.head;
              const docLine = update.state.doc.lineAt(pos);
              // 1-based line; column = offset within the line, also 1-based.
              cb(docLine.number, pos - docLine.from + 1);
            }
          }
        }),
        saveKeymap,
        createNavigationKeymap(),
        extra.of(extraExtensions ?? []),
      ],
    });

    const view = new EditorView({ state: startState, parent: hostRef.current });
    viewRef.current = view;
    onViewReady?.(view);

    // A reveal target (from a go-to-def jump) takes priority over saved view state.
    // consumeRevealTarget reads and clears the target so it fires exactly once.
    const revealTarget = useEditorStore.getState().consumeRevealTarget(path);
    if (revealTarget) {
      revealPosition(view, revealTarget.line, revealTarget.character);
    } else if (savedState) {
      // Restore view state if we have one saved for this path.
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

  // ── Sync extraExtensions changes ─────────────────────────────────────────
  // Triggered by prop identity change (e.g. lspReady flip rebuilds the array).

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { extra } = compartmentsRef.current;
    view.dispatch({ effects: extra.reconfigure(extraExtensions ?? []) });
  }, [extraExtensions]);

  return <div ref={hostRef} data-testid="editor-code" className="mf-editor-selectable h-full" />;
}
