import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfParallelBranchesEditor } from '@/features/workflows/editor/config/WfParallelBranchesEditor';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';

function parallelStep(): WfStep {
  return {
    id: 'pl1',
    kind: 'parallel',
    branches: {
      a: [{ id: 'a1', kind: 'agent', agent: { prompt: 'x' } }],
      b: [],
    },
  };
}

describe('WfParallelBranchesEditor', () => {
  it('adds a branch with an empty step list', () => {
    const onPatch = vi.fn();
    render(<WfParallelBranchesEditor step={parallelStep()} onPatch={onPatch} scope={[]} />);
    fireEvent.click(screen.getByTestId('workflows-config-pl1-branch-add'));
    const patch = onPatch.mock.calls[0]![0] as Partial<WfStep> & { branches: Record<string, WfStep[]> };
    expect(Object.keys(patch.branches)).toHaveLength(3);
    const newKey = Object.keys(patch.branches).find((k) => k !== 'a' && k !== 'b')!;
    expect(patch.branches[newKey]).toEqual([]);
  });

  it('renames a branch, carrying its steps over', () => {
    const onPatch = vi.fn();
    render(<WfParallelBranchesEditor step={parallelStep()} onPatch={onPatch} scope={[]} />);
    fireEvent.change(screen.getByTestId('workflows-config-pl1-branch-a-name'), { target: { value: 'renamed' } });
    const patch = onPatch.mock.calls[0]![0] as Partial<WfStep> & { branches: Record<string, WfStep[]> };
    expect(patch.branches.renamed).toEqual([{ id: 'a1', kind: 'agent', agent: { prompt: 'x' } }]);
    expect(patch.branches.a).toBeUndefined();
    expect(patch.branches.b).toEqual([]);
  });

  it('removes a branch', () => {
    const onPatch = vi.fn();
    render(<WfParallelBranchesEditor step={parallelStep()} onPatch={onPatch} scope={[]} />);
    fireEvent.click(screen.getByTestId('workflows-config-pl1-branch-a-remove'));
    const patch = onPatch.mock.calls[0]![0] as Partial<WfStep> & { branches: Record<string, WfStep[]> };
    expect(patch.branches.a).toBeUndefined();
    expect(patch.branches.b).toEqual([]);
    expect(Object.keys(patch.branches)).toHaveLength(1);
  });
});
