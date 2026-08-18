/**
 * StepCard — leaf card: grip, icon, title, summary, issue strip, "Set up"
 * disclosure (ts153 wf2-editor.jsx `WfStepCard`'s non-block branch).
 *
 * ts153 gave every step an editable free-text `title`; the contract only
 * carries one (`AskMeStep.title` — also its token-source display label), so
 * only `ask_me` renders an editable input here. Every other verb shows its
 * static `VERB_META` label as plain text — deliberate, contract-driven
 * deviation, not an oversight.
 *
 * The "Set up" disclosure dispatches `step.kind` through `STEP_CONFIGS` to the
 * matching config panel, all keyed off this card's own
 * `automations-step-config-<id>` testid as their prefix. The map is exhaustive
 * over `LeafStep['kind']`, so a new verb fails to compile until its pane is
 * registered — the four-branch `&&` chain it replaced just rendered nothing.
 */
import { createElement, useState, type FC } from 'react';
import { GripVertical, Sliders, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActionCatalogEntry, AskMeStep, AutomationStep } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { AgentConfig } from '../steps/AgentConfig';
import { AskMeConfig } from '../steps/AskMeConfig';
import { ActionConfig } from '../steps/ActionConfig';
import { NotifyConfig } from '../steps/NotifyConfig';
import { SetValueConfig } from '../steps/SetValueConfig';
import { WaitConfig } from '../steps/WaitConfig';
import { StepSummary, type LeafStep } from './StepSummary';
import { VERB_META } from './verb-meta';

interface StepConfigProps<K extends LeafStep['kind']> {
  step: Extract<LeafStep, { kind: K }>;
  onChange: (next: Extract<LeafStep, { kind: K }>) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  testId: string;
}

const STEP_CONFIGS: { [K in LeafStep['kind']]: FC<StepConfigProps<K>> } = {
  ask_agent: AgentConfig,
  ask_me: AskMeConfig,
  run_action: ActionConfig,
  set_variable: SetValueConfig,
  notify: NotifyConfig,
  wait: WaitConfig,
};

/**
 * Generic so `step`, `onChange` and the pane stay tied to one `kind` — no cast
 * bridges them. `createElement`, not JSX: JSX resolves the element type through
 * `LibraryManagedAttributes`, which collapses the deferred `STEP_CONFIGS[K]`
 * into a union of all five panes and then rejects every prop set.
 */
function StepConfig<K extends LeafStep['kind']>({ kind, props }: { kind: K; props: StepConfigProps<K> }) {
  return createElement<StepConfigProps<K>>(STEP_CONFIGS[kind], props);
}

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
  // Only an error keeps the user from saving, so only an error gets the
  // blocking red; a warning says "check this", not "you are stuck".
  const bad = myIssues.some((i) => i.level === 'error');

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
              className="w-full border-none bg-transparent p-0 text-sm font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <span className="block text-sm font-semibold tracking-tight text-foreground">{meta.label}</span>
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
            'mt-0.5 inline-flex h-[26px] shrink-0 items-center gap-[5px] rounded-md border-[0.5px] px-2.5 text-xs font-semibold',
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
      {myIssues.length > 0 && (
        <div
          data-testid={`automations-step-issues-${step.id}`}
          data-level={bad ? 'error' : 'warning'}
          className={cn(
            'flex flex-col gap-[4px] border-t-[0.5px] px-[12px] pt-[7px] pb-[8px]',
            bad ? 'border-destructive/20 bg-destructive/[0.06]' : 'border-warning/30 bg-warning/10',
          )}
        >
          {myIssues.map((issue, i) => (
            <span
              key={i}
              className={cn(
                'flex items-start gap-1.5 text-xs font-semibold',
                issue.level === 'error' ? 'text-destructive' : 'text-warning',
              )}
            >
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
          <StepConfig
            kind={step.kind}
            props={{ step, onChange, tokens, catalog, testId: `automations-step-config-${step.id}` }}
          />
        </div>
      )}
    </div>
  );
}
