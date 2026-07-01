import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/lib/api/workflows', () => ({
  listWorkflows: vi
    .fn()
    .mockResolvedValue([{ id: 'g:a', name: 'a', projectId: null, filePath: 'a.yml', triggers: [] }]),
  listInteractions: vi.fn().mockResolvedValue([]),
  listRuns: vi.fn().mockResolvedValue([]),
}));
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';

describe('useWorkflowsStore', () => {
  beforeEach(() => useWorkflowsStore.setState({ workflows: [], runs: [], runDetail: null, interactions: [] }));
  it('loadAll populates workflows', async () => {
    await useWorkflowsStore.getState().loadAll(31415);
    expect(useWorkflowsStore.getState().workflows).toHaveLength(1);
  });
  it('patchRun replaces a run in the list and in runDetail', () => {
    useWorkflowsStore.setState({
      runs: [{ id: 'r1', status: 'running' } as never],
      runDetail: { run: { id: 'r1', status: 'running' } as never, tree: [] },
    });
    useWorkflowsStore.getState().patchRun({ id: 'r1', status: 'succeeded' } as never);
    expect(useWorkflowsStore.getState().runs[0]!.status).toBe('succeeded');
    expect(useWorkflowsStore.getState().runDetail!.run.status).toBe('succeeded');
  });
  it('addInteraction dedupes by id; resolveInteraction removes it', () => {
    const s = useWorkflowsStore.getState();
    s.addInteraction({ id: 'i1' } as never);
    s.addInteraction({ id: 'i1' } as never);
    expect(useWorkflowsStore.getState().interactions).toHaveLength(1);
    s.resolveInteraction('i1');
    expect(useWorkflowsStore.getState().interactions).toHaveLength(0);
  });
});
