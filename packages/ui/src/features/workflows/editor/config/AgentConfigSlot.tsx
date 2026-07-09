/**
 * AgentConfigSlot — typed stub for the `agent` step's custom config slot.
 * Task 15 replaces this body in place (ProviderModelSelect + PermissionSelect
 * + prompt + timeoutMinutes) without touching step-descriptors.ts.
 */
import type { WfCustomSlotProps } from './descriptor-types';

export function AgentConfigSlot({ step }: WfCustomSlotProps): React.ReactElement {
  return (
    <div data-testid={`workflows-config-${step.id}-not-yet-implemented`} className="text-caption text-mf-text-3">
      Agent configuration — coming soon.
    </div>
  );
}
