/**
 * ConditionRow — token chip · comparator · value (ts153 wf2-editor.jsx
 * `WfConditionRow`, ported onto the contract's typed `Comparator` enum and
 * A3's `is_one_of`).
 *
 * The contract's `ConditionRow.token` is a non-optional `TokenRef` (unlike
 * ts153's `token: null` placeholder for "not yet picked") — so there is no
 * unpicked state to render: the chip is always shown, resolved against the
 * `tokens` scope, with a `TokenPicker` alongside it to CHANGE the pick
 * (never to first-assign one). `ConditionRow` entries carry no `id` in the
 * wire contract, so the caller's `testId` is index-keyed — the one place in
 * this feature where a domain id genuinely doesn't exist to key by.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Comparator, ConditionRow as ConditionRowModel, TokenRef } from '../contract';
import { comparatorNeedsValue, comparatorsFor, isMultiValue } from '../domain/comparators';
import type { TokenDescriptor } from '../domain/tokens';
import { MiniSelect } from '../fields/MiniSelect';
import { TokenChip } from '../fields/TokenChip';
import { TokenPicker } from '../fields/TokenPicker';

// A mapped type over the exact `Comparator` union (not `Record<string, string>`)
// so indexed access below stays `string`, never `string | undefined`.
const COMPARATOR_LABELS: Record<Comparator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  starts_with: 'starts with',
  eq: '=',
  lt: '<',
  gt: '>',
  is_empty: 'is empty',
  not_empty: 'is not empty',
  is_one_of: 'is one of',
};

function resolve(tokens: TokenDescriptor[], ref: TokenRef): TokenDescriptor | null {
  return tokens.find((t) => t.ref.stepId === ref.stepId && t.ref.output === ref.output) ?? null;
}

function MultiValueEditor({
  descriptor,
  value,
  onChange,
  testId,
}: {
  descriptor: TokenDescriptor | null;
  value: Array<string | number>;
  onChange: (next: Array<string | number>) => void;
  testId: string;
}) {
  if (descriptor?.type === 'choice' && descriptor.options) {
    return (
      <div data-testid={testId} className="flex flex-wrap gap-1">
        {descriptor.options.map((option) => {
          const active = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              data-testid={`${testId}-option-${option}`}
              onClick={() => onChange(active ? value.filter((v) => v !== option) : [...value, option])}
              className={cn(
                'h-6 rounded-full border-[0.5px] px-2.5 text-caption font-medium',
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    );
  }
  return <ValueChipList value={value} onChange={onChange} testId={testId} />;
}

function ValueChipList({
  value,
  onChange,
  testId,
}: {
  value: Array<string | number>;
  onChange: (next: Array<string | number>) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    if (!draft.trim()) return;
    onChange([...value, draft.trim()]);
    setDraft('');
  }

  return (
    <div
      data-testid={testId}
      className="flex min-h-7 flex-wrap items-center gap-1 rounded-md border-[0.5px] border-input bg-card px-2 py-1"
    >
      {value.map((v, i) => (
        <span
          key={i}
          className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-caption text-foreground"
        >
          {v}
          <button
            type="button"
            data-testid={`${testId}-remove-${i}`}
            onClick={() => onChange(value.filter((_, k) => k !== i))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={9} aria-hidden />
          </button>
        </span>
      ))}
      <input
        data-testid={`${testId}-input`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={value.length === 0 ? 'value' : undefined}
        className="min-w-[60px] flex-1 border-none bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export interface ConditionRowProps {
  condition: ConditionRowModel;
  tokens: TokenDescriptor[];
  onChange: (next: ConditionRowModel) => void;
  testId: string;
}

export function ConditionRow({ condition, tokens, onChange, testId }: ConditionRowProps) {
  const descriptor = resolve(tokens, condition.token);
  const comparators = comparatorsFor(descriptor?.type ?? 'text');
  const needsValue = comparatorNeedsValue(condition.comparator);
  const multi = isMultiValue(condition.comparator);

  function handleTokenPick(ref: TokenRef) {
    const next = resolve(tokens, ref);
    const nextComparators = comparatorsFor(next?.type ?? 'text');
    // comparatorsFor always returns a non-empty array — see comparators.ts BY_TYPE.
    onChange({ token: ref, comparator: nextComparators[0] ?? 'is' });
  }

  function handleComparatorLabel(label: string) {
    const comparator = comparators.find((c) => COMPARATOR_LABELS[c] === label) ?? comparators[0] ?? 'is';
    onChange({ ...condition, comparator, value: comparatorNeedsValue(comparator) ? condition.value : undefined });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <TokenChip descriptor={descriptor} testId={`${testId}-token`} />
      <TokenPicker tokens={tokens} onInsert={handleTokenPick} testId={`${testId}-token-picker`} />
      <MiniSelect
        value={COMPARATOR_LABELS[condition.comparator]}
        options={comparators.map((c) => COMPARATOR_LABELS[c])}
        onChange={handleComparatorLabel}
        testId={`${testId}-comparator`}
        width={116}
      />
      {needsValue &&
        (multi ? (
          <MultiValueEditor
            descriptor={descriptor}
            value={Array.isArray(condition.value) ? condition.value : []}
            onChange={(value) => onChange({ ...condition, value })}
            testId={`${testId}-value`}
          />
        ) : descriptor?.type === 'choice' && descriptor.options ? (
          <MiniSelect
            value={typeof condition.value === 'string' ? condition.value : (descriptor.options[0] ?? '')}
            options={descriptor.options}
            onChange={(value) => onChange({ ...condition, value })}
            testId={`${testId}-value`}
            width={130}
          />
        ) : (
          <input
            data-testid={`${testId}-value`}
            value={
              typeof condition.value === 'string' || typeof condition.value === 'number' ? String(condition.value) : ''
            }
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder="value"
            className="h-[28px] w-[130px] rounded-md border-[0.5px] border-input bg-card px-2.5 text-caption text-foreground outline-none placeholder:text-muted-foreground"
          />
        ))}
    </div>
  );
}
