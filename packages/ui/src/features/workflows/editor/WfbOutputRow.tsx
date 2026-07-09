/**
 * WfbOutputRow — one editable row in the builder's Outputs section: a name
 * input, an expr input, and a remove button. Split out of WfBuilderPane.tsx
 * to keep that file under the 300-line limit.
 */
import { X } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import type { WfOutput } from './wf-draft-types';

interface WfbOutputRowProps {
  output: WfOutput;
  onChange: (partial: Partial<WfOutput>) => void;
  onRemove: () => void;
}

export function WfbOutputRow({ output, onChange, onRemove }: WfbOutputRowProps): React.ReactElement {
  return (
    <div className="flex items-center gap-[8px]">
      <input
        type="text"
        value={output.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="name"
        className="w-[130px] shrink-0 rounded-md border border-border bg-mf-content2 px-[9px] py-[6px] font-mono text-caption text-foreground outline-none"
      />
      <span className="font-mono text-mf-text-4">:</span>
      <input
        type="text"
        value={output.expr}
        onChange={(e) => onChange({ expr: e.target.value })}
        placeholder="${ step.output.field }"
        className="min-w-0 flex-1 rounded-md border border-border bg-mf-content2 px-[9px] py-[6px] font-mono text-caption text-mf-code-fn outline-none"
      />
      <Hint label="Remove output">
        <button
          type="button"
          aria-label="Remove output"
          onClick={onRemove}
          className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground"
        >
          <X size={12} aria-hidden />
        </button>
      </Hint>
    </div>
  );
}
