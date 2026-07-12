/**
 * IfBody — condition rows, and/or, Match all/any, Then/Otherwise, add-
 * otherwise (ts153 wf2-editor.jsx `WfIfBody`).
 *
 * The contract's `IfBlock.otherwise` is always an array — there is no
 * ts153-style `else: null` "not added yet" state. Whether the Otherwise
 * section is showing is therefore local UI state (`showOtherwise`), seeded
 * from `otherwise.length > 0`: opening it never patches the step (an empty
 * array is already valid data), and the "×" next to "Otherwise" both
 * collapses the section and clears any steps it held — the closest honest
 * analogue of ts153's `else: null` the contract's shape allows.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import type { ActionCatalogEntry, ConditionRow as ConditionRowModel, IfBlock } from '../contract';
import { comparatorsFor } from '../domain/comparators';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { ConditionRow } from './ConditionRow';
import { Recipe } from './Recipe';

export interface IfBodyProps {
  step: IfBlock;
  onChange: (patch: Partial<IfBlock>) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
}

export function IfBody({ step, onChange, tokens, catalog, issues, depth }: IfBodyProps) {
  const conditions = step.conditions;
  const [showOtherwise, setShowOtherwise] = useState(step.otherwise.length > 0);

  function setCondition(index: number, next: ConditionRowModel) {
    const arr = conditions.slice();
    arr[index] = next;
    onChange({ conditions: arr });
  }

  function removeCondition(index: number) {
    onChange({ conditions: conditions.filter((_, i) => i !== index) });
  }

  function addCondition() {
    // Builtins (Today/Now) guarantee `tokens` is never empty — see
    // domain/tokens.ts `builtinTokens()`.
    const first = tokens[0];
    if (!first) return;
    const comparator = comparatorsFor(first.type)[0] ?? 'is';
    onChange({ conditions: [...conditions, { token: first.ref, comparator }] });
  }

  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex flex-col gap-[7px]">
        {conditions.map((condition, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {i > 0 && (
              <span className="w-7 text-caption font-semibold text-muted-foreground">
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
                onClick={() => removeCondition(i)}
                aria-label="Remove condition"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X size={11} aria-hidden />
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid={`automations-if-add-condition-${step.id}`}
            onClick={addCondition}
            className="text-caption font-semibold text-primary"
          >
            + Add condition
          </button>
          {conditions.length > 1 && (
            <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
              <button
                type="button"
                data-testid="automations-if-match-all"
                onClick={() => onChange({ match: 'all' })}
                className={`rounded-sm px-2 py-0.5 text-caption font-medium ${step.match === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                Match all
              </button>
              <button
                type="button"
                data-testid="automations-if-match-any"
                onClick={() => onChange({ match: 'any' })}
                className={`rounded-sm px-2 py-0.5 text-caption font-medium ${step.match === 'any' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                Match any
              </button>
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-caption font-semibold text-muted-foreground">Then</div>
        <Recipe
          steps={step.then}
          onChange={(then) => onChange({ then })}
          tokens={tokens}
          catalog={catalog}
          issues={issues}
          depth={depth + 1}
          testId={`automations-recipe-${step.id}-then`}
        />
      </div>
      {showOtherwise ? (
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-caption font-semibold text-muted-foreground">Otherwise</span>
            <button
              type="button"
              data-testid={`automations-if-remove-otherwise-${step.id}`}
              onClick={() => {
                onChange({ otherwise: [] });
                setShowOtherwise(false);
              }}
              aria-label="Remove otherwise"
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X size={10} aria-hidden />
            </button>
          </div>
          <Recipe
            steps={step.otherwise}
            onChange={(otherwise) => onChange({ otherwise })}
            tokens={tokens}
            catalog={catalog}
            issues={issues}
            depth={depth + 1}
            testId={`automations-recipe-${step.id}-otherwise`}
          />
        </div>
      ) : (
        <button
          type="button"
          data-testid={`automations-if-add-otherwise-${step.id}`}
          onClick={() => setShowOtherwise(true)}
          className="self-start text-caption font-semibold text-primary"
        >
          + Add “otherwise”
        </button>
      )}
    </div>
  );
}
