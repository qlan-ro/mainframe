/**
 * jsdom lacks Range.getClientRects, which CM6 calls on mount — stub it here,
 * matching the existing recipe in features/editor/__tests__/CmEditor.test.tsx.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { cursorCharLeft, deleteCharBackward } from '@codemirror/commands';
import { chipExtension, createChipField, scopeRefreshEffect } from '@/features/workflows/editor/config/wf-expr-chips';
import type { WfScopeSource } from '@/features/workflows/editor/config/wf-scope';

const scope = [{ kind: 'step', id: 'triage', label: 'Output of triage', expr: '${ steps.triage.output }' }] as const;

/** Reads every rendered chip label back off the decoration widgets' DOM, in doc order. */
function chipLabels(view: EditorView, field: ReturnType<typeof createChipField>): Array<string | undefined> {
  const labels: Array<string | undefined> = [];
  view.state.field(field).between(0, view.state.doc.length, (_from, _to, deco) => {
    labels.push((deco.spec.widget as { toDOM(): HTMLElement }).toDOM().textContent ?? undefined);
  });
  return labels;
}

const zeroRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

function zeroRectList(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
      /* jsdom stub */
    },
  } as unknown as DOMRectList;
}

beforeAll(() => {
  // Same zero-rect Range/getClientRects stub as CmEditor.test.tsx — CM6 calls
  // it during mount and jsdom does not implement it.
  Range.prototype.getClientRects = zeroRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
});

function makeView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [chipExtension(() => scope as never)],
  });
  return new EditorView({ state, parent: document.createElement('div') });
}

describe('chipExtension atomic behavior (real EditorView + real commands)', () => {
  it('cursorCharLeft skips over the whole chip in one step', () => {
    const doc = 'Fix ${ steps.triage.output } now';
    const view = makeView(doc, doc.indexOf('}') + 1);
    cursorCharLeft(view);
    expect(view.state.selection.main.head).toBeLessThanOrEqual(doc.indexOf('${'));
  });

  it('deleteCharBackward removes the whole chip as one unit, not one character', () => {
    const doc = 'Fix ${ steps.triage.output } now';
    const view = makeView(doc, doc.indexOf('}') + 1);
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe('Fix  now');
  });

  it('does not throw mounting a view for an unclosed ${', () => {
    expect(() => makeView('Fix ${ steps.triage.output now', 5)).not.toThrow();
  });
});

describe('scopeRefreshEffect', () => {
  it('rebuilds chip labels when dispatched, even with no doc change', () => {
    let currentScope: WfScopeSource[] = [...scope] as WfScopeSource[];
    const field = createChipField(() => currentScope);
    const doc = 'Fix ${ steps.triage.output } now';
    const state = EditorState.create({ doc, extensions: [field] });
    const view = new EditorView({ state, parent: document.createElement('div') });

    expect(chipLabels(view, field)).toEqual(['Output of triage']);

    currentScope = [{ kind: 'step', id: 'triage', label: 'Triage result', expr: '${ steps.triage.output }' }];
    view.dispatch({ effects: scopeRefreshEffect.of() });

    expect(chipLabels(view, field)).toEqual(['Triage result']);
  });

  it('leaves decorations unchanged when neither the doc nor scope refresh fires', () => {
    let currentScope: WfScopeSource[] = [...scope] as WfScopeSource[];
    const field = createChipField(() => currentScope);
    const doc = 'Fix ${ steps.triage.output } now';
    const state = EditorState.create({ doc, extensions: [field] });
    const view = new EditorView({ state, parent: document.createElement('div') });

    currentScope = [{ kind: 'step', id: 'triage', label: 'Triage result', expr: '${ steps.triage.output }' }];
    view.dispatch({ selection: { anchor: 0 } });

    expect(chipLabels(view, field)).toEqual(['Output of triage']);
  });
});
