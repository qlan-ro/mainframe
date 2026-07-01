/**
 * WfField — renders a single QuestionField as the appropriate control.
 *
 * choice  → pill buttons (single select)
 * multi   → pill buttons with checkbox indicator (multi-select, value is string[])
 * number  → <Input type="number">
 * textarea → <textarea>
 * text    → <Input> (default)
 *
 * data-testid={`workflows-field-${field.key}`} is placed on the control root.
 */
import React from 'react';
import { CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import type { QuestionField } from '@qlan-ro/mainframe-types';

interface WfFieldProps {
  field: QuestionField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

// ── Choice / Multi pill group ─────────────────────────────────────────────────

interface PillGroupProps {
  field: QuestionField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

function PillGroup({ field, value, onChange }: PillGroupProps): React.ReactElement {
  const isMulti = field.type === 'multi';
  const selected = isMulti ? ((value ?? []) as string[]) : (value as string | undefined);

  function isOn(option: string): boolean {
    return isMulti ? (selected as string[]).includes(option) : selected === option;
  }

  function toggle(option: string): void {
    if (isMulti) {
      const arr = (selected as string[]) ?? [];
      const next = arr.includes(option) ? arr.filter((x) => x !== option) : [...arr, option];
      onChange(field.key, next);
    } else {
      onChange(field.key, option);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5" data-testid={`workflows-field-${field.key}`}>
      {(field.options ?? []).map((option) => {
        const on = isOn(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            className={cn(
              'inline-flex items-center gap-1.5 h-[30px] px-3 rounded-full cursor-pointer',
              'text-label font-medium transition-colors',
              on
                ? 'border border-primary bg-primary/10 text-primary font-semibold'
                : 'border-[0.5px] border-input bg-card text-muted-foreground',
            )}
          >
            {isMulti && (
              <span
                className={cn(
                  'w-3.5 h-3.5 rounded-sm shrink-0 inline-flex items-center justify-center',
                  on ? 'bg-primary' : 'border-[1.5px] border-muted-foreground',
                )}
              >
                {on && <CheckSquare size={9} className="text-white" strokeWidth={2.4} aria-hidden />}
              </span>
            )}
            {option}
          </button>
        );
      })}
    </div>
  );
}

// ── WfField ───────────────────────────────────────────────────────────────────

export function WfField({ field, value, onChange }: WfFieldProps): React.ReactElement {
  const testId = `workflows-field-${field.key}`;

  if (field.type === 'choice' || field.type === 'multi') {
    return <PillGroup field={field} value={value} onChange={onChange} />;
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        data-testid={testId}
        value={(value as string) ?? ''}
        placeholder={field.label}
        className="w-[140px]"
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        data-testid={testId}
        value={(value as string) ?? ''}
        placeholder={field.label}
        rows={3}
        className={cn(
          'flex w-full rounded-md border-[0.5px] border-input bg-card px-3 py-1.5',
          'text-body placeholder:text-muted-foreground resize-none leading-[1.5]',
          'focus-visible:outline-none focus-visible:ring-0',
          'transition-colors',
        )}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  }

  // default: text
  return (
    <Input
      type="text"
      data-testid={testId}
      value={(value as string) ?? ''}
      placeholder={field.label}
      onChange={(e) => onChange(field.key, e.target.value)}
    />
  );
}
