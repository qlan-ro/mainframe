/**
 * WfFieldControl — renders one `WfFieldDesc` to a shadcn control, wired
 * through `getByPath`/`setByPath` (Task 10) so every control patches the
 * whole step with only its own field changed, preserving every sibling.
 *
 * `expr`-marked `text`/`textarea`/`kv` fields render `WfExprInput` (Task 17,
 * magic-variable chips) behind the `WF_EXPR_ENABLED` flag. The `kv` record
 * editor lives in its own file (`WfKvEditor.tsx`) — Task 17's expr wiring
 * pushed it past the "same file" call from Task 12.
 */
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { WfExprInput } from './WfExprInput';
import { WfKvEditor } from './WfKvEditor';
import { getByPath, setByPath } from './descriptor-types';
import type { WfFieldDesc, WfCustomSlotProps } from './descriptor-types';
import type { WfScopeSource } from './wf-scope';
import { WF_EXPR_ENABLED } from './wf-expr-flag';

export { WF_EXPR_ENABLED } from './wf-expr-flag';

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

// ── per-kind field renderers ──────────────────────────────────────────────────

interface FieldRenderProps {
  desc: Extract<WfFieldDesc, { kind: 'text' | 'textarea' | 'select' | 'toggle' | 'number' | 'kv' }>;
  testId: string;
  raw: unknown;
  patchValue: (value: unknown) => void;
  scope: WfScopeSource[];
}

function WfTextField({ desc, testId, raw, patchValue, scope }: FieldRenderProps): React.ReactElement {
  const value = typeof raw === 'string' ? raw : '';
  if (desc.kind === 'text' && desc.expr && WF_EXPR_ENABLED) {
    return (
      <FieldShell label={desc.label}>
        <WfExprInput value={value} onChange={patchValue} scope={scope} testId={testId} />
      </FieldShell>
    );
  }
  return (
    <FieldShell label={desc.label}>
      <Input
        data-testid={testId}
        value={value}
        placeholder={'placeholder' in desc ? desc.placeholder : undefined}
        onChange={(e) => patchValue(e.target.value)}
      />
    </FieldShell>
  );
}

function WfTextareaField({ desc, testId, raw, patchValue, scope }: FieldRenderProps): React.ReactElement {
  const value = typeof raw === 'string' ? raw : '';
  if (desc.kind === 'textarea' && desc.expr && WF_EXPR_ENABLED) {
    return (
      <FieldShell label={desc.label}>
        <WfExprInput value={value} onChange={patchValue} scope={scope} multiline testId={testId} />
      </FieldShell>
    );
  }
  return (
    <FieldShell label={desc.label}>
      <Textarea
        data-testid={testId}
        value={value}
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

function WfKvField({ desc, testId, raw, patchValue, scope }: FieldRenderProps): React.ReactElement {
  if (desc.kind !== 'kv') throw new Error('WfKvField requires a kv descriptor');
  return (
    <FieldShell label={desc.label}>
      <WfKvEditor
        testId={testId}
        value={isRecord(raw) ? raw : {}}
        onChange={(next) => patchValue(next)}
        expr={desc.expr}
        scope={scope}
      />
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
  const props: FieldRenderProps = { desc, testId, raw, patchValue, scope };

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
