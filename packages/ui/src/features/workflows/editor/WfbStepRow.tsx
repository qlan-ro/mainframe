/**
 * WfbStepRow — a single step row in the visual builder.
 *
 * Shows: drag handle (decorative), kind icon chip, editable title, summary text,
 * and a remove button. Ports from the prototype's WfbStepRow; translates
 * inline styles to real Tailwind tokens.
 */
import { GripVertical, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getKindMeta } from '../glyphs';
import type { WfStep } from './yaml-serialize';

// ── Props ─────────────────────────────────────────────────────────────────────

interface WfbStepRowProps {
  step: WfStep;
  index: number;
  onRemove: () => void;
}

// ── Summary helper ────────────────────────────────────────────────────────────

function stepSummary(step: WfStep): string {
  switch (step.kind) {
    case 'question':
      return `${(step.fields ?? []).length} fields${step.timeout ? ` · ${step.timeout} timeout` : ''}`;
    case 'service':
      return `${step.connector ?? '?'}.${step.action ?? '?'}`;
    case 'agent':
      return 'agent session';
    case 'parallel':
      return `${(step.lanes ?? []).length} lanes`;
    case 'branch':
      return `${(step.arms ?? []).length} arms`;
    case 'loop':
      return `for each ${step.over ?? 'item'}`;
    case 'subflow':
      return step.ref ?? 'workflow';
    default:
      return 'value';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WfbStepRow({ step, index, onRemove }: WfbStepRowProps): React.ReactElement {
  const meta = getKindMeta(step.kind);
  const Icon = meta.Icon;
  const summary = stepSummary(step);
  const title = step.title ?? meta.label;

  return (
    <div
      data-testid={`workflows-builder-step-${step.id ?? String(index)}`}
      className="mb-[7px] overflow-hidden rounded-md border border-border bg-card"
    >
      <div className="flex items-center gap-[9px] px-[10px] py-2">
        {/* Drag handle (decorative) */}
        <GripVertical size={14} className="shrink-0 cursor-grab text-mf-text-4" aria-hidden />

        {/* Kind icon chip */}
        <span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted')}>
          <Icon size={13} className={meta.colorClass} aria-hidden />
        </span>

        {/* Title (read-only label — edits deferred to a step detail panel) */}
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body font-semibold text-foreground">
          {title}
        </span>

        {/* Summary */}
        <span className="shrink-0 font-mono text-micro text-mf-text-3">{summary}</span>

        {/* Remove */}
        <button
          type="button"
          aria-label="Remove step"
          onClick={onRemove}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
