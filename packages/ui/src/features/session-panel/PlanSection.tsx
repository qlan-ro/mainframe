/**
 * PlanSection — the agent's todo list. Folded, it keeps the step in progress on
 * one line; open, every step shows. Hidden when the session has no todos.
 */
import type { ReactNode } from 'react';
import { Check, ChevronRight, Circle, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useSessionTodos } from '@/store/session-todos';
import { PanelEmpty, PanelSection, RowIcon, SECTION_HEADER } from './PanelSection';
import { SECTION_LABEL } from './panel-sections';
import { todosToPlan, type PlanStep, type PlanStepState } from './plan-view';

const STEP_GLYPH: Record<PlanStepState, ReactNode> = {
  done: <Check className="size-3.5! text-success" />,
  running: <LoaderCircle className="size-3.5! animate-spin text-live motion-reduce:animate-none" />,
  next: <Circle className="size-2! text-foreground" />,
  todo: <Circle className="size-2! text-muted-foreground" />,
};
const STEP_STATE_LABEL: Record<PlanStepState, string> = {
  done: 'Done',
  running: 'In progress',
  next: 'Next',
  todo: 'To do',
};

function StepRow({ step, index, folded = false }: { step: PlanStep; index: number; folded?: boolean }) {
  const current = step.state === 'running' || step.state === 'next';
  return (
    <li
      data-testid={folded ? 'session-panel-plan-current' : `session-panel-plan-step-${index}`}
      className={cn(
        'mx-1.5 flex min-h-7 items-start gap-2 px-2.5 py-[5px] text-sm',
        !current && 'text-muted-foreground',
      )}
    >
      <span className="flex h-[18px] items-center">
        <RowIcon>{STEP_GLYPH[step.state]}</RowIcon>
      </span>
      <span className={cn('min-w-0 flex-1', folded ? 'truncate' : 'wrap-break-word')}>
        <span className="sr-only">{STEP_STATE_LABEL[step.state]}: </span>
        {step.text}
      </span>
    </li>
  );
}

export function PlanSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { chatId } = useActiveIdentity();
  const todos = useSessionTodos(chatId);
  if (todos.length === 0) return null;

  const { steps, done } = todosToPlan(todos);
  const current = steps.findIndex((step) => step.state === 'running' || step.state === 'next');
  const header = (
    <h3>
      <button
        type="button"
        data-testid="session-panel-plan-toggle"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(SECTION_HEADER, 'hover:text-foreground')}
      >
        {SECTION_LABEL.plan}
        <ChevronRight
          className={cn('mb-0.5 size-3 transition-transform motion-reduce:transition-none', open && 'rotate-90')}
          aria-hidden
        />
        <span className="ml-auto tabular-nums">
          {done} of {steps.length}
        </span>
      </button>
    </h3>
  );
  return (
    <PanelSection section="plan" data-testid="session-panel-plan" header={header}>
      {open ? (
        <ul>
          {steps.map((step, index) => (
            <StepRow key={index} step={step} index={index} />
          ))}
        </ul>
      ) : current === -1 ? (
        <PanelEmpty icon={<Check className="size-3.5! text-success" />}>
          {steps.length === 1 ? 'The only step is done' : `All ${steps.length} steps done`}
        </PanelEmpty>
      ) : (
        <ul>
          <StepRow step={steps[current]!} index={current} folded />
        </ul>
      )}
    </PanelSection>
  );
}
