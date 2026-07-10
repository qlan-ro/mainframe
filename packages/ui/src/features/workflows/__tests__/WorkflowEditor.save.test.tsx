/**
 * WorkflowEditor — validate/save and validate-error-to-step-row mapping.
 *
 * Shell/hydration/mode behavior lives in WorkflowEditor.test.tsx (split at
 * 300 lines/file — see docs CLAUDE.md); both share fixtures/setup from
 * workflow-editor-test-helpers.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────────
// Use vi.fn() inline inside the factory (no top-level const refs — vi.mock is hoisted).

vi.mock('@/lib/api/workflows', () => ({
  validateYaml: vi.fn(),
  putWorkflow: vi.fn(),
  getWorkflowSource: vi.fn(),
  listWorkflows: vi.fn().mockResolvedValue([]),
  listInteractions: vi.fn().mockResolvedValue([]),
  listRuns: vi.fn().mockResolvedValue([]),
}));

// deriveWorkflowId's 'project' scope resolves the active session's project id
// via useActiveIdentity (see wf-slug.ts) — mock it so tests can control it
// without an AssistantRuntimeProvider wrapper.
const { mockUseActiveIdentity } = vi.hoisted(() => ({
  mockUseActiveIdentity: vi.fn(() => ({ projectId: undefined as string | undefined })),
}));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: mockUseActiveIdentity,
}));

// Use a factory with no outer-scope vars so hoisting works correctly.
vi.mock('@/lib/toast', () => {
  const errorFn = vi.fn();
  return {
    mfToast: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: errorFn,
      warning: vi.fn(),
      info: vi.fn(),
    }),
  };
});

import * as wfApi from '@/lib/api/workflows';
import { mfToast } from '@/lib/toast';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { renderEditor, resetWorkflowEditorMocks, MOCK_SUMMARY, PORT } from './workflow-editor-test-helpers';

describe('WorkflowEditor save/validate', () => {
  beforeEach(() => {
    resetWorkflowEditorMocks(mockUseActiveIdentity);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('editing the builder triggers validateYaml after debounce', async () => {
    renderEditor({ mode: 'new' });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'greet' } });
    // Before debounce fires
    expect(wfApi.validateYaml).not.toHaveBeenCalled();
    // Advance timers by 500ms (debounce is ~400ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(wfApi.validateYaml).toHaveBeenCalledWith(PORT, expect.stringContaining('name: greet'));
  });

  it('invalid YAML disables Save and shows errors', async () => {
    vi.mocked(wfApi.validateYaml).mockResolvedValue({
      valid: false,
      errors: [{ message: 'step references "ghost" which is not in scope' }],
    });
    renderEditor({ mode: 'new' });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'bad' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByTestId('workflows-editor-save')).toBeDisabled();
    expect(screen.getAllByText(/ghost/).length).toBeGreaterThan(0);
  });

  it('Save button calls putWorkflow and closes the editor', async () => {
    vi.mocked(wfApi.validateYaml).mockResolvedValue({ valid: true, errors: [] });
    renderEditor({ mode: 'new' });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'greet' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const saveBtn = screen.getByTestId('workflows-editor-save');
    expect(saveBtn).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(wfApi.putWorkflow).toHaveBeenCalledWith(
      PORT,
      expect.stringContaining('greet'),
      expect.stringContaining('name: greet'),
    );
    expect(useWorkflowsModal.getState().editorTarget).toBeNull();
  });

  it('a validateYaml failure surfaces an inline destructive error instead of hanging on "Validating…"', async () => {
    vi.mocked(wfApi.validateYaml).mockRejectedValue(new Error('Unrecognized key: "scope"'));
    renderEditor({ mode: 'new' });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'greet' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByTestId('workflows-editor-validation-error')).toHaveTextContent('Unrecognized key: "scope"');
    expect(screen.getByTestId('workflows-editor-save')).toBeDisabled();
  });

  it('a project-scoped draft derives its id from the active session project', async () => {
    mockUseActiveIdentity.mockReturnValue({ projectId: 'proj-abc' });
    renderEditor({ mode: 'new' });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'My Automation' } });
    fireEvent.click(screen.getByTestId('workflows-builder-scope-project'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const saveBtn = screen.getByTestId('workflows-editor-save');
    expect(saveBtn).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(wfApi.putWorkflow).toHaveBeenCalledWith(PORT, 'proj-abc:my-automation', expect.any(String));
  });

  it('a global-scoped draft always uses the global: prefix even with an active project', async () => {
    mockUseActiveIdentity.mockReturnValue({ projectId: 'proj-abc' });
    renderEditor({ mode: 'new' });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'My Automation' } });
    fireEvent.click(screen.getByTestId('workflows-builder-scope-global'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('workflows-editor-save'));
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(wfApi.putWorkflow).toHaveBeenCalledWith(PORT, 'global:my-automation', expect.any(String));
  });

  it('maps a primary index-path validate error to the nested step it addresses, not by id substring', async () => {
    const NESTED_YAML = `version: 1
name: wf
steps:
  - id: first
    set:
      v: 1
  - id: route
    choose:
      - when: "true"
        steps:
          - id: gather
            set:
              v: 2
      - else: true
        steps: []
`;
    vi.mocked(wfApi.getWorkflowSource).mockResolvedValue({ summary: MOCK_SUMMARY, yaml: NESTED_YAML });
    vi.mocked(wfApi.validateYaml).mockRejectedValue(new Error('steps.1.choose.0.steps.0: must have exactly one kind'));
    renderEditor({ mode: 'edit', workflowId: 'global:wf' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.click(screen.getByTestId('workflows-builder-step-configure-route'));
    expect(screen.getByTestId('workflows-builder-step-error-gather')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-builder-step-error-first')).not.toBeInTheDocument();
  });

  it("falls back to the `step '<id>'` substring when no index path is present", async () => {
    vi.mocked(wfApi.validateYaml).mockResolvedValue({
      valid: false,
      errors: [{ message: `'x' is not in scope (step 'say')` }],
    });
    renderEditor({ mode: 'edit', workflowId: 'global:greet' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId('workflows-builder-step-error-say')).toBeInTheDocument();
  });

  it('shows a toast when a save failure message maps to no step at all', async () => {
    renderEditor({ mode: 'new' });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'greet' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.mocked(wfApi.putWorkflow).mockRejectedValue(new Error('Unrecognized key: "credential"'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('workflows-editor-save'));
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mfToast.error).toHaveBeenCalledWith('Workflow save failed', expect.anything());
  });
});
