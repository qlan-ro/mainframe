/**
 * FormFieldRow — one ask_me field: label/type/required, options chip editor
 * (choice/multi), "show only when…" (ts153 wf2-stepconfig.jsx `WfFieldRow`,
 * ported onto the contract's `showWhen` — ts153's `when` is the wire-
 * renamed field, contract §1). `fields` (the full sibling list) is only
 * used to build the "show only when…" key picker — this row never mutates
 * a sibling.
 */
import { GripVertical, X } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { AutomationFormField } from '../contract';
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
        <Input
          data-testid={`${testId}-label`}
          value={field.label ?? ''}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="Label"
          className="h-[26px] min-w-[60px] flex-1 px-2 py-0 text-xs"
        />
        <Select
          value={field.type}
          onValueChange={(next) => {
            const type = next as AutomationFormField['type'];
            onPatch({
              type,
              options: type === 'choice' || type === 'multi' ? (field.options ?? []) : undefined,
            });
          }}
        >
          <SelectTrigger data-testid={`${testId}-type`} className="h-[26px] w-[104px] font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((type) => (
              <SelectItem key={type} value={type} data-testid={`${testId}-type-option-${type}`} className="font-mono">
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Hint label="Required">
          <label className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Req</span>
            <Switch
              data-testid={`${testId}-required`}
              checked={!!field.required}
              onCheckedChange={(required) => onPatch({ required })}
            />
          </label>
        </Hint>
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
        <div className="pl-[20px]">
          <OptionsEditor
            options={field.options ?? []}
            onChange={(options) => onPatch({ options })}
            testId={`${testId}-options`}
          />
        </div>
      )}

      {field.showWhen ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-[20px]">
          <span className="text-xs font-medium text-muted-foreground">Show when</span>
          <Select
            value={field.showWhen.key}
            onValueChange={(key) => onPatch({ showWhen: { key, equals: field.showWhen?.equals ?? '' } })}
          >
            <SelectTrigger data-testid={`${testId}-showwhen-key`} className="h-[26px] w-[120px] font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(others.length ? others.map((o) => o.key) : [field.showWhen.key]).map((key) => (
                <SelectItem
                  key={key}
                  value={key}
                  data-testid={`${testId}-showwhen-key-option-${key}`}
                  className="font-mono"
                >
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="font-mono text-xs text-muted-foreground">=</span>
          <Input
            data-testid={`${testId}-showwhen-equals`}
            value={field.showWhen.equals}
            onChange={(e) => onPatch({ showWhen: { key: field.showWhen?.key ?? '', equals: e.target.value } })}
            placeholder="value"
            className="h-[26px] w-[120px] px-2 py-0 text-xs"
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
            className="ml-[20px] self-start text-xs font-medium text-muted-foreground hover:text-primary"
          >
            + show only when…
          </button>
        )
      )}
    </div>
  );
}
