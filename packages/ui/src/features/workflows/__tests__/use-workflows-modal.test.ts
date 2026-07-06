import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
describe('useWorkflowsModal', () => {
  beforeEach(() =>
    useWorkflowsModal.setState({ open: false, section: 'needs', selectedRunId: null, editorTarget: null }),
  );
  it('openModal opens on a section; openRun sets the run; backToList clears it', () => {
    useWorkflowsModal.getState().openModal('runs');
    expect(useWorkflowsModal.getState().open).toBe(true);
    expect(useWorkflowsModal.getState().section).toBe('runs');
    useWorkflowsModal.getState().openRun('4471');
    expect(useWorkflowsModal.getState().selectedRunId).toBe('4471');
    useWorkflowsModal.getState().backToList();
    expect(useWorkflowsModal.getState().selectedRunId).toBeNull();
  });
});
