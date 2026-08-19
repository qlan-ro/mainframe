/**
 * RepeatBody — "For each item in" list-token pick + inner recipe (ts153
 * wf2-editor.jsx `WfRepeatBody`, ported onto the contract's non-optional
 * `RepeatBlock.items: TokenRef`). `currentItemToken` mirrors `domain/tokens.
 * ts`'s private helper of the same name — duplicated rather than exported
 * from that frozen Phase-0 module, since this render-time scope threading
 * (tokens passed as props, `Recipe`/`IfBody`/`RepeatBody` never call
 * `scopeAt`) is a different access pattern than `scopeAt`'s whole-definition
 * walk.
 *
 * The concurrency toggle shipped in the engine (Phase 4a) with no editor
 * control — this is that control. "Whether it's showing" is local UI state,
 * seeded once from the incoming value (`IfBody`'s `showOtherwise` pattern):
 * deriving it from `step.concurrency` on every render would hide the number
 * field mid-edit the instant a keystroke clears it to type a new digit.
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ActionCatalogEntry, RepeatBlock, TokenRef } from '../contract';
import { TOKEN_STEP_CURRENT } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { TokenChip } from '../fields/TokenChip';
import { TokenPicker } from '../fields/TokenPicker';
import { Recipe } from './Recipe';

const MODES = [
  { id: 'sequential', label: 'one at a time' },
  { id: 'concurrent', label: 'several at a time' },
] as const;

export interface RepeatBodyProps {
  step: RepeatBlock;
  onChange: (patch: Partial<RepeatBlock>) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
}

function resolve(tokens: TokenDescriptor[], ref: TokenRef): TokenDescriptor | null {
  return tokens.find((t) => t.ref.stepId === ref.stepId && t.ref.output === ref.output) ?? null;
}

function currentItemToken(itemsRef: TokenRef, scope: TokenDescriptor[]): TokenDescriptor | null {
  const listToken = resolve(scope, itemsRef);
  if (!listToken) return null;
  const descriptor: TokenDescriptor = {
    ref: { stepId: TOKEN_STEP_CURRENT, output: 'item' },
    label: 'Current item',
    type: 'text',
    sourceKind: 'item',
    source: 'Repeat',
  };
  if (listToken.fields) descriptor.fields = listToken.fields;
  return descriptor;
}

function ModeToggle({
  stepId,
  concurrent,
  onSelect,
}: {
  stepId: string;
  concurrent: boolean;
  onSelect: (concurrent: boolean) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
      {MODES.map((mode) => {
        const active = concurrent === (mode.id === 'concurrent');
        return (
          <button
            key={mode.id}
            type="button"
            data-testid={`automations-repeat-concurrency-mode-${stepId}-${mode.id}`}
            aria-pressed={active}
            onClick={() => onSelect(mode.id === 'concurrent')}
            className={cn(
              'rounded-sm px-2.5 py-1 text-xs font-medium',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

function ConcurrencyControl({ step, onChange }: Pick<RepeatBodyProps, 'step' | 'onChange'>) {
  const [concurrent, setConcurrent] = useState((step.concurrency ?? 1) > 1);

  function select(next: boolean) {
    setConcurrent(next);
    onChange({ concurrency: next ? ((step.concurrency ?? 0) > 1 ? step.concurrency : 2) : undefined });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Run</span>
        <ModeToggle stepId={step.id} concurrent={concurrent} onSelect={select} />
        {concurrent && (
          <>
            <Input
              data-testid={`automations-repeat-concurrency-${step.id}`}
              type="number"
              min={2}
              max={32}
              inputMode="numeric"
              value={!step.concurrency ? '' : String(step.concurrency)}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                onChange({ concurrency: Number.isNaN(parsed) || parsed < 0 ? 0 : parsed });
              }}
              className="h-[26px] w-[60px] px-2 py-0 text-xs"
            />
            <span className="text-xs text-muted-foreground">at a time</span>
          </>
        )}
      </div>
      {concurrent && (
        <p data-testid={`automations-repeat-concurrency-caveat-${step.id}`} className="text-xs text-muted-foreground">
          Steps that wait — agents, forms, waits — genuinely overlap. Local work inside a single branch still runs one
          step at a time.
        </p>
      )}
    </>
  );
}

export function RepeatBody({ step, onChange, tokens, catalog, issues, depth }: RepeatBodyProps) {
  const listTokens = tokens.filter((t) => t.type === 'list');
  const chosen = resolve(tokens, step.items);
  const itemToken = currentItemToken(step.items, tokens);
  const inner = itemToken ? [...tokens, itemToken] : tokens;

  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="text-xs text-muted-foreground">For each item in</span>
        <TokenChip descriptor={chosen} testId={`automations-repeat-items-${step.id}`} />
        <TokenPicker
          tokens={listTokens}
          onInsert={(ref) => onChange({ items: ref })}
          testId={`automations-repeat-items-picker-${step.id}`}
        />
      </div>

      <ConcurrencyControl step={step} onChange={onChange} />

      <Recipe
        steps={step.steps}
        onChange={(steps) => onChange({ steps })}
        tokens={inner}
        catalog={catalog}
        issues={issues}
        depth={depth + 1}
        testId={`automations-recipe-${step.id}-steps`}
      />
    </div>
  );
}
