/**
 * AutoForm — catalog metadata -> controls (ts153 wf2-stepconfig.jsx
 * `WfActionForm`, ported onto `steps/action-fields.ts`'s UI-local
 * `ActionParamsSchema` and the contract's `params: Record<string,
 * ChipText>`). Every control commits a `ChipText`, per contract §1 — the
 * `'text'`/`'select'` controls are the non-tokenizable subset that only ever
 * write a single literal part.
 *
 * The `'columns'` control renders `columnsByOption[<sibling value>]` as one
 * ChipField row per column, writing flat into `params[columnName]` (matches
 * the canonical fixtures — `daily-health-log.json`'s `notion.add_row` step
 * has `Date`/`Mood`/`Sleep`/`Symptoms` as direct param keys, not nested
 * under a `columns` object). Its own key (conventionally `__columns`) is
 * virtual — never written to params (ts153's `WfActionForm` skipped writing
 * its `__columns` key the same way).
 */
import type { ChipText } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { ChipField } from '../fields/ChipField';
import { MiniSelect } from '../fields/MiniSelect';
import type { ActionFieldSchema, ActionParamsSchema } from './action-fields';
import { singlePart } from './action-fields';
import { FieldRow } from './FieldRow';

export interface AutoFormProps {
  schema: ActionParamsSchema;
  params: Record<string, ChipText>;
  onChange: (next: Record<string, ChipText>) => void;
  tokens: TokenDescriptor[];
  testId: string;
}

function isVisible(field: ActionFieldSchema, params: Record<string, ChipText>): boolean {
  if (!field.showWhen) return true;
  return singlePart(params[field.showWhen.key] ?? []) === field.showWhen.equals;
}

export function AutoForm({ schema, params, onChange, tokens, testId }: AutoFormProps) {
  function set(key: string, value: ChipText) {
    onChange({ ...params, [key]: value });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {schema.fields.map((field) => {
        if (!isVisible(field, params)) return null;
        const fieldTestId = `${testId}-${field.key}`;
        const value = params[field.key] ?? [];

        if (field.control === 'text') {
          return (
            <FieldRow key={field.key} label={field.label}>
              <input
                data-testid={fieldTestId}
                value={singlePart(value)}
                onChange={(e) => set(field.key, [e.target.value])}
                placeholder={field.placeholder}
                className="h-[30px] w-full rounded-md border-[0.5px] border-input bg-card px-2.5 text-body text-foreground outline-none placeholder:text-muted-foreground"
              />
            </FieldRow>
          );
        }
        if (field.control === 'select') {
          const options = field.options ?? [];
          return (
            <FieldRow key={field.key} label={field.label}>
              <MiniSelect
                value={singlePart(value) || (options[0] ?? '')}
                options={options}
                onChange={(v) => set(field.key, [v])}
                testId={fieldTestId}
                width={200}
              />
            </FieldRow>
          );
        }
        if (field.control === 'chip') {
          return (
            <FieldRow key={field.key} label={field.label}>
              <ChipField
                value={value}
                onChange={(next) => set(field.key, next)}
                tokens={tokens}
                placeholder={field.placeholder}
                testId={fieldTestId}
              />
            </FieldRow>
          );
        }
        if (field.control === 'chiparea' || field.control === 'code') {
          return (
            <FieldRow key={field.key} label={field.label} top>
              <ChipField
                value={value}
                onChange={(next) => set(field.key, next)}
                tokens={tokens}
                placeholder={field.placeholder}
                multiline
                mono={field.control === 'code'}
                minHeight={field.control === 'code' ? 54 : 48}
                testId={fieldTestId}
              />
            </FieldRow>
          );
        }
        // 'columns': dynamic per-database rows, flat into params[columnName] — the field's own key never gets written.
        const sourceValue = field.columnsSourceKey ? singlePart(params[field.columnsSourceKey] ?? []) : '';
        const columns = field.columnsByOption?.[sourceValue] ?? [];
        return (
          <FieldRow key={field.key} label={field.label} top>
            <div className="flex flex-col gap-1.5 rounded-md border-[0.5px] border-border bg-card p-2.5">
              {columns.map((column) => (
                <div key={column} className="flex items-center gap-2.5">
                  <span className="w-[76px] shrink-0 text-caption font-medium text-muted-foreground">{column}</span>
                  <div className="min-w-0 flex-1">
                    <ChipField
                      value={params[column] ?? []}
                      onChange={(next) => set(column, next)}
                      tokens={tokens}
                      placeholder="value"
                      testId={`${testId}-column-${column}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </FieldRow>
        );
      })}
    </div>
  );
}
