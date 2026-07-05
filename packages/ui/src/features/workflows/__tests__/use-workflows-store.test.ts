import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/lib/api/workflows', () => ({
  listWorkflows: vi
    .fn()
    .mockResolvedValue([{ id: 'g:a', name: 'a', projectId: null, filePath: 'a.yml', triggers: [] }]),
  listInteractions: vi.fn().mockResolvedValue([]),
  listRuns: vi.fn().mockResolvedValue([]),
  getRun: vi.fn(),
}));
import * as wfApi from '@/lib/api/workflows';
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
  it('selectRun also patches the matching entry in the runs list, so WfRunsList/WfLibrary stay live without a manual reopen', async () => {
    useWorkflowsStore.setState({
      runs: [{ id: 'r1', status: 'running' } as never],
      runDetail: null,
    });
    vi.mocked(wfApi.getRun).mockResolvedValue({ run: { id: 'r1', status: 'succeeded' } as never, tree: [] });

    await useWorkflowsStore.getState().selectRun(31415, 'r1');

    expect(useWorkflowsStore.getState().runDetail!.run.status).toBe('succeeded');
    expect(useWorkflowsStore.getState().runs[0]!.status).toBe('succeeded');
  });

  it('selectRun inserts the run into the runs list if it was not loaded yet', async () => {
    useWorkflowsStore.setState({ runs: [], runDetail: null });
    vi.mocked(wfApi.getRun).mockResolvedValue({ run: { id: 'r2', status: 'waiting' } as never, tree: [] });

    await useWorkflowsStore.getState().selectRun(31415, 'r2');

    expect(useWorkflowsStore.getState().runs).toHaveLength(1);
    expect(useWorkflowsStore.getState().runs[0]!.id).toBe('r2');
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
