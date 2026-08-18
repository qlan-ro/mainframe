/**
 * LoopBody — a condition loop's mode, its continue test, its pass ceiling,
 * and the steps it repeats.
 *
 * The condition rows are `IfBody`'s, deliberately: a loop's test and an `if`'s
 * are the same question asked at different times, and giving them two editors
 * would make them look like two languages.
 *
 * The pass ceiling is a required field, not an advanced option, because the
 * engine fails a loop that exhausts it — so a user who never sees the number
 * cannot understand the failure when it arrives.
 */
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ActionCatalogEntry, ConditionRow as ConditionRowModel, LoopBlock } from '../contract';
import { comparatorsFor } from '../domain/comparators';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { ConditionRow } from './ConditionRow';
import { Recipe } from './Recipe';

const MODES = [
  { id: 'until', label: 'until' },
  { id: 'while', label: 'while' },
] as const;

export interface LoopBodyProps {
  step: LoopBlock;
  onChange: (patch: Partial<LoopBlock>) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
}

export function LoopBody({ step, onChange, tokens, catalog, issues, depth }: LoopBodyProps) {
  const conditions = step.conditions;

  function setCondition(index: number, next: ConditionRowModel) {
    const arr = conditions.slice();
    arr[index] = next;
    onChange({ conditions: arr });
  }

  function addCondition() {
    const first = tokens[0];
    if (!first) return;
    const comparator = comparatorsFor(first.type)[0] ?? 'is';
    onChange({ conditions: [...conditions, { token: first.ref, comparator }] });
  }

  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Repeat</span>
        <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-testid={`automations-loop-mode-${step.id}-${mode.id}`}
              aria-pressed={step.mode === mode.id}
              onClick={() => onChange({ mode: mode.id })}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium',
                step.mode === mode.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-[7px]">
        {conditions.map((condition, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {i > 0 && (
              <span className="w-7 text-xs font-semibold text-muted-foreground">
                {step.match === 'any' ? 'or' : 'and'}
              </span>
            )}
            <ConditionRow
              condition={condition}
              tokens={tokens}
              onChange={(next) => setCondition(i, next)}
              testId={`automations-condition-${step.id}-${i}`}
            />
            {conditions.length > 1 && (
              <button
                type="button"
                data-testid={`automations-condition-remove-${step.id}-${i}`}
                onClick={() => onChange({ conditions: conditions.filter((_, index) => index !== i) })}
                aria-label="Remove condition"
                className="flex size-[22px] items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
              >
                <X size={11} aria-hidden />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          data-testid={`automations-condition-add-${step.id}`}
          onClick={addCondition}
          className="self-start text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          + Add condition
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Give up after</span>
        <Input
          data-testid={`automations-loop-max-${step.id}`}
          type="number"
          min={1}
          max={500}
          inputMode="numeric"
          value={step.maxIterations === 0 ? '' : String(step.maxIterations)}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10);
            onChange({ maxIterations: Number.isNaN(parsed) || parsed < 0 ? 0 : parsed });
          }}
          className="h-[26px] w-[72px] px-2 py-0 text-xs"
        />
        <span className="text-xs text-muted-foreground">passes, and fail</span>
      </div>

      <Recipe
        steps={step.steps}
        onChange={(steps) => onChange({ steps })}
        tokens={tokens}
        catalog={catalog}
        issues={issues}
        depth={depth + 1}
        testId={`automations-loop-recipe-${step.id}`}
      />
    </div>
  );
}
