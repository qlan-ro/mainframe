/**
 * AutomationEditor — shell: name, WhenCard, Recipe, footer summary, Save
 * (ts153 wf2-editor.jsx `WfEditor`). Reads/writes `use-automations-nav` +
 * `use-automations-store` directly (mirrors `LibraryRow`'s pattern), so
 * tests drive it through those stores rather than props. `useMemo(validate)`
 * is exercised indirectly via the footer's error count and the Save
 * button's disabled state. TDD: test written first, implemented after.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationSummary } from '../../contract';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { AutomationEditor } from '../AutomationEditor';

function resetStores() {
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  useAutomationsStore.setState({ definitions: [], catalog: [] });
}

afterEach(() => {
  resetStores();
});

const EXISTING: AutomationSummary = {
  id: 'auto-1',
  name: 'Daily standup',
  description: 'Posts a summary every morning.',
  scope: 'project',
  projectId: null,
  enabled: true,
  definition: { triggers: [], steps: [{ id: 's1', kind: 'notify', message: ['hi'] }] },
  createdAt: 0,
  updatedAt: 0,
};

describe('AutomationEditor — new automation', () => {
  it('starts with an empty name and the Create action, disabled (no name, no steps)', () => {
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-editor-name')).toHaveValue('');
    const save = screen.getByTestId('automations-editor-save');
    expect(save).toHaveTextContent('Create');
    expect(save).toBeDisabled();
  });

  it('enables Save once a name and a step exist', async () => {
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await user.type(screen.getByTestId('automations-editor-name'), 'My automation');
    await user.click(screen.getByTestId('automations-recipe-root-add'));
    await user.click(screen.getByTestId('automations-recipe-root-add-verb-notify'));
    expect(screen.getByTestId('automations-editor-save')).toBeEnabled();
  });

  it("pre-fills from editorTarget.draft when present (Describe-it's Open in editor)", () => {
    useAutomationsNav.setState({
      editorTarget: {
        mode: 'new',
        draft: {
          name: 'Daily health log',
          description: 'Evening check-in',
          scope: 'global',
          definition: { triggers: [], steps: [{ id: 'q', kind: 'ask_me', title: 'Check-in', fields: [] }] },
        },
      },
    });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-editor-name')).toHaveValue('Daily health log');
    expect(screen.getByTestId('automations-editor-description')).toHaveValue('Evening check-in');
    expect(screen.getByTestId('automations-editor-scope-global')).toHaveClass('bg-card');
    expect(screen.getByTestId('automations-step-q')).toBeInTheDocument();
  });
});

describe('AutomationEditor — edit existing', () => {
  it("loads the existing automation's name into the field", () => {
    useAutomationsStore.setState({ definitions: [EXISTING] });
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: 'auto-1' } });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-editor-name')).toHaveValue('Daily standup');
    expect(screen.getByTestId('automations-editor-save')).toHaveTextContent('Save');
  });

  it('renders the existing step in the recipe', () => {
    useAutomationsStore.setState({ definitions: [EXISTING] });
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: 'auto-1' } });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-step-s1')).toBeInTheDocument();
  });
});

describe('AutomationEditor — footer validation summary', () => {
  it('shows the outstanding issue count when invalid', () => {
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.getByText(/to fix/)).toBeInTheDocument();
  });

  it('shows "Looks good" once every issue is resolved', async () => {
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await user.type(screen.getByTestId('automations-editor-name'), 'My automation');
    await user.click(screen.getByTestId('automations-recipe-root-add'));
    await user.click(screen.getByTestId('automations-recipe-root-add-verb-notify'));
    expect(screen.getByText(/Looks good/)).toBeInTheDocument();
  });

  it('appends "ready to create" for a new automation once valid', async () => {
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await user.type(screen.getByTestId('automations-editor-name'), 'My automation');
    await user.click(screen.getByTestId('automations-recipe-root-add'));
    await user.click(screen.getByTestId('automations-recipe-root-add-verb-notify'));
    expect(screen.getByText('Looks good · ready to create')).toBeInTheDocument();
  });

  it('appends "ready to save" once valid when editing an existing automation', () => {
    useAutomationsStore.setState({ definitions: [EXISTING] });
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: EXISTING.id } });
    render(<AutomationEditor />);
    expect(screen.getByText('Looks good · ready to save')).toBeInTheDocument();
  });
});

describe('AutomationEditor — cancel/back', () => {
  it('clicking Cancel closes the editor', async () => {
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await user.click(screen.getByTestId('automations-editor-cancel'));
    expect(useAutomationsNav.getState().editorTarget).toBeNull();
  });
});
