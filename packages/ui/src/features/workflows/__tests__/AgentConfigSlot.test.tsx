/**
 * AgentConfigSlot — composer-picker reuse for the `agent` step's custom slot.
 *
 * No worktree control (Resolution 1): the form never renders or clears
 * `step.agent.worktree`; every patch must spread `...step.agent` so an
 * existing worktree value survives edits to any other field.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentConfigSlot } from '@/features/workflows/editor/config/AgentConfigSlot';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';
import type { WfCustomSlotProps } from '@/features/workflows/editor/config/descriptor-types';

function renderSlot(props: WfCustomSlotProps) {
  return render(
    <TooltipProvider>
      <AgentConfigSlot {...props} />
    </TooltipProvider>,
  );
}

vi.mock('@/store/adapters', () => ({
  useAdapters: () => [
    {
      id: 'claude',
      name: 'Claude',
      description: '',
      installed: true,
      models: [{ id: 'sonnet', label: 'Sonnet' }],
      capabilities: { planMode: true },
    },
  ],
}));

vi.mock('@/features/chat/composer/config-toolbar/synthesize-draft-chat', () => ({
  synthesizeDraftChat: (id: string, cfg: Record<string, unknown>) => ({
    id,
    adapterId: cfg.adapterId,
    model: cfg.model,
    permissionMode: cfg.permissionMode ?? 'default',
    status: 'active',
  }),
}));

describe('AgentConfigSlot', () => {
  it('renders no worktree control', () => {
    const step: WfStep = { id: 'work', kind: 'agent', agent: { prompt: 'hi' } };
    renderSlot({ step, onPatch: vi.fn(), scope: [] });
    expect(screen.queryByTestId('workflows-config-work-branch')).toBeNull();
  });

  it('preserves an existing worktree value when patching an unrelated field', () => {
    const step: WfStep = {
      id: 'work',
      kind: 'agent',
      agent: { prompt: 'hi', model: 'sonnet', worktree: { branchName: 'feat/x', baseBranch: 'main' } },
    };
    const onPatch = vi.fn();
    renderSlot({ step, onPatch, scope: [] });

    fireEvent.change(screen.getByTestId('workflows-config-work-timeout'), { target: { value: '15' } });

    expect(onPatch).toHaveBeenCalledWith({
      agent: expect.objectContaining({
        worktree: { branchName: 'feat/x', baseBranch: 'main' },
        timeoutMinutes: expect.any(Number),
      }),
    });
  });
});
