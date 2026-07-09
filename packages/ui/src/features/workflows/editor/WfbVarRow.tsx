/**
 * WfbVarRow — one editable row in the builder's Vars section: a key input,
 * a value input, and a remove button. Mirrors WfbOutputRow.tsx. `value` is
 * `unknown` per the DSL grammar (schema.ts's `vars` is `z.record(idSchema,
 * z.unknown())`), but the builder only offers a plain text edit — typing
 * always writes back a string, matching WfKvEditor's same simplification.
 */
import { X } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import type { WfVar } from './wf-draft-types';

interface WfbVarRowProps {
  wfVar: WfVar;
  onChange: (partial: Partial<WfVar>) => void;
  onRemove: () => void;
}

export function WfbVarRow({ wfVar, onChange, onRemove }: WfbVarRowProps): React.ReactElement {
  const stringValue = typeof wfVar.value === 'string' ? wfVar.value : String(wfVar.value ?? '');
  return (
    <div className="flex items-center gap-[8px]">
      <input
        type="text"
        value={wfVar.key}
        onChange={(e) => onChange({ key: e.target.value })}
        placeholder="key"
        className="w-[130px] shrink-0 rounded-md border border-border bg-mf-content2 px-[9px] py-[6px] font-mono text-caption text-foreground outline-none"
      />
      <span className="font-mono text-mf-text-4">:</span>
      <input
        type="text"
        value={stringValue}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="value"
        className="min-w-0 flex-1 rounded-md border border-border bg-mf-content2 px-[9px] py-[6px] font-mono text-caption text-mf-code-fn outline-none"
      />
      <Hint label="Remove var">
        <button
          type="button"
          aria-label="Remove var"
          onClick={onRemove}
          className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground"
        >
          <X size={12} aria-hidden />
        </button>
      </Hint>
    </div>
  );
}
