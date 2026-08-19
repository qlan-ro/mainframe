/**
 * ParallelBody — one Recipe per branch, add/remove affordances, and the
 * confirm gate on removing a branch that already holds steps (the one
 * destructive, no-undo click in this editor).
 */
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { requestConfirm } from '@/lib/confirm-bridge';
import type { AutomationStep, ParallelBlock } from '../../contract';
import { ParallelBody } from '../ParallelBody';

vi.mock('@/lib/confirm-bridge', () => ({ requestConfirm: vi.fn() }));

function agentStep(id: string): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [] };
}

function setup(branches: AutomationStep[][]) {
  const onChange = vi.fn();
  const initial: ParallelBlock = { id: 'split', kind: 'parallel', branches };
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <ParallelBody
        step={value}
        onChange={(patch) => {
          onChange(patch);
          setValue((v) => ({ ...v, ...patch }));
        }}
        tokens={[]}
        catalog={[]}
        issues={[]}
        depth={0}
      />
    );
  }
  render(<Host />);
  return { onChange };
}

describe('ParallelBody', () => {
  beforeEach(() => {
    vi.mocked(requestConfirm).mockReset();
  });

  it('renders one Recipe per branch', () => {
    setup([[], []]);
    expect(screen.getByTestId('automations-parallel-recipe-split-0')).toBeInTheDocument();
    expect(screen.getByTestId('automations-parallel-recipe-split-1')).toBeInTheDocument();
  });

  it('adds a fresh empty branch', async () => {
    const { onChange } = setup([[], []]);
    await userEvent.click(screen.getByTestId('automations-parallel-add-branch-split'));
    expect(onChange).toHaveBeenCalledWith({ branches: [[], [], []] });
  });

  it('hides the remove affordance at the two-branch minimum', () => {
    setup([[], []]);
    expect(screen.queryByTestId('automations-parallel-branch-remove-split-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automations-parallel-branch-remove-split-1')).not.toBeInTheDocument();
  });

  it('removes an empty branch without confirming', async () => {
    const { onChange } = setup([[], [], []]);
    await userEvent.click(screen.getByTestId('automations-parallel-branch-remove-split-2'));
    expect(requestConfirm).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ branches: [[], []] });
  });

  it('confirms before removing a branch that already holds steps', async () => {
    vi.mocked(requestConfirm).mockResolvedValue(true);
    const { onChange } = setup([[agentStep('a')], [], []]);
    await userEvent.click(screen.getByTestId('automations-parallel-branch-remove-split-0'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ branches: [[], []] }));
    expect(requestConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Remove this branch?', destructive: true }),
    );
  });

  it('keeps the branch when the confirmation is cancelled', async () => {
    vi.mocked(requestConfirm).mockResolvedValue(false);
    const { onChange } = setup([[agentStep('a')], [], []]);
    await userEvent.click(screen.getByTestId('automations-parallel-branch-remove-split-0'));
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });
});
