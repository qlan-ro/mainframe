/**
 * WfExprInputEditor — the CodeMirror-heavy implementation behind
 * `WfExprInput`. Lazy-loaded by that wrapper (React.lazy + Suspense) so
 * plain (non-expr) config forms never pay for the CodeMirror bundle.
 *
 * Single-line fields reject any transaction that would introduce a second
 * line (Enter is a no-op); multiline fields allow normal line wrapping.
 * `wf-expr-chips.ts`'s `chipExtension` renders atomic `${...}` chips; a
 * `mousedown` dom-event-handler reads the chip's `data-chip-from/to`
 * attributes (set by the widget) to report clicks upward for the raw-edit
 * mini editor (Task 18).
 */
import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { applyValueUpdate, externalValueUpdate } from '@/lib/editor/apply-value-update';
import { cn } from '@/lib/utils';
import { chipExtension, scopeRefreshEffect } from './wf-expr-chips';
import type { WfScopeSource } from './wf-scope';

export interface WfExprInputEditorProps {
  value: string;
  onChange: (value: string, cursor: number) => void;
  scope: WfScopeSource[];
  multiline?: boolean;
  testId: string;
  onChipClick: (from: number, to: number) => void;
  /** Consumed once after a programmatic insert to place the cursor after it. */
  cursorHint?: number;
  onCursorHintConsumed: () => void;
}

function singleLineFilter(): Extension {
  return EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr));
}

function chipClickHandler(onChipClick: (from: number, to: number) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event) {
      const target = (event.target as HTMLElement | null)?.closest('[data-wf-chip]');
      if (!target) return false;
      const from = Number(target.getAttribute('data-chip-from'));
      const to = Number(target.getAttribute('data-chip-to'));
      onChipClick(from, to);
      return true;
    },
  });
}

export function WfExprInputEditor({
  value,
  onChange,
  scope,
  multiline,
  testId,
  onChipClick,
  cursorHint,
  onCursorHintConsumed,
}: WfExprInputEditorProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onChipClickRef = useRef(onChipClick);
  onChipClickRef.current = onChipClick;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    if (!hostRef.current) return;

    const extensions: Extension[] = [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      chipExtension(() => scopeRef.current),
      chipClickHandler((from, to) => onChipClickRef.current(from, to)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const isExternal = update.transactions.some((tr) => tr.annotation(externalValueUpdate));
        if (!isExternal) {
          onChangeRef.current(update.state.doc.toString(), update.state.selection.main.head);
        }
      }),
      EditorView.theme({
        '&': { fontSize: '13px' },
        '.cm-content': { padding: multiline ? '8px 12px' : '5px 12px', fontFamily: 'inherit' },
        '.cm-scroller': { fontFamily: 'inherit' },
      }),
    ];
    if (!multiline) extensions.push(singleLineFilter());

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount-only: value/cursorHint are synced imperatively by the effect below.
  }, [multiline]);

  // The chip StateField only rebuilds on tr.docChanged; when an upstream step
  // is renamed, `scope` gets a new identity but this field's doc is untouched,
  // so force a decoration rebuild via scopeRefreshEffect (wf-expr-chips.ts).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: scopeRefreshEffect.of() });
  }, [scope]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    applyValueUpdate(view, value);
    if (cursorHint !== undefined) {
      const pos = Math.min(cursorHint, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos, head: pos } });
      onCursorHintConsumed();
    }
  }, [value, cursorHint, onCursorHintConsumed]);

  return (
    <div
      ref={hostRef}
      data-testid={testId}
      className={cn('rounded-md border-[0.5px] border-input bg-card', multiline ? 'min-h-[80px] py-[2px]' : 'h-8')}
    />
  );
}
