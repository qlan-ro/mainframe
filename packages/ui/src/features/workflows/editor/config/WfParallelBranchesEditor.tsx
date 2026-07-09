/**
 * WfParallelBranchesEditor — custom config slot for the `parallel` step's
 * named branches. Renders one row per branch: a rename input (the object key
 * is the domain id here, unlike `choose` arms) and a remove button, plus an
 * "+ Add branch" affordance that inserts a fresh empty-array key. Branch step
 * lists render via Task 14's `WfStepList`.
 */
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { WfCustomSlotProps } from './descriptor-types';
import type { WfStep } from '../wf-draft-types';

function nextBranchName(existing: string[]): string {
  let n = existing.length + 1;
  while (existing.includes(`branch-${n}`)) n++;
  return `branch-${n}`;
}

export function WfParallelBranchesEditor({ step, onPatch }: WfCustomSlotProps): React.ReactElement | null {
  if (step.kind !== 'parallel') return null;
  const branches = step.branches;
  const entries = Object.entries(branches);

  function patchBranches(next: Record<string, WfStep[]>): void {
    onPatch({ branches: next });
  }

  function addBranch(): void {
    patchBranches({ ...branches, [nextBranchName(Object.keys(branches))]: [] });
  }

  function renameBranch(oldName: string, newName: string): void {
    const next: Record<string, WfStep[]> = {};
    for (const [name, steps] of entries) {
      next[name === oldName ? newName : name] = steps;
    }
    patchBranches(next);
  }

  function removeBranch(name: string): void {
    const next: Record<string, WfStep[]> = {};
    for (const [n, steps] of entries) {
      if (n !== name) next[n] = steps;
    }
    patchBranches(next);
  }

  return (
    <div className="space-y-[6px]">
      {entries.map(([name], i) => (
        <div key={i} className="flex items-center gap-[6px]">
          <Input
            data-testid={`workflows-config-${step.id}-branch-${name}-name`}
            value={name}
            onChange={(e) => renameBranch(name, e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove branch"
            data-testid={`workflows-config-${step.id}-branch-${name}-remove`}
            onClick={() => removeBranch(name)}
          >
            <X size={13} aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`workflows-config-${step.id}-branch-add`}
        onClick={addBranch}
      >
        + Add branch
      </Button>
    </div>
  );
}
