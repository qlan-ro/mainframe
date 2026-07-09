/**
 * FormFieldsSlot — typed stub for the `form` step's fields custom slot.
 * Task 16 replaces this body in place (add/reorder/remove field rows) without
 * touching step-descriptors.ts.
 */
import type { WfCustomSlotProps } from './descriptor-types';

export function FormFieldsSlot({ step }: WfCustomSlotProps): React.ReactElement {
  return (
    <div data-testid={`workflows-config-${step.id}-not-yet-implemented`} className="text-caption text-mf-text-3">
      Form fields — coming soon.
    </div>
  );
}
