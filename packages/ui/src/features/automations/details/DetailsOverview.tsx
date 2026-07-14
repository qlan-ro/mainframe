/**
 * DetailsOverview — read-only render of an automation's config summary
 * (todo #233): description, triggers, and step recipe. Reuses the same
 * presentational pieces `AutomationEditor`'s Recipe/StepCard already render
 * — `VERB_META` (icon/label), `StepSummary` (leaf steps' one-line preview),
 * `TriggerChips` — just without any onChange/drag/delete affordance.
 *
 * Blocks (`if`/`repeat`) show a branch/step-count caption rather than a full
 * recursive render — enough to see the shape without duplicating the
 * editor's `BlockCard`/`IfBody`/`RepeatBody` tree.
 */
import { cn } from '@/lib/utils';
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../contract';
import { builtinTokens, stepProduces, triggerTokens, type TokenDescriptor } from '../domain/tokens';
import { StepSummary, type LeafStep } from '../editor/StepSummary';
import { VERB_META } from '../editor/verb-meta';
import { TriggerChips } from '../library/TriggerChips';

function isLeaf(step: AutomationStep): step is LeafStep {
  return step.kind !== 'if' && step.kind !== 'repeat';
}

function blockCaption(step: Extract<AutomationStep, { kind: 'if' | 'repeat' }>): string {
  if (step.kind === 'if') {
    const parts = [
      step.then.length > 0 ? `${step.then.length} step${step.then.length === 1 ? '' : 's'} in "then"` : null,
      step.otherwise.length > 0
        ? `${step.otherwise.length} step${step.otherwise.length === 1 ? '' : 's'} in "otherwise"`
        : null,
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(', ') : 'No steps yet';
  }
  return `${step.steps.length} step${step.steps.length === 1 ? '' : 's'} per item`;
}

interface StepEntry {
  step: AutomationStep;
  before: TokenDescriptor[];
}

function buildStepEntries(
  steps: AutomationStep[],
  catalog: ActionCatalogEntry[],
  seed: TokenDescriptor[],
): StepEntry[] {
  const entries: StepEntry[] = [];
  let running = seed;
  for (const step of steps) {
    entries.push({ step, before: running });
    running = running.concat(stepProduces(step, catalog));
  }
  return entries;
}

export interface DetailsOverviewProps {
  description?: string;
  definition: AutomationDefinition;
  catalog: ActionCatalogEntry[];
}

export function DetailsOverview({ description, definition, catalog }: DetailsOverviewProps) {
  const seed = builtinTokens().concat(triggerTokens(definition.triggers));
  const entries = buildStepEntries(definition.steps, catalog, seed);

  return (
    <div data-testid="automations-details-overview" className="flex flex-col gap-[20px] px-[20px] py-[18px]">
      {description && <p className="text-body text-muted-foreground">{description}</p>}

      <div>
        <h3 className="mb-[8px] text-caption font-semibold text-muted-foreground">When</h3>
        {definition.triggers.length === 0 ? (
          <p className="text-label text-muted-foreground">No trigger — run it by hand.</p>
        ) : (
          <TriggerChips triggers={definition.triggers} />
        )}
      </div>

      <div>
        <h3 className="mb-[8px] text-caption font-semibold text-muted-foreground">Do</h3>
        {entries.length === 0 ? (
          <p className="text-label text-muted-foreground">No steps yet.</p>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {entries.map(({ step, before }) => {
              const meta = VERB_META[step.kind];
              const Icon = meta.icon;
              return (
                <div
                  key={step.id}
                  data-testid={`automations-details-step-${step.id}`}
                  className="flex items-start gap-[9px] rounded-md border-[0.5px] border-border bg-card px-[10px] py-[9px]"
                >
                  <span
                    className={cn('flex size-[24px] shrink-0 items-center justify-center rounded-md', meta.tintClass)}
                  >
                    <Icon size={13} className={meta.iconClass} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-label font-semibold text-foreground">{meta.label}</div>
                    <div className="mt-0.5">
                      {isLeaf(step) ? (
                        <StepSummary step={step} tokens={before} catalog={catalog} />
                      ) : (
                        <span className="text-caption text-muted-foreground">{blockCaption(step)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
