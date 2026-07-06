import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let handler: (e: unknown) => void = () => {};
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: (e: unknown) => void) => {
      handler = h;
      return () => {};
    },
  },
}));
vi.mock('@/lib/api/workflows', () => ({
  getRun: vi.fn().mockResolvedValue({ run: { id: 'r1' }, tree: [] }),
}));

import { useWorkflowsEvents } from '@/features/workflows/use-workflows-events';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';

describe('useWorkflowsEvents', () => {
  it('patches a run on workflow.run.updated', () => {
    useWorkflowsStore.setState({ runs: [{ id: 'r1', status: 'running' } as never], interactions: [] });
    renderHook(() => useWorkflowsEvents(31415));
    handler({ type: 'workflow.run.updated', run: { id: 'r1', status: 'succeeded' } });
    expect(useWorkflowsStore.getState().runs[0]!.status).toBe('succeeded');
  });
  it('adds/removes interactions', () => {
    useWorkflowsStore.setState({ interactions: [] });
    renderHook(() => useWorkflowsEvents(31415));
    handler({ type: 'workflow.interaction.created', interaction: { id: 'i1' } });
    expect(useWorkflowsStore.getState().interactions).toHaveLength(1);
    handler({ type: 'workflow.interaction.resolved', interactionId: 'i1', runId: 'r1' });
    expect(useWorkflowsStore.getState().interactions).toHaveLength(0);
  });
});
