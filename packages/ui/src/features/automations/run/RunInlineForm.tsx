/**
 * RunInlineForm — the paused Ask-me answer form, embedded inline under its
 * `waiting` timeline row (ts153 wf2-runtime.jsx `WfRunForm`, ported onto the
 * real `AutomationInteractionSummary.fields`/`gateway.respondInteraction`
 * instead of an unsubmitted local mock). Choice/multi options render as pill
 * buttons — the exact pattern `editor/ConditionRow.tsx`'s is_one_of
 * multi-select and `steps/FormFieldRow.tsx` already use — text/number/
 * textarea fall back to plain controls. Self-sufficient like `LibraryRow`:
 * owns its own gateway call and store patch rather than taking callbacks for
 * them.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import type { AutomationFormField, AutomationInteractionSummary } from '../contract';
import { useAutomationsStore } from '../data/use-automations-store';

type FieldValue = string | string[] | undefined;

function isVisible(field: AutomationFormField, values: Record<string, FieldValue>): boolean {
  return !field.showWhen || values[field.showWhen.key] === field.showWhen.equals;
}

function isEmptyValue(value: FieldValue): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function PillOption({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'h-6 rounded-full border-[0.5px] px-2.5 text-caption font-medium',
        active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  testId,
}: {
  field: AutomationFormField;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  testId: string;
}) {
  if (field.type === 'choice') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options ?? []).map((option) => (
          <PillOption
            key={option}
            label={option}
            active={value === option}
            onClick={() => onChange(option)}
            testId={`${testId}-option-${option}`}
          />
        ))}
      </div>
    );
  }
  if (field.type === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options ?? []).map((option) => {
          const active = selected.includes(option);
          return (
            <PillOption
              key={option}
              label={option}
              active={active}
              onClick={() => onChange(active ? selected.filter((v) => v !== option) : [...selected, option])}
              testId={`${testId}-option-${option}`}
            />
          );
        })}
      </div>
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        data-testid={`${testId}-input`}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[60px] w-full resize-y rounded-md border-[0.5px] border-input bg-card px-2.5 py-1.5 text-body text-foreground outline-none"
      />
    );
  }
  return (
    <input
      data-testid={`${testId}-input`}
      type={field.type === 'number' ? 'number' : 'text'}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      className="h-[30px] w-full rounded-md border-[0.5px] border-input bg-card px-2.5 text-body text-foreground outline-none"
    />
  );
}

export interface RunInlineFormProps {
  interaction: AutomationInteractionSummary;
  onSubmitted?: () => void;
  testId: string;
}

export function RunInlineForm({ interaction, onSubmitted, testId }: RunInlineFormProps) {
  const gateway = useAutomationsStore((s) => s.gateway);
  const resolveInteraction = useAutomationsStore((s) => s.resolveInteraction);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [submitting, setSubmitting] = useState(false);

  const visibleFields = interaction.fields.filter((f) => isVisible(f, values));
  const missingRequired = visibleFields.some((f) => f.required && isEmptyValue(values[f.key]));

  function setValue(key: string, value: FieldValue) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit() {
    if (missingRequired || submitting) return;
    setSubmitting(true);
    try {
      const response: Record<string, unknown> = {};
      for (const field of visibleFields) {
        const value = values[field.key];
        if (!isEmptyValue(value)) response[field.key] = value;
      }
      await gateway.respondInteraction(interaction.id, response);
      resolveInteraction(interaction.id);
      onSubmitted?.();
    } catch (err) {
      mfToast.error('Could not submit the answer', { description: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2.5 rounded-lg border-[0.5px] border-mf-warning/35 bg-mf-warning/[0.06] p-3"
    >
      <div className="text-label font-bold text-foreground">{interaction.title}</div>
      {visibleFields.map((field) => (
        <div key={field.key} data-testid={`${testId}-field-${field.key}`} className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold text-muted-foreground">
            {field.label || field.key}
            {field.required && <span className="text-destructive"> *</span>}
          </span>
          <FieldControl
            field={field}
            value={values[field.key]}
            onChange={(next) => setValue(field.key, next)}
            testId={`${testId}-field-${field.key}`}
          />
        </div>
      ))}
      <button
        type="button"
        data-testid={`${testId}-submit`}
        disabled={missingRequired || submitting}
        onClick={() => void handleSubmit()}
        className="h-[30px] w-fit rounded-md bg-primary px-3.5 text-label font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
      >
        Submit
      </button>
    </div>
  );
}
