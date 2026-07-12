/**
 * BlockCard — If/Repeat bracket frame: tinted border + left rule around the
 * block's own `IfBody`/`RepeatBody` (ts153 wf2-editor.jsx `WfStepCard`'s
 * block branch, extracted). Neither block kind carries a free-text name in
 * the contract, so the header shows the static `VERB_META` label — no
 * editable title, matching `StepCard`'s ask_me-only exception the other
 * direction (blocks get none at all).
 */
import { GripVertical, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActionCatalogEntry, AutomationStep, IfBlock, RepeatBlock } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { IfBody } from './IfBody';
import { RepeatBody } from './RepeatBody';
import { VERB_META } from './verb-meta';

export interface BlockCardProps {
  step: IfBlock | RepeatBlock;
  onChange: (next: AutomationStep | null) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function BlockCard({ step, onChange, tokens, catalog, issues, depth, onDragStart, onDragEnd }: BlockCardProps) {
  const meta = VERB_META[step.kind];
  const Icon = meta.icon;
  const myIssues = issues.filter((i) => i.stepId === step.id);
  const bad = myIssues.length > 0;

  function patch(p: Partial<IfBlock> | Partial<RepeatBlock>) {
    onChange({ ...step, ...p } as AutomationStep);
  }

  return (
    <div
      data-testid={`automations-step-${step.id}`}
      className={cn(
        'overflow-hidden rounded-lg border-[0.5px]',
        bad ? 'border-destructive/55' : meta.borderClass,
        meta.cardTintClass ?? meta.tintClass,
      )}
    >
      <div className="flex items-center gap-[9px] px-2.5 py-[9px]">
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          data-testid={`automations-step-grip-${step.id}`}
          aria-label="Drag to reorder"
          className="flex shrink-0 cursor-grab items-center text-muted-foreground"
        >
          <GripVertical size={14} aria-hidden />
        </button>
        <span className={cn('flex size-[27px] shrink-0 items-center justify-center rounded-md', meta.tintClass)}>
          <Icon size={14} className={meta.iconClass} aria-hidden />
        </span>
        <span className="flex-1 text-body font-semibold tracking-tight text-foreground">{meta.label}</span>
        <button
          type="button"
          data-testid={`automations-step-delete-${step.id}`}
          onClick={() => onChange(null)}
          aria-label="Remove step"
          className="flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>
      {bad && (
        <div className="flex flex-col gap-[4px] border-t-[0.5px] border-destructive/20 bg-destructive/[0.06] px-[12px] pt-[7px] pb-[8px]">
          {myIssues.map((issue, i) => (
            <span key={i} className="flex items-start gap-1.5 text-caption font-semibold text-destructive">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
              {issue.msg}
            </span>
          ))}
        </div>
      )}
      <div className="pr-[10px] pb-[11px] pl-[12px]">
        <div className={cn('flex flex-col gap-[11px] border-l-2 pl-[12px]', meta.borderClass)}>
          {step.kind === 'if' ? (
            <IfBody step={step} onChange={patch} tokens={tokens} catalog={catalog} issues={issues} depth={depth} />
          ) : (
            <RepeatBody step={step} onChange={patch} tokens={tokens} catalog={catalog} issues={issues} depth={depth} />
          )}
        </div>
      </div>
    </div>
  );
}
