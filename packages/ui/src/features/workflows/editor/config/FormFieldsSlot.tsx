/**
 * FormFieldsSlot — the `form` step's fields editor: add/reorder/remove field
 * rows, an options list editor for choice/multi fields, and a `when` builder
 * (key-equals-value over the OTHER fields in this form). Every edit writes
 * the whole `form.fields` array through one `onPatch({ form: { ...step.form,
 * fields } })` call — see step-descriptors.ts (the `form.fields` descriptor).
 */
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WfCustomSlotProps } from './descriptor-types';
import type { WfField, WfFieldType } from '../wf-draft-types';

const FIELD_TYPES: WfFieldType[] = ['text', 'number', 'choice', 'multi', 'textarea'];

function nextFieldKey(existing: string[]): string {
  let n = 1;
  while (existing.includes(`field-${n}`)) n++;
  return `field-${n}`;
}

interface OptionsEditorProps {
  testId: string;
  options: string[];
  onChange: (next: string[]) => void;
}

function OptionsEditor({ testId, options, onChange }: OptionsEditorProps): React.ReactElement {
  return (
    <div className="space-y-[6px] pl-[16px]">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-[6px]">
          <Input
            data-testid={`${testId}-option-${i}`}
            value={opt}
            onChange={(e) => onChange(options.map((o, idx) => (idx === i ? e.target.value : o)))}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove option"
            data-testid={`${testId}-option-${i}-remove`}
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            <X size={13} aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`${testId}-option-add`}
        onClick={() => onChange([...options, ''])}
      >
        + Add option
      </Button>
    </div>
  );
}

interface WhenBuilderProps {
  testId: string;
  when: { key: string; equals: string } | undefined;
  otherKeys: string[];
  onChange: (next: { key: string; equals: string }) => void;
}

function WhenBuilder({ testId, when, otherKeys, onChange }: WhenBuilderProps): React.ReactElement | null {
  if (otherKeys.length === 0) return null;
  return (
    <div className="flex items-center gap-[6px] pl-[16px]">
      <Select value={when?.key} onValueChange={(key) => onChange({ key, equals: when?.equals ?? '' })}>
        <SelectTrigger data-testid={`${testId}-when-key`}>
          <SelectValue placeholder="when field…" />
        </SelectTrigger>
        <SelectContent>
          {otherKeys.map((k) => (
            <SelectItem key={k} value={k} data-testid={`${testId}-when-key-option-${k}`}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        data-testid={`${testId}-when-equals`}
        value={when?.equals ?? ''}
        placeholder="equals"
        onChange={(e) => onChange({ key: when?.key ?? '', equals: e.target.value })}
        className="flex-1"
      />
    </div>
  );
}

interface FieldRowProps {
  field: WfField;
  index: number;
  total: number;
  testId: string;
  otherKeys: string[];
  onPatch: (patch: Partial<WfField>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function FieldRow({
  field,
  index,
  total,
  testId,
  otherKeys,
  onPatch,
  onMove,
  onRemove,
}: FieldRowProps): React.ReactElement {
  const showOptions = field.type === 'choice' || field.type === 'multi';
  return (
    <div className="space-y-[6px] rounded-md border-[0.5px] border-border p-[8px]">
      <div className="flex items-center gap-[6px]">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Move up"
          disabled={index === 0}
          data-testid={`${testId}-move-up`}
          onClick={() => onMove(-1)}
        >
          <ChevronUp size={13} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Move down"
          disabled={index === total - 1}
          data-testid={`${testId}-move-down`}
          onClick={() => onMove(1)}
        >
          <ChevronDown size={13} aria-hidden />
        </Button>
        <Input
          data-testid={`${testId}-key`}
          value={field.key}
          placeholder="key"
          onChange={(e) => onPatch({ key: e.target.value })}
          className="flex-1"
        />
        <Select value={field.type} onValueChange={(type) => onPatch({ type: type as WfFieldType })}>
          <SelectTrigger data-testid={`${testId}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t} data-testid={`${testId}-type-option-${t}`}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Remove field"
          data-testid={`${testId}-remove`}
          onClick={onRemove}
        >
          <X size={13} aria-hidden />
        </Button>
      </div>

      <div className="flex items-center gap-[6px]">
        <Input
          data-testid={`${testId}-label`}
          value={field.label ?? ''}
          placeholder="label"
          onChange={(e) => onPatch({ label: e.target.value })}
          className="flex-1"
        />
        <div className="flex items-center gap-2">
          <Label className="text-body text-foreground">Required</Label>
          <Switch
            data-testid={`${testId}-required`}
            checked={field.required === true}
            onCheckedChange={(checked) => onPatch({ required: checked })}
          />
        </div>
      </div>

      {showOptions && (
        <OptionsEditor testId={testId} options={field.options ?? []} onChange={(options) => onPatch({ options })} />
      )}

      <WhenBuilder testId={testId} when={field.when} otherKeys={otherKeys} onChange={(when) => onPatch({ when })} />
    </div>
  );
}

export function FormFieldsSlot({ step, onPatch }: WfCustomSlotProps): React.ReactElement | null {
  if (step.kind !== 'form') return null;
  const form = step.form;
  const fields = form.fields;

  function patchFields(next: WfField[]): void {
    onPatch({ form: { ...form, fields: next } });
  }

  function moveField(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target]!, next[index]!];
    patchFields(next);
  }

  return (
    <div className="space-y-[8px]">
      {fields.map((field, i) => (
        <FieldRow
          key={field.key}
          field={field}
          index={i}
          total={fields.length}
          testId={`workflows-config-${step.id}-field-${field.key}`}
          otherKeys={fields.filter((f) => f.key !== field.key).map((f) => f.key)}
          onPatch={(patch) => patchFields(fields.map((f) => (f.key === field.key ? { ...f, ...patch } : f)))}
          onMove={(direction) => moveField(i, direction)}
          onRemove={() => patchFields(fields.filter((f) => f.key !== field.key))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`workflows-config-${step.id}-field-add`}
        onClick={() => patchFields([...fields, { key: nextFieldKey(fields.map((f) => f.key)), type: 'text' }])}
      >
        + Add field
      </Button>
    </div>
  );
}
