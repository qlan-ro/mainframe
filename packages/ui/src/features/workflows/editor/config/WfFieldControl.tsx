/**
 * WfFieldControl — renders one `WfFieldDesc` to a shadcn control, wired
 * through `getByPath`/`setByPath` (Task 10) so every control patches the
 * whole step with only its own field changed, preserving every sibling.
 *
 * `expr`-marked `text`/`textarea`/`kv` fields are meant to render `WfExprInput`
 * (Task 17, magic-variable chips); until that lands, `WF_EXPR_ENABLED` gates
 * them to a plain `Input`/`Textarea` so this renderer is testable in isolation.
 *
 * Each control kind is its own small render function so the dispatcher stays
 * short; the `kv` record editor (`WfKvEditor`) is the one non-trivial
 * subcomponent, per the plan's "own small subcomponent in the same file".
 */
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { getByPath, setByPath } from './descriptor-types';
import type { WfFieldDesc, WfCustomSlotProps } from './descriptor-types';

export const WF_EXPR_ENABLED = false;

interface WfFieldControlProps extends WfCustomSlotProps {
  desc: WfFieldDesc;
}

export function lastPathSegment(key: string): string {
  const parts = key.split('.');
  return parts[parts.length - 1]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function FieldShell({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block space-y-1.5">
      <span className="text-label font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ── kv record editor ─────────────────────────────────────────────────────────

function nextKvKey(existing: string[]): string {
  let n = 1;
  while (existing.includes(`key-${n}`)) n++;
  return `key-${n}`;
}

interface WfKvEditorProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  testId: string;
}

interface WfKvRowProps {
  rowKey: string;
  rowValue: unknown;
  testId: string;
  onReplace: (key: string, value: unknown) => void;
  onRemove: () => void;
}

function WfKvRow({ rowKey, rowValue, testId, onReplace, onRemove }: WfKvRowProps): React.ReactElement {
  return (
    <div className="flex items-center gap-[6px]">
      <Input
        data-testid={`${testId}-key`}
        value={rowKey}
        placeholder="key"
        onChange={(e) => onReplace(e.target.value, rowValue)}
        className="flex-1"
      />
      <Input
        data-testid={`${testId}-value`}
        value={typeof rowValue === 'string' ? rowValue : String(rowValue ?? '')}
        placeholder="value"
        onChange={(e) => onReplace(rowKey, e.target.value)}
        className="flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Remove row"
        data-testid={`${testId}-remove`}
        onClick={onRemove}
      >
        <X size={13} aria-hidden />
      </Button>
    </div>
  );
}

function WfKvEditor({ value, onChange, testId }: WfKvEditorProps): React.ReactElement {
  const entries = Object.entries(value);

  function replaceEntry(i: number, key: string, val: unknown): void {
    const next: Record<string, unknown> = {};
    entries.forEach(([k, v], idx) => {
      next[idx === i ? key : k] = idx === i ? val : v;
    });
    onChange(next);
  }

  function removeRow(i: number): void {
    const next: Record<string, unknown> = {};
    entries.forEach(([k, v], idx) => {
      if (idx !== i) next[k] = v;
    });
    onChange(next);
  }

  return (
    <div data-testid={testId} className="space-y-[6px]">
      {entries.map(([k, v], i) => (
        <WfKvRow
          key={i}
          rowKey={k}
          rowValue={v}
          testId={`${testId}-row-${i}`}
          onReplace={(key, val) => replaceEntry(i, key, val)}
          onRemove={() => removeRow(i)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`${testId}-add`}
        onClick={() => onChange({ ...value, [nextKvKey(Object.keys(value))]: '' })}
      >
        + Add
      </Button>
    </div>
  );
}

// ── per-kind field renderers ──────────────────────────────────────────────────

interface FieldRenderProps {
  desc: Extract<WfFieldDesc, { kind: 'text' | 'textarea' | 'select' | 'toggle' | 'number' | 'kv' }>;
  testId: string;
  raw: unknown;
  patchValue: (value: unknown) => void;
}

function WfTextField({ desc, testId, raw, patchValue }: FieldRenderProps): React.ReactElement {
  return (
    <FieldShell label={desc.label}>
      <Input
        data-testid={testId}
        value={typeof raw === 'string' ? raw : ''}
        placeholder={'placeholder' in desc ? desc.placeholder : undefined}
        onChange={(e) => patchValue(e.target.value)}
      />
    </FieldShell>
  );
}

function WfTextareaField({ desc, testId, raw, patchValue }: FieldRenderProps): React.ReactElement {
  return (
    <FieldShell label={desc.label}>
      <Textarea
        data-testid={testId}
        value={typeof raw === 'string' ? raw : ''}
        placeholder={'placeholder' in desc ? desc.placeholder : undefined}
        onChange={(e) => patchValue(e.target.value)}
      />
    </FieldShell>
  );
}

function WfNumberField({ desc, testId, raw, patchValue }: FieldRenderProps): React.ReactElement {
  return (
    <FieldShell label={desc.label}>
      <Input
        type="number"
        data-testid={testId}
        value={typeof raw === 'number' ? raw : ''}
        onChange={(e) => {
          const parsed = e.target.value === '' ? undefined : Number(e.target.value);
          patchValue(parsed === undefined || Number.isNaN(parsed) ? undefined : parsed);
        }}
      />
    </FieldShell>
  );
}

function WfToggleField({ desc, testId, raw, patchValue }: FieldRenderProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-body text-foreground">{desc.label}</Label>
      <Switch data-testid={testId} checked={raw === true} onCheckedChange={(checked) => patchValue(checked)} />
    </div>
  );
}

function WfSelectField({ desc, testId, raw, patchValue }: FieldRenderProps): React.ReactElement {
  if (desc.kind !== 'select') throw new Error('WfSelectField requires a select descriptor');
  return (
    <FieldShell label={desc.label}>
      <Select value={typeof raw === 'string' ? raw : undefined} onValueChange={(v) => patchValue(v)}>
        <SelectTrigger data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {desc.options.map((o) => (
            <SelectItem key={o.value} value={o.value} data-testid={`${testId}-option-${o.value}`}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function WfKvField({ desc, testId, raw, patchValue }: FieldRenderProps): React.ReactElement {
  return (
    <FieldShell label={desc.label}>
      <WfKvEditor testId={testId} value={isRecord(raw) ? raw : {}} onChange={(next) => patchValue(next)} />
    </FieldShell>
  );
}

// ── dispatcher ────────────────────────────────────────────────────────────────

export function WfFieldControl({ desc, step, onPatch, scope }: WfFieldControlProps): React.ReactElement {
  const testId = `workflows-config-${step.id}-${lastPathSegment(desc.key)}`;

  if (desc.kind === 'custom') {
    const Slot = desc.component;
    return (
      <div data-testid={testId}>
        <Slot step={step} onPatch={onPatch} scope={scope} />
      </div>
    );
  }

  const raw = getByPath(step, desc.key);
  const patchValue = (value: unknown): void => onPatch(setByPath(step, desc.key, value));
  const props: FieldRenderProps = { desc, testId, raw, patchValue };

  switch (desc.kind) {
    case 'text':
      return <WfTextField {...props} />;
    case 'textarea':
      return <WfTextareaField {...props} />;
    case 'number':
      return <WfNumberField {...props} />;
    case 'toggle':
      return <WfToggleField {...props} />;
    case 'select':
      return <WfSelectField {...props} />;
    case 'kv':
      return <WfKvField {...props} />;
  }
}
