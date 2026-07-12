/**
 * StepCard — leaf card: grip, icon, title, summary, issue strip, "Set up"
 * disclosure (ts153 wf2-editor.jsx `WfStepCard`'s non-block branch).
 *
 * ts153 gave every step an editable free-text `title`; the contract only
 * carries one (`AskMeStep.title` — also its token-source display label), so
 * only `ask_me` renders an editable input here. The other three verbs show
 * their static `VERB_META` label as plain text — deliberate, contract-driven
 * deviation, not an oversight.
 *
 * The "Set up" disclosure switches on `step.kind` to the matching Phase 4
 * config panel (AgentConfig/AskMeConfig/ActionConfig/NotifyConfig), all
 * keyed off this card's own `automations-step-config-<id>` testid as their
 * prefix.
 */
import { useState } from 'react';
import { GripVertical, Sliders, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActionCatalogEntry, AskMeStep, AutomationStep } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { AgentConfig } from '../steps/AgentConfig';
import { AskMeConfig } from '../steps/AskMeConfig';
import { ActionConfig } from '../steps/ActionConfig';
import { NotifyConfig } from '../steps/NotifyConfig';
import { StepSummary, type LeafStep } from './StepSummary';
import { VERB_META } from './verb-meta';

export interface StepCardProps {
  step: LeafStep;
  onChange: (next: AutomationStep | null) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function StepCard({ step, onChange, tokens, catalog, issues, onDragStart, onDragEnd }: StepCardProps) {
  const [open, setOpen] = useState(false);
  const meta = VERB_META[step.kind];
  const Icon = meta.icon;
  const myIssues = issues.filter((i) => i.stepId === step.id);
  const bad = myIssues.length > 0;

  function patchTitle(title: string) {
    if (step.kind !== 'ask_me') return;
    onChange({ ...step, title } satisfies AskMeStep);
  }

  return (
    <div
      data-testid={`automations-step-${step.id}`}
      className={cn(
        'overflow-hidden rounded-md border-[0.5px] bg-card',
        bad ? 'border-destructive/55' : 'border-border',
      )}
    >
      <div className="flex items-start gap-[9px] px-2.5 py-[9px]">
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          data-testid={`automations-step-grip-${step.id}`}
          aria-label="Drag to reorder"
          className="mt-0.5 flex shrink-0 cursor-grab items-center text-muted-foreground"
        >
          <GripVertical size={14} aria-hidden />
        </button>
        <span className={cn('flex size-[27px] shrink-0 items-center justify-center rounded-md', meta.tintClass)}>
          <Icon size={14} className={meta.iconClass} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {step.kind === 'ask_me' ? (
            <input
              data-testid={`automations-step-title-${step.id}`}
              value={step.title}
              onChange={(e) => patchTitle(e.target.value)}
              placeholder={meta.label}
              className="w-full border-none bg-transparent p-0 text-body font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <span className="block text-body font-semibold tracking-tight text-foreground">{meta.label}</span>
          )}
          <div className="mt-0.5">
            <StepSummary step={step} tokens={tokens} catalog={catalog} />
          </div>
        </div>
        <button
          type="button"
          data-testid={`automations-step-setup-${step.id}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            'mt-0.5 inline-flex h-[26px] shrink-0 items-center gap-[5px] rounded-md border-[0.5px] px-2.5 text-caption font-semibold',
            open
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:bg-accent',
          )}
        >
          <Sliders size={12} aria-hidden />
          {open ? 'Done' : 'Set up'}
        </button>
        <button
          type="button"
          data-testid={`automations-step-delete-${step.id}`}
          onClick={() => onChange(null)}
          aria-label="Remove step"
          className="mt-0.5 flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
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
      {open && (
        <div
          data-testid={`automations-step-config-${step.id}`}
          className="border-t-[0.5px] border-border pt-[2px] pr-[12px] pb-[14px] pl-[46px]"
        >
          {step.kind === 'ask_agent' && (
            <AgentConfig
              step={step}
              onChange={(next) => onChange(next)}
              tokens={tokens}
              testId={`automations-step-config-${step.id}`}
            />
          )}
          {step.kind === 'ask_me' && (
            <AskMeConfig
              step={step}
              onChange={(next) => onChange(next)}
              testId={`automations-step-config-${step.id}`}
            />
          )}
          {step.kind === 'run_action' && (
            <ActionConfig
              step={step}
              onChange={(next) => onChange(next)}
              tokens={tokens}
              catalog={catalog}
              testId={`automations-step-config-${step.id}`}
            />
          )}
          {step.kind === 'notify' && (
            <NotifyConfig
              step={step}
              onChange={(next) => onChange(next)}
              tokens={tokens}
              testId={`automations-step-config-${step.id}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
