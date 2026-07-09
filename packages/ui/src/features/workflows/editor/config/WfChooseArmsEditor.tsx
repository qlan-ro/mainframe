/**
 * WfChooseArmsEditor — custom config slot for the `choose` step's arms.
 *
 * Renders one row per arm: a `when` expr input, an "Else" toggle on the last
 * arm (clears `when`, sets `else: true`), and a remove button, plus an
 * "+ Add arm" affordance. Arms have no domain id (WfArm), so rows are keyed
 * and addressed by array index — the same encoding `WfStepPath`'s `{ arm: k }`
 * selector uses (Task 9). Child steps render via Task 14's `WfStepList`.
 */
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { WfCustomSlotProps } from './descriptor-types';
import type { WfArm } from '../wf-draft-types';

export function WfChooseArmsEditor({ step, onPatch }: WfCustomSlotProps): React.ReactElement | null {
  if (step.kind !== 'choose') return null;
  const arms = step.arms;

  function patchArms(next: WfArm[]): void {
    onPatch({ arms: next });
  }

  function addArm(): void {
    const last = arms[arms.length - 1];
    const newArm: WfArm = { when: '', steps: [] };
    const next = last?.else ? [...arms.slice(0, -1), newArm, last] : [...arms, newArm];
    patchArms(next);
  }

  function setWhen(i: number, when: string): void {
    patchArms(arms.map((arm, idx) => (idx === i ? { steps: arm.steps, when } : arm)));
  }

  function removeArm(i: number): void {
    patchArms(arms.filter((_, idx) => idx !== i));
  }

  function toggleElse(i: number): void {
    patchArms(arms.map((arm, idx) => (idx === i ? { steps: arm.steps, else: true } : arm)));
  }

  return (
    <div className="space-y-[6px]">
      {arms.map((arm, i) => {
        const isLast = i === arms.length - 1;
        return (
          <div key={i} className="flex items-center gap-[6px]">
            {arm.else ? (
              <span className="flex-1 text-body text-muted-foreground">Else</span>
            ) : (
              <Input
                data-testid={`workflows-config-${step.id}-arm-${i}-when`}
                value={arm.when ?? ''}
                placeholder="condition"
                onChange={(e) => setWhen(i, e.target.value)}
                className="flex-1"
              />
            )}
            {!arm.else && isLast && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`workflows-config-${step.id}-arm-${i}-else-toggle`}
                onClick={() => toggleElse(i)}
              >
                Else
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove arm"
              data-testid={`workflows-config-${step.id}-arm-${i}-remove`}
              onClick={() => removeArm(i)}
            >
              <X size={13} aria-hidden />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`workflows-config-${step.id}-arm-add`}
        onClick={addArm}
      >
        + Add arm
      </Button>
    </div>
  );
}
