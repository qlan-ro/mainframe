/**
 * FormFieldRow — one ask_me field: label/type/required, options chip editor
 * (choice/multi), "show only when…" (ts153 wf2-stepconfig.jsx `WfFieldRow`,
 * ported onto the contract's `showWhen` — ts153's `when` is the wire-
 * renamed field, contract §1). `fields` (the full sibling list) is only
 * used to build the "show only when…" key picker — this row never mutates
 * a sibling.
 */
import { GripVertical, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { AutomationFormField } from '../contract';
import { MiniSelect } from '../fields/MiniSelect';
import { OptionsEditor } from './OptionsEditor';

const FIELD_TYPES: AutomationFormField['type'][] = ['text', 'number', 'choice', 'multi', 'textarea'];

export interface FormFieldRowProps {
  field: AutomationFormField;
  fields: AutomationFormField[];
  onPatch: (patch: Partial<AutomationFormField>) => void;
  onRemove: () => void;
  testId: string;
}

export function FormFieldRow({ field, fields, onPatch, onRemove, testId }: FormFieldRowProps) {
  const needsOptions = field.type === 'choice' || field.type === 'multi';
  const others = fields.filter((f) => f !== field && f.key);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border-[0.5px] border-border bg-card p-2">
      <div className="flex items-center gap-1.5">
        <GripVertical size={13} className="shrink-0 text-muted-foreground" aria-hidden />
        <input
          data-testid={`${testId}-label`}
          value={field.label ?? ''}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="Label"
          className="h-[26px] min-w-[60px] flex-1 rounded-md border-[0.5px] border-input bg-card px-2 text-caption text-foreground outline-none placeholder:text-muted-foreground"
        />
        <MiniSelect
          value={field.type}
          options={FIELD_TYPES}
          onChange={(t) => {
            const type = t as AutomationFormField['type'];
            onPatch({
              type,
              options: type === 'choice' || type === 'multi' ? (field.options ?? []) : undefined,
            });
          }}
          testId={`${testId}-type`}
          mono
          width={104}
        />
        <label className="flex shrink-0 items-center gap-1.5" title="Required">
          <span className="text-caption font-medium text-muted-foreground">Req</span>
          <Switch
            data-testid={`${testId}-required`}
            checked={!!field.required}
            onCheckedChange={(required) => onPatch({ required })}
          />
        </label>
        <button
          type="button"
          data-testid={`${testId}-remove`}
          onClick={onRemove}
          aria-label="Remove field"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X size={11} aria-hidden />
        </button>
      </div>

      {needsOptions && (
        <div className="pl-5">
          <OptionsEditor
            options={field.options ?? []}
            onChange={(options) => onPatch({ options })}
            testId={`${testId}-options`}
          />
        </div>
      )}

      {field.showWhen ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-5">
          <span className="text-caption font-medium text-muted-foreground">Show when</span>
          <MiniSelect
            value={field.showWhen.key}
            options={others.length ? others.map((o) => o.key) : [field.showWhen.key]}
            onChange={(key) => onPatch({ showWhen: { key, equals: field.showWhen?.equals ?? '' } })}
            testId={`${testId}-showwhen-key`}
            mono
            width={120}
          />
          <span className="font-mono text-caption text-muted-foreground">=</span>
          <input
            data-testid={`${testId}-showwhen-equals`}
            value={field.showWhen.equals}
            onChange={(e) => onPatch({ showWhen: { key: field.showWhen?.key ?? '', equals: e.target.value } })}
            placeholder="value"
            className="h-[26px] w-[120px] rounded-md border-[0.5px] border-input bg-card px-2 text-caption text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            data-testid={`${testId}-showwhen-remove`}
            onClick={() => onPatch({ showWhen: undefined })}
            aria-label="Remove show-when condition"
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X size={10} aria-hidden />
          </button>
        </div>
      ) : (
        others.length > 0 && (
          <button
            type="button"
            data-testid={`${testId}-add-showwhen`}
            onClick={() => onPatch({ showWhen: { key: others[0]?.key ?? '', equals: '' } })}
            className="ml-5 self-start text-caption font-medium text-muted-foreground hover:text-primary"
          >
            + show only when…
          </button>
        )
      )}
    </div>
  );
}
