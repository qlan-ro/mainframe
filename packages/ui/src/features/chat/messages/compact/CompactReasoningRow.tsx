import type { ReactNode } from 'react';
import type { ToolCallTiming } from '@assistant-ui/react';
import { BrainIcon } from 'lucide-react';
import { CompactDisclosure } from './CompactDisclosure';
import { CompactElapsed } from './CompactElapsed';

export function CompactReasoningRow({
  memberKeys,
  running,
  phaseTiming,
  children,
}: {
  memberKeys: readonly string[];
  running: boolean;
  phaseTiming?: ToolCallTiming;
  children: ReactNode;
}) {
  return (
    <CompactDisclosure
      memberKeys={memberKeys}
      label={running ? 'Thinking' : 'Thought'}
      icon={<BrainIcon aria-hidden className="size-3.5 shrink-0" />}
      trailing={<CompactElapsed timing={phaseTiming} running={running} format="reasoning" />}
    >
      <div className="whitespace-pre-wrap text-sm text-muted-foreground">{children}</div>
    </CompactDisclosure>
  );
}
