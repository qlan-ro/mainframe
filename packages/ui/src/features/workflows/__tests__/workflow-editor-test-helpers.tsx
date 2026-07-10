/**
 * Shared fixtures/setup for WorkflowEditor.test.tsx and WorkflowEditor.save.test.tsx
 * (split at 300 lines/file — see docs CLAUDE.md). Each test file still calls
 * `vi.mock(...)` itself: mock hoisting is per-file, so it can't be centralized here.
 */
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import type { WorkflowSummary } from '@qlan-ro/mainframe-types';
import * as wfApi from '@/lib/api/workflows';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { WorkflowEditor } from '@/features/workflows/editor/WorkflowEditor';
import type { WfEditorTarget } from '@/features/workflows/use-workflows-modal';

export const VALID_YAML = `version: 1
name: greet
steps:
  - id: say
    set:
      msg: "hi"
`;

export const MOCK_SUMMARY: WorkflowSummary = {
  id: 'global:greet',
  name: 'greet',
  description: undefined,
  projectId: null,
  filePath: '/tmp/greet.yml',
  triggers: [],
};

export const PORT = 31415;

export function renderEditor(target: WfEditorTarget) {
  return render(<WorkflowEditor port={PORT} target={target} />);
}

/** Common `beforeEach` body: resets fake timers, stores, and the shared API/identity mocks. */
export function resetWorkflowEditorMocks(mockUseActiveIdentity: ReturnType<typeof vi.fn>): void {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useWorkflowsModal.setState({ open: true, editorTarget: null, section: 'library', selectedRunId: null });
  useWorkflowsStore.setState({
    workflows: [],
    runs: [],
    runDetail: null,
    interactions: [],
    loading: false,
    error: null,
  });
  vi.mocked(wfApi.validateYaml).mockResolvedValue({ valid: true, errors: [] });
  vi.mocked(wfApi.putWorkflow).mockResolvedValue(MOCK_SUMMARY);
  vi.mocked(wfApi.getWorkflowSource).mockResolvedValue({ summary: MOCK_SUMMARY, yaml: VALID_YAML });
  // clearAllMocks doesn't undo a prior mockReturnValue — reset explicitly per test.
  mockUseActiveIdentity.mockReturnValue({ projectId: undefined });
}
