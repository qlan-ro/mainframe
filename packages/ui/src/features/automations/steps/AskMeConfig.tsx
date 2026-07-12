/**
 * AskMeConfig — title + field list + add-field (ts153 wf2-stepconfig.jsx
 * `WfAskMeConfig`, ported onto `AskMeStep`). Rows have no domain id besides
 * their own transiently-editable `key`, so — like `ConditionRow` —
 * `FormFieldRow`s are index-keyed via `testId`.
 */
import { Plus } from 'lucide-react';
import type { AskMeStep, AutomationFormField } from '../contract';
import { FailureToggle } from './FailureToggle';
import { FieldRow } from './FieldRow';
import { FormFieldRow } from './FormFieldRow';
import { MoreOptions } from './MoreOptions';

export interface AskMeConfigProps {
  step: AskMeStep;
  onChange: (next: AskMeStep) => void;
  testId: string;
}

export function AskMeConfig({ step, onChange, testId }: AskMeConfigProps) {
  function setField(index: number, patch: Partial<AutomationFormField>) {
    const next = step.fields.slice();
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch };
    onChange({ ...step, fields: next });
  }

  function addField() {
    const field: AutomationFormField = { key: `field_${step.fields.length + 1}`, label: '', type: 'text' };
    onChange({ ...step, fields: [...step.fields, field] });
  }

  function removeField(index: number) {
    onChange({ ...step, fields: step.fields.filter((_, i) => i !== index) });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <FieldRow label="Title">
        <input
          data-testid={`${testId}-title`}
          value={step.title}
          onChange={(e) => onChange({ ...step, title: e.target.value })}
          placeholder="What am I answering?"
          className="h-[30px] w-full rounded-md border-[0.5px] border-input bg-card px-2.5 text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
      </FieldRow>

      <div className="flex flex-col gap-1.5">
        {step.fields.map((field, i) => (
          <FormFieldRow
            key={i}
            field={field}
            fields={step.fields}
            onPatch={(patch) => setField(i, patch)}
            onRemove={() => removeField(i)}
            testId={`${testId}-field-${i}`}
          />
        ))}
        <button
          type="button"
          data-testid={`${testId}-add`}
          onClick={addField}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-dashed border-mf-border-hover px-2.5 py-1 text-caption font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus size={10} aria-hidden />
          Add a field
        </button>
      </div>

      <MoreOptions testId={`${testId}-more`}>
        <FailureToggle
          keepGoing={!!step.keepGoing}
          onChange={(keepGoing) => onChange({ ...step, keepGoing })}
          testId={`${testId}-keepgoing`}
        />
      </MoreOptions>
    </div>
  );
}
