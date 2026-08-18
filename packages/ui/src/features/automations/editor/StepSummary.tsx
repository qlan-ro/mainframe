/**
 * StepSummary — per-verb collapsed summary line under a StepCard's title
 * (ts153 wf2-editor.jsx `WfStepCard`'s inline `summary` computation,
 * extracted into its own component). `ChipTextPreview` is the read-only
 * chip-text renderer `StepCard` also needs — kept local to this file (not
 * `fields/`, which is a frozen Phase 2 deliverable) since this is the only
 * caller today.
 */
import { TriangleAlert } from 'lucide-react';
import type {
  ActionCatalogEntry,
  AskAgentStep,
  AskMeStep,
  ChipText,
  NotifyStep,
  RunActionStep,
  BreakStep,
  SetVariableStep,
  TokenRef,
  WaitStep,
} from '../contract';
import { isTokenPart } from '../domain/chip-parts';
import type { TokenDescriptor } from '../domain/tokens';
import { TokenChip } from '../fields/TokenChip';

export type LeafStep = AskAgentStep | AskMeStep | RunActionStep | NotifyStep | SetVariableStep | WaitStep | BreakStep;

interface StepSummaryProps {
  step: LeafStep;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
}

function resolve(tokens: TokenDescriptor[], ref: TokenRef): TokenDescriptor | null {
  return tokens.find((t) => t.ref.stepId === ref.stepId && t.ref.output === ref.output) ?? null;
}

function ChipTextPreview({ value, tokens, empty }: { value: ChipText; tokens: TokenDescriptor[]; empty: string }) {
  if (value.length === 0) return <span className="text-xs text-muted-foreground">{empty}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 leading-6">
      {value.map((part, i) =>
        isTokenPart(part) ? (
          <TokenChip key={i} descriptor={resolve(tokens, part.token)} field={part.token.field} />
        ) : (
          <span key={i} className="whitespace-pre-wrap text-xs text-foreground">
            {part}
          </span>
        ),
      )}
    </span>
  );
}

function AskMeSummary({ step }: { step: AskMeStep }) {
  const count = step.fields.length;
  const labels = step.fields
    .map((f) => f.label || f.key)
    .filter(Boolean)
    .slice(0, 4)
    .join(', ');
  return (
    <span className="text-xs text-muted-foreground">
      {count} field{count === 1 ? '' : 's'}
      {count > 0 ? ` · ${labels}` : ''}
    </span>
  );
}

function RunActionSummary({ step, catalog }: { step: RunActionStep; catalog: ActionCatalogEntry[] }) {
  const action = catalog.find((a) => a.id === step.actionId);
  if (action) return <span className="text-xs text-muted-foreground">{action.title}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
      <TriangleAlert size={11} className="text-warning" aria-hidden />
      Pick an action
    </span>
  );
}

export function StepSummary({ step, tokens, catalog }: StepSummaryProps) {
  switch (step.kind) {
    case 'ask_agent':
      return <ChipTextPreview value={step.prompt} tokens={tokens} empty="No prompt yet" />;
    case 'notify':
      return <ChipTextPreview value={step.message} tokens={tokens} empty="No message yet" />;
    case 'ask_me':
      return <AskMeSummary step={step} />;
    case 'run_action':
      return <RunActionSummary step={step} catalog={catalog} />;
    case 'set_variable':
      return <span className="text-xs text-muted-foreground">{step.name ? `Set $${step.name}` : 'Unnamed value'}</span>;
    case 'wait':
      return <span className="text-xs text-muted-foreground">{formatDuration(step.seconds)}</span>;
    case 'break':
      return <span className="text-xs text-muted-foreground">Leave the surrounding loop</span>;
  }
}

/** Largest whole unit, matching how `WaitConfig` derives the editing unit. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'No duration set';
  const [amount, unit] =
    seconds % 3600 === 0
      ? [seconds / 3600, 'hour']
      : seconds % 60 === 0
        ? [seconds / 60, 'minute']
        : [seconds, 'second'];
  return `Wait ${amount} ${unit}${amount === 1 ? '' : 's'}`;
}
