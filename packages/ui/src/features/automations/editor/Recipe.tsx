/**
 * Recipe — the recursive step list with running scope accumulation and drag
 * reorder (ts153 wf2-editor.jsx `WfRecipe`). `newStep` is this module's
 * `wf2NewStep` port: every kind gets contract-valid defaults up front (no
 * ts153-style `token: null`/`list: []` "unpicked" placeholders, since the
 * contract's `ConditionRow.token`/`RepeatBlock.items` are non-optional) —
 * `if` starts with zero conditions instead (a valid, empty `ConditionRow[]`),
 * and a fresh `repeat` defaults `items` to the first list-type token in
 * scope, falling back to the first token at all (builtins guarantee scope is
 * never truly empty) if none is a list yet.
 */
import { useState } from 'react';
import type { ActionCatalogEntry, AutomationStep } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { stepProduces } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { AddStepMenu } from './AddStepMenu';
import { BlockCard } from './BlockCard';
import { StepCard } from './StepCard';
import type { LeafStep } from './StepSummary';

function newStep(kind: AutomationStep['kind'], tokensBefore: TokenDescriptor[]): AutomationStep {
  const id = crypto.randomUUID();
  switch (kind) {
    case 'ask_agent':
      return { id, kind, prompt: [] };
    case 'ask_me':
      return { id, kind, title: 'Ask me', fields: [{ key: 'answer', label: 'Answer', type: 'text' }] };
    case 'run_action':
      return { id, kind, actionId: '', params: {} };
    case 'notify':
      return { id, kind, message: [] };
    case 'set_variable':
      return { id, kind, name: '', value: [''] };
    // 5 minutes: long enough to be a real pause, short enough that a user who
    // adds one to poll something sees it resume rather than assume it hung.
    case 'wait':
      return { id, kind, seconds: 300 };
    case 'if':
      return { id, kind, match: 'all', conditions: [], then: [], otherwise: [] };
    case 'repeat': {
      // Builtins (Today/Now) guarantee `tokensBefore` is never empty — see
      // domain/tokens.ts `builtinTokens()` — so this fallback always resolves.
      const listToken = tokensBefore.find((t) => t.type === 'list') ?? tokensBefore[0];
      const ref = listToken ? listToken.ref : { stepId: 'builtin', output: 'today' };
      return { id, kind, items: ref, steps: [] };
    }
    // 20 passes: enough for a realistic CI poll at a 30s wait, low enough that
    // a runaway condition surfaces in minutes rather than hours.
    case 'loop':
      return { id, kind, mode: 'until', match: 'all', conditions: [], maxIterations: 20, steps: [] };
    case 'break':
      return { id, kind };
  }
}

function isBlock(step: AutomationStep): step is Extract<AutomationStep, { kind: 'if' | 'repeat' | 'loop' }> {
  return step.kind === 'if' || step.kind === 'repeat' || step.kind === 'loop';
}

export interface RecipeProps {
  steps: AutomationStep[];
  onChange: (next: AutomationStep[]) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth?: number;
  testId: string;
}

export function Recipe({ steps, onChange, tokens, catalog, issues, depth = 0, testId }: RecipeProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function setAt(index: number, next: AutomationStep | null) {
    const arr = steps.slice();
    if (next === null) arr.splice(index, 1);
    else arr[index] = next;
    onChange(arr);
  }

  function move(from: number, to: number) {
    if (from === to) return;
    const arr = steps.slice();
    const [item] = arr.splice(from, 1);
    if (item === undefined) return;
    arr.splice(to, 0, item);
    onChange(arr);
  }

  const entries: Array<{ step: AutomationStep; before: TokenDescriptor[] }> = [];
  let running = tokens;
  for (const step of steps) {
    entries.push({ step, before: running });
    running = running.concat(stepProduces(step, catalog));
  }

  return (
    <div data-testid={testId} className="flex flex-col gap-[8px]">
      {entries.map(({ step, before }, i) => (
        <div
          key={step.id}
          onDragOver={(e) => {
            if (dragIndex !== null) {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => {
            if (dragIndex !== null) {
              e.preventDefault();
              move(dragIndex, i);
              setDragIndex(null);
            }
          }}
          className={dragIndex === i ? 'opacity-40' : undefined}
        >
          {isBlock(step) ? (
            <BlockCard
              step={step}
              onChange={(next) => setAt(i, next)}
              tokens={before}
              catalog={catalog}
              issues={issues}
              depth={depth}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
            />
          ) : (
            <StepCard
              step={step as LeafStep}
              onChange={(next) => setAt(i, next)}
              tokens={before}
              catalog={catalog}
              issues={issues}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
            />
          )}
        </div>
      ))}
      <AddStepMenu
        catalog={catalog}
        onAdd={(kind) => onChange([...steps, newStep(kind, running)])}
        onAddAction={(actionId) =>
          onChange([...steps, { id: crypto.randomUUID(), kind: 'run_action', actionId, params: {} }])
        }
        testId={`${testId}-add`}
      />
    </div>
  );
}
