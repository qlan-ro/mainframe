/**
 * wf-expr-chips — pure `${...}` range scanner + scope-source labeler, plus
 * the CodeMirror 6 extension that renders each range as an atomic chip
 * widget. See docs/plans/2026-07-09-workflow-step-config-plan.md Task 17.
 *
 * The document value is always the plain `${...}` string; chips are a
 * view-only decoration layer computed from that string on every doc change.
 */
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import type { WfScopeSource } from './wf-scope';

export interface WfChipRange {
  from: number;
  to: number;
  label: string;
  tone: string;
}

const GENERIC_LABEL = 'ƒx';
const GENERIC_TONE = 'generic';

const TONE_BY_KIND: Record<WfScopeSource['kind'], string> = {
  step: 'step',
  answer: 'answer',
  input: 'input',
  var: 'var',
  loop: 'loop',
};

function normalize(expr: string): string {
  return expr.replace(/\s+/g, ' ').trim();
}

function findExprRanges(doc: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  while (cursor < doc.length) {
    const start = doc.indexOf('${', cursor);
    if (start === -1) break;
    const end = doc.indexOf('}', start + 2);
    if (end === -1) break; // unclosed ${ — stop scanning, no decoration for the rest
    ranges.push({ from: start, to: end + 1 });
    cursor = end + 1;
  }
  return ranges;
}

function matchSource(fullExpr: string, scope: WfScopeSource[]): WfScopeSource | undefined {
  const target = normalize(fullExpr);
  return scope.find((s) => normalize(s.expr) === target);
}

/** Pure builder: finds every `${...}` range in `doc` and labels it from `scope`. */
export function buildChipDecorations(doc: string, scope: WfScopeSource[]): WfChipRange[] {
  try {
    return findExprRanges(doc).map(({ from, to }) => {
      const match = matchSource(doc.slice(from, to), scope);
      return match
        ? { from, to, label: match.label, tone: TONE_BY_KIND[match.kind] }
        : { from, to, label: GENERIC_LABEL, tone: GENERIC_TONE };
    });
  } catch {
    return [];
  }
}

/**
 * Tailwind tint per scope-source kind, reusing the real `mf-wf-kind-*` /
 * `mf-accent-*` tokens the rest of the workflow surface already tints by
 * (glyphs.ts, WfLibrary.tsx) — no new CSS tokens needed. Full class strings
 * are written out (not built via template interpolation) so Tailwind's
 * static scanner picks them up.
 */
const TONE_CLASSES: Record<string, string> = {
  step: 'bg-mf-wf-kind-call/10 text-mf-wf-kind-call',
  answer: 'bg-mf-wf-kind-question/10 text-mf-wf-kind-question',
  input: 'bg-mf-accent-violet/10 text-mf-accent-violet',
  var: 'bg-mf-warning/10 text-mf-warning',
  loop: 'bg-mf-wf-kind-loop/10 text-mf-wf-kind-loop',
  generic: 'bg-mf-chip text-muted-foreground',
};

class ChipWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly tone: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ChipWidget &&
      this.label === other.label &&
      this.tone === other.tone &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    const toneClasses = TONE_CLASSES[this.tone] ?? TONE_CLASSES.generic;
    span.className = `inline-flex items-center rounded-[4px] px-[6px] py-[1px] text-caption font-medium leading-none align-middle cursor-pointer ${toneClasses}`;
    span.textContent = this.label;
    span.setAttribute('data-wf-chip', 'true');
    span.setAttribute('data-chip-from', String(this.from));
    span.setAttribute('data-chip-to', String(this.to));
    return span;
  }

  // Let click events bubble to the host's dom-event-handlers (chip-click-to-edit, Task 18).
  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorationSet(doc: string, scope: WfScopeSource[]): DecorationSet {
  const chips = buildChipDecorations(doc, scope);
  return Decoration.set(
    chips.map((c) => Decoration.replace({ widget: new ChipWidget(c.label, c.tone, c.from, c.to) }).range(c.from, c.to)),
    true,
  );
}

/**
 * CM6 extension wiring atomic `${...}` chip widgets: `EditorView.decorations`
 * renders them, `EditorView.atomicRanges` makes cursor motion / delete
 * commands treat each one as a single unit.
 */
export function chipExtension(getScope: () => WfScopeSource[]): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorationSet(state.doc.toString(), getScope());
    },
    update(value, tr) {
      if (!tr.docChanged) return value.map(tr.changes);
      return buildDecorationSet(tr.state.doc.toString(), getScope());
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  });

  return [field];
}
