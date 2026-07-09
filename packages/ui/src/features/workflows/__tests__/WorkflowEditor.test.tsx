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

  it('renders a hydration banner for a schema-invalid workflow file, not the panes', async () => {
    vi.mocked(wfApi.getWorkflowSource).mockResolvedValue({ summary: MOCK_SUMMARY, yaml: 'not: [valid' });
    renderEditor({ mode: 'edit', workflowId: 'global:greet' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId('workflows-hydration-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-editor-yaml')).not.toBeInTheDocument();
  });

  it('renders a Convert button for a comments-only file and hydrates the model on click', async () => {
    const COMMENTED_YAML = `version: 1
name: greet
steps:
  - id: say
    set:
      msg: "hi" # note
`;
    vi.mocked(wfApi.getWorkflowSource).mockResolvedValue({ summary: MOCK_SUMMARY, yaml: COMMENTED_YAML });
    renderEditor({ mode: 'edit', workflowId: 'global:greet' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const convertBtn = screen.getByTestId('workflows-hydration-banner-convert');
    await act(async () => {
      fireEvent.click(convertBtn);
    });
    expect(screen.queryByTestId('workflows-hydration-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('workflows-editor-yaml').textContent).toContain('name: greet');
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

  it('renders both the builder and the read-only YAML preview at once, with no mode toggle', () => {
    renderEditor({ mode: 'new' });
    expect(screen.getByTestId('workflows-builder')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-editor-yaml')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-editor-mode-builder')).not.toBeInTheDocument();
  });

  it('opening an edit target hydrates the builder, dropping the "new workflows only" placeholder', async () => {
    renderEditor({ mode: 'edit', workflowId: 'global:greet' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTestId('workflows-builder')).toBeInTheDocument();
    expect(screen.queryByText(/available for new workflows/i)).not.toBeInTheDocument();
  });

  it('a builder mutation in edit mode updates the read-only YAML preview live', async () => {
    renderEditor({ mode: 'edit', workflowId: 'global:greet' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.change(screen.getByTestId('workflows-builder-name'), { target: { value: 'renamed' } });
    expect(screen.getByTestId('workflows-editor-yaml').textContent).toContain('name: renamed');
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

  it('Cancel calls closeEditor', () => {
    renderEditor({ mode: 'new' });
    fireEvent.click(screen.getByTestId('workflows-editor-cancel'));
    expect(useWorkflowsModal.getState().editorTarget).toBeNull();
  });

  it('new-mode YAML pane is initialized from the blank draft on first open, not empty', () => {
    renderEditor({ mode: 'new' });
    const preview = screen.getByTestId('workflows-editor-yaml');
    expect(preview.textContent).not.toBe('');
    expect(preview.textContent).toContain('name: untitled');
    expect(preview.textContent).toContain('steps:');
  });

  it('new-mode schedules validation for the initial YAML without requiring a user edit first', async () => {
    renderEditor({ mode: 'new' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(wfApi.validateYaml).toHaveBeenCalledWith(PORT, expect.stringContaining('name: untitled'));
  });
});
