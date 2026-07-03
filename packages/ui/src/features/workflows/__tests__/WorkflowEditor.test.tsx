/**
 * WorkflowEditor — editor shell + YAML pane with server validation and save.
 *
 * TDD: tests written first, implementation after.
 * Covers:
 * - typing YAML triggers validateYaml (via fake timers to flush debounce)
 * - invalid YAML disables the Save button and lists errors
 * - Save calls putWorkflow and closes the editor
 * - edit mode loads YAML via getWorkflowSource
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { WorkflowSummary } from '@qlan-ro/mainframe-types';

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

import * as wfApi from '@/lib/api/workflows';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { WorkflowEditor } from '@/features/workflows/editor/WorkflowEditor';
import type { WfEditorTarget } from '@/features/workflows/use-workflows-modal';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_YAML = `version: 1
name: greet
steps:
  - id: say
    set:
      msg: "hi"
`;

const INVALID_YAML = `version: 1
steps:
  - id: bad
    set:
      v: "\${ ghost.output }"
`;

const MOCK_SUMMARY: WorkflowSummary = {
  id: 'global:greet',
  name: 'greet',
  description: undefined,
  projectId: null,
  filePath: '/tmp/greet.yml',
  triggers: [],
};

const PORT = 31415;

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderEditor(target: WfEditorTarget) {
  return render(<WorkflowEditor port={PORT} target={target} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkflowEditor', () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the editor shell with Cancel and Create buttons (new mode)', () => {
    renderEditor({ mode: 'new' });
    expect(screen.getByTestId('workflows-editor')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-editor-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-editor-save')).toBeInTheDocument();
    expect(screen.getByText('New workflow')).toBeInTheDocument();
  });

  it('renders Edit workflow title in edit mode', async () => {
    renderEditor({ mode: 'edit', workflowId: 'global:greet' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByText('Edit workflow')).toBeInTheDocument();
  });

  it('typing YAML triggers validateYaml after debounce', async () => {
    renderEditor({ mode: 'new' });
    const textarea = screen.getByTestId('workflows-editor-yaml');
    fireEvent.change(textarea, { target: { value: VALID_YAML } });
    // Before debounce fires
    expect(wfApi.validateYaml).not.toHaveBeenCalled();
    // Advance timers by 500ms (debounce is ~400ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(wfApi.validateYaml).toHaveBeenCalledWith(PORT, VALID_YAML);
  });

  it('invalid YAML disables Save and shows errors', async () => {
    vi.mocked(wfApi.validateYaml).mockResolvedValue({
      valid: false,
      errors: [{ message: 'step references "ghost" which is not in scope' }],
    });
    renderEditor({ mode: 'new' });
    const textarea = screen.getByTestId('workflows-editor-yaml');
    fireEvent.change(textarea, { target: { value: INVALID_YAML } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByTestId('workflows-editor-save')).toBeDisabled();
    expect(screen.getAllByText(/ghost/).length).toBeGreaterThan(0);
  });

  it('Save button calls putWorkflow and closes the editor', async () => {
    vi.mocked(wfApi.validateYaml).mockResolvedValue({ valid: true, errors: [] });
    renderEditor({ mode: 'new' });
    const textarea = screen.getByTestId('workflows-editor-yaml');
    fireEvent.change(textarea, { target: { value: VALID_YAML } });
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
    expect(wfApi.putWorkflow).toHaveBeenCalledWith(PORT, expect.stringContaining('greet'), VALID_YAML);
    expect(useWorkflowsModal.getState().editorTarget).toBeNull();
  });

  it('a validateYaml failure surfaces an inline destructive error instead of hanging on "Validating…"', async () => {
    vi.mocked(wfApi.validateYaml).mockRejectedValue(new Error('Unrecognized key: "scope"'));
    renderEditor({ mode: 'new' });
    const textarea = screen.getByTestId('workflows-editor-yaml');
    fireEvent.change(textarea, { target: { value: VALID_YAML } });
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

  it('mode toggle buttons render for builder/split/yaml', () => {
    renderEditor({ mode: 'new' });
    expect(screen.getByTestId('workflows-editor-mode-builder')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-editor-mode-split')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-editor-mode-yaml')).toBeInTheDocument();
  });

  it('Cancel calls closeEditor', () => {
    renderEditor({ mode: 'new' });
    fireEvent.click(screen.getByTestId('workflows-editor-cancel'));
    expect(useWorkflowsModal.getState().editorTarget).toBeNull();
  });
});
