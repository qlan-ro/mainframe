/**
 * WfKvEditor — the `kv` record editor used by `WfFieldControl` for `with`/
 * `set` fields. Split out of WfFieldControl.tsx once Task 17's expr wiring
 * pushed that file over the 300-line ceiling.
 *
 * Each row's value column renders `WfExprInput` when the field is `expr`-
 * marked and `WF_EXPR_ENABLED`; the key column always stays a plain `Input`.
 */
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { WfExprInput } from './WfExprInput';
import { WF_EXPR_ENABLED } from './wf-expr-flag';
import type { WfScopeSource } from './wf-scope';

function nextKvKey(existing: string[]): string {
  let n = 1;
  while (existing.includes(`key-${n}`)) n++;
  return `key-${n}`;
}

export interface WfKvEditorProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  testId: string;
  expr?: true;
  scope: WfScopeSource[];
}

interface WfKvRowProps {
  rowKey: string;
  rowValue: unknown;
  testId: string;
  expr?: true;
  scope: WfScopeSource[];
  onReplace: (key: string, value: unknown) => void;
  onRemove: () => void;
}

function WfKvRow({ rowKey, rowValue, testId, expr, scope, onReplace, onRemove }: WfKvRowProps): React.ReactElement {
  const stringValue = typeof rowValue === 'string' ? rowValue : String(rowValue ?? '');
  return (
    <div className="flex items-center gap-[6px]">
      <Input
        data-testid={`${testId}-key`}
        value={rowKey}
        placeholder="key"
        onChange={(e) => onReplace(e.target.value, rowValue)}
        className="flex-1"
      />
      <div className="flex-1">
        {expr && WF_EXPR_ENABLED ? (
          <WfExprInput
            value={stringValue}
            onChange={(v) => onReplace(rowKey, v)}
            scope={scope}
            testId={`${testId}-value`}
          />
        ) : (
          <Input
            data-testid={`${testId}-value`}
            value={stringValue}
            placeholder="value"
            onChange={(e) => onReplace(rowKey, e.target.value)}
          />
        )}
      </div>
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

export function WfKvEditor({ value, onChange, testId, expr, scope }: WfKvEditorProps): React.ReactElement {
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
          expr={expr}
          scope={scope}
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
