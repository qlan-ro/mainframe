/**
 * AutomationEditor — shell: name, WhenCard, Recipe, footer summary, Save
 * (ts153 wf2-editor.jsx `WfEditor`). Reads/writes `use-automations-nav` +
 * `use-automations-store` directly (mirrors `LibraryRow`'s pattern), so
 * tests drive it through those stores rather than props. `useMemo(validate)`
 * is exercised indirectly via the footer's error count and the Save
 * button's disabled state.
 *
 * Project scoping (todo #234 bullet 1): the scope toggle is gone — every
 * automation saves to `store.activeProjectId` (resolved upstream by
 * `AutomationsHost` via `useActiveIdentity`, fed into the store directly so
 * this test doesn't need the assistant-ui runtime provider).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationCreateInput, AutomationSummary } from '../../contract';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { AutomationEditor } from '../AutomationEditor';

function resetStores() {
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  useAutomationsStore.setState({ definitions: [], catalog: [], activeProjectId: null, gateway: fakeGateway() });
}

async function fillValidDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('automations-editor-name'), 'My automation');
  await user.click(screen.getByTestId('automations-recipe-root-add'));
  await user.click(screen.getByTestId('automations-recipe-root-add-verb-notify'));
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
    useAutomationsStore.setState({ activeProjectId: 'proj-1' });
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-editor-name')).toHaveValue('');
    const save = screen.getByTestId('automations-editor-save');
    expect(save).toHaveTextContent('Create');
    expect(save).toBeDisabled();
  });

  it('enables Save once a name, a step, and an active project all exist', async () => {
    const user = userEvent.setup();
    useAutomationsStore.setState({ activeProjectId: 'proj-1' });
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);
    expect(screen.getByTestId('automations-editor-save')).toBeEnabled();
  });

  it('keeps Save disabled with no active project, even once name and step are valid', async () => {
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);
    expect(screen.getByTestId('automations-editor-save')).toBeDisabled();
    expect(screen.getByText(/project/i)).toBeInTheDocument();
  });

  it('renders no scope toggle — scoping is resolved automatically, not chosen', () => {
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.queryByTestId('automations-editor-scope-project')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automations-editor-scope-global')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('automations-step-q')).toBeInTheDocument();
  });

  it('saving always sends scope "project" and the resolved active projectId, regardless of a draft\'s prior scope', async () => {
    const user = userEvent.setup();
    let sent: AutomationCreateInput | undefined;
    useAutomationsStore.setState({
      activeProjectId: 'proj-9',
      gateway: fakeGateway({
        createAutomation: async (input) => {
          sent = input;
          return { ...EXISTING, ...input, id: 'new-1', projectId: input.projectId ?? null };
        },
      }),
    });
    useAutomationsNav.setState({
      editorTarget: {
        mode: 'new',
        draft: { name: 'Draft', scope: 'global', definition: { triggers: [], steps: [] } },
      },
    });
    render(<AutomationEditor />);
    await user.click(screen.getByTestId('automations-recipe-root-add'));
    await user.click(screen.getByTestId('automations-recipe-root-add-verb-notify'));
    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({ scope: 'project', projectId: 'proj-9' });
  });

  it('stamps the resolved projectId onto every ask_agent step, not just the automation itself', async () => {
    const user = userEvent.setup();
    let sent: AutomationCreateInput | undefined;
    useAutomationsStore.setState({
      activeProjectId: 'proj-9',
      gateway: fakeGateway({
        createAutomation: async (input) => {
          sent = input;
          return { ...EXISTING, ...input, id: 'new-1', projectId: input.projectId ?? null };
        },
      }),
    });
    useAutomationsNav.setState({
      editorTarget: {
        mode: 'new',
        draft: {
          name: 'Draft',
          scope: 'project',
          definition: { triggers: [], steps: [{ id: 'a1', kind: 'ask_agent', prompt: ['hi'] }] },
        },
      },
    });
    render(<AutomationEditor />);
    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent?.definition.steps[0]).toMatchObject({ id: 'a1', kind: 'ask_agent', projectId: 'proj-9' });
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
    useAutomationsStore.setState({ activeProjectId: 'proj-1' });
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.getByText(/to fix/)).toBeInTheDocument();
  });

  it('shows "Looks good" once every issue is resolved', async () => {
    const user = userEvent.setup();
    useAutomationsStore.setState({ activeProjectId: 'proj-1' });
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);
    expect(screen.getByText(/Looks good/)).toBeInTheDocument();
  });

  it('appends "ready to create" for a new automation once valid', async () => {
    const user = userEvent.setup();
    useAutomationsStore.setState({ activeProjectId: 'proj-1' });
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);
    expect(screen.getByText('Looks good · ready to create')).toBeInTheDocument();
  });

  it('appends "ready to save" once valid when editing an existing automation', () => {
    useAutomationsStore.setState({ definitions: [EXISTING], activeProjectId: 'proj-1' });
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
