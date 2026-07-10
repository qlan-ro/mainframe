/**
 * WorkflowEditor — shell, hydration, and builder/YAML-pane mode.
 *
 * Save/validate/error-mapping behavior lives in WorkflowEditor.save.test.tsx
 * (split at 300 lines/file — see docs CLAUDE.md); both share fixtures/setup
 * from workflow-editor-test-helpers.tsx.
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
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { renderEditor, resetWorkflowEditorMocks, MOCK_SUMMARY, PORT } from './workflow-editor-test-helpers';

describe('WorkflowEditor', () => {
  beforeEach(() => {
    resetWorkflowEditorMocks(mockUseActiveIdentity);
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
