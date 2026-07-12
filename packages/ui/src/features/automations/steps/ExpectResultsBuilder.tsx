/**
 * ExpectResultsBuilder — A2's "Expect results" rows: key + type + options-
 * for-choice (contract §6 A2). Declared keys become named, typed tokens
 * alongside `result`/`chatId` — `domain/tokens.ts`'s `stepProduces` already
 * reads `step.expects` this way (Phase 0); this component only authors it.
 *
 * No ts153 artboard for this (A2 postdates the prototype) — styled from the
 * same field-row idiom as `AskMeConfig`'s `FormFieldRow`. Rows have no
 * stable id besides the (transiently-editable, possibly-duplicate) `key`
 * itself, so — same documented exception as `ConditionRow` — the caller's
 * `testId` is index-keyed.
 */
import { Plus, X } from 'lucide-react';
import type { AutomationExpectedOutput } from '../contract';
import { MiniSelect } from '../fields/MiniSelect';
import { OptionsEditor } from './OptionsEditor';

const EXPECT_TYPES: AutomationExpectedOutput['type'][] = ['text', 'number', 'list', 'choice'];

export interface ExpectResultsBuilderProps {
  expects: AutomationExpectedOutput[];
  onChange: (next: AutomationExpectedOutput[]) => void;
  testId: string;
}

export function ExpectResultsBuilder({ expects, onChange, testId }: ExpectResultsBuilderProps) {
  function setRow(index: number, patch: Partial<AutomationExpectedOutput>) {
    const next = expects.slice();
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch };
    onChange(next);
  }

  function addRow() {
    onChange([...expects, { key: `result_${expects.length + 1}`, type: 'text' }]);
  }

  function removeRow(index: number) {
    onChange(expects.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {expects.map((row, i) => (
        <div
          key={i}
          data-testid={`${testId}-row-${i}`}
          className="flex flex-col gap-1.5 rounded-md border-[0.5px] border-border bg-card p-2"
        >
          <div className="flex items-center gap-2">
            <input
              data-testid={`${testId}-key-${i}`}
              value={row.key}
              onChange={(e) => setRow(i, { key: e.target.value })}
              placeholder="key"
              className="h-[26px] flex-1 rounded-md border-[0.5px] border-input bg-card px-2 font-mono text-caption text-foreground outline-none placeholder:text-muted-foreground"
            />
            <MiniSelect
              value={row.type}
              options={EXPECT_TYPES}
              onChange={(t) => {
                const type = t as AutomationExpectedOutput['type'];
                setRow(i, { type, options: type === 'choice' ? (row.options ?? []) : undefined });
              }}
              testId={`${testId}-type-${i}`}
              mono
              width={100}
            />
            <button
              type="button"
              data-testid={`${testId}-remove-${i}`}
              onClick={() => removeRow(i)}
              aria-label="Remove expected result"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X size={11} aria-hidden />
            </button>
          </div>
          {row.type === 'choice' && (
            <div className="pl-5">
              <OptionsEditor
                options={row.options ?? []}
                onChange={(options) => setRow(i, { options })}
                testId={`${testId}-options-${i}`}
              />
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        data-testid={`${testId}-add`}
        onClick={addRow}
        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-caption font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus size={10} aria-hidden />
        Add a result
      </button>
    </div>
  );
}
