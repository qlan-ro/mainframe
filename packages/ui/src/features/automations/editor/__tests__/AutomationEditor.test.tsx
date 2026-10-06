/**
 * AutomationEditor — shell: name, project picker, WhenCard, Recipe, footer
 * summary, Save (ts153 wf2-editor.jsx `WfEditor`). Reads/writes
 * `use-automations-nav` + `use-automations-store` directly (mirrors
 * `LibraryRow`'s pattern), so tests drive it through those stores rather
 * than props.
 *
 * Project scoping (2026-10 redesign): the editor has its own picker now
 * (`AutomationProjectPicker`) — see that component's own tests for the
 * picker's visibility/default-selection/keyboard behavior in isolation.
 * These tests drive `useProjects` (mocked — it reaches the daemon port,
 * unavailable in a bare render) to put 1 or 2+ projects in scope and assert
 * the SAVE TARGET that results.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '@/lib/api/http';
import { useSessionFilters } from '@/store/session-filters';
import type { AutomationCreateInput, AutomationStep, AutomationSummary } from '../../contract';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { EMPTY_LIBRARY } from '../../data/library-cache';
import { AutomationEditor } from '../AutomationEditor';

vi.mock('@/features/sessions/use-projects', () => ({ useProjects: vi.fn() }));
import { useProjects } from '@/features/sessions/use-projects';

function mockProjects(projects: { id: string; name: string }[]) {
  vi.mocked(useProjects).mockReturnValue({
    projects: projects as never,
    loading: false,
    reloadProjects: vi.fn(),
    removeProjectFromList: vi.fn(),
  });
}

/** The editor resolves an edit target via `selectAutomationById`, which searches every loaded scope — 'all' is enough here. */
function setDefinitions(definitions: AutomationSummary[]) {
  useAutomationsStore.setState((s) => ({
    libraries: { ...s.libraries, all: { ...EMPTY_LIBRARY, ...s.libraries.all, definitions } },
  }));
}

function resetStores() {
  useAutomationsNav.setState({ editorTarget: null, detailsAutomationId: null, selectedRunId: null });
  useAutomationsStore.setState({ libraries: {}, catalog: [], scopeProjectId: null, gateway: fakeGateway() });
  useSessionFilters.setState({ filterProjectIds: new Set() });
  // The sole-project default (resolveDefaultProjectId) auto-selects this —
  // most tests don't care which project saving resolves to, just that the
  // editor doesn't block on "no project" by default.
  mockProjects([{ id: 'proj-1', name: 'Mainframe' }]);
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
    resetStores();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-editor-name')).toHaveValue('');
    const save = screen.getByTestId('automations-editor-save');
    expect(save).toHaveTextContent('Create');
    expect(save).toBeDisabled();
  });

  it('enables Save once a name and a step exist — the sole project auto-resolves, no picker needed', async () => {
    resetStores();
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.queryByTestId('automations-editor-project')).not.toBeInTheDocument();
    await fillValidDraft(user);
    expect(screen.getByTestId('automations-editor-save')).toBeEnabled();
  });

  it("pre-fills from editorTarget.draft when present (Describe-it's Open in editor)", () => {
    resetStores();
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

  it('saves with scope "project" and the auto-resolved sole project, regardless of a draft\'s prior scope', async () => {
    resetStores();
    const user = userEvent.setup();
    mockProjects([{ id: 'proj-9', name: 'Proj 9' }]);
    let sent: AutomationCreateInput | undefined;
    useAutomationsStore.setState({
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
    resetStores();
    const user = userEvent.setup();
    mockProjects([{ id: 'proj-9', name: 'Proj 9' }]);
    let sent: AutomationCreateInput | undefined;
    useAutomationsStore.setState({
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

describe('AutomationEditor — project picker (2026-10 redesign)', () => {
  it('picking a different project chip changes the save target', async () => {
    resetStores();
    mockProjects([
      { id: 'proj-1', name: 'Alpha' },
      { id: 'proj-2', name: 'Beta' },
    ]);
    const user = userEvent.setup();
    let sent: AutomationCreateInput | undefined;
    useAutomationsStore.setState({
      gateway: fakeGateway({
        createAutomation: async (input) => {
          sent = input;
          return { ...EXISTING, ...input, id: 'new-1', projectId: input.projectId ?? null };
        },
      }),
    });
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);

    await user.click(screen.getByTestId('automations-editor-project-proj-2'));
    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({ scope: 'project', projectId: 'proj-2' });
  });

  it('an unscoped ("All projects") automation with no ask_agent steps saves as global', async () => {
    resetStores();
    mockProjects([
      { id: 'proj-1', name: 'Alpha' },
      { id: 'proj-2', name: 'Beta' },
    ]);
    const user = userEvent.setup();
    let sent: AutomationCreateInput | undefined;
    useAutomationsStore.setState({
      gateway: fakeGateway({
        createAutomation: async (input) => {
          sent = input;
          return { ...EXISTING, ...input, id: 'new-1', projectId: input.projectId ?? null };
        },
      }),
    });
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);

    await user.click(screen.getByTestId('automations-editor-project-all'));
    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({ scope: 'global', projectId: null });
  });

  it('blocks Save with an explanatory issue when "All projects" is picked but the draft has an ask_agent step', async () => {
    resetStores();
    mockProjects([
      { id: 'proj-1', name: 'Alpha' },
      { id: 'proj-2', name: 'Beta' },
    ]);
    const user = userEvent.setup();
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

    await user.click(screen.getByTestId('automations-editor-project-all'));

    expect(screen.getByTestId('automations-editor-issues')).toHaveTextContent('An agent step needs a project');
    expect(screen.getByTestId('automations-editor-save')).toBeDisabled();
  });
});

describe('AutomationEditor — edit existing', () => {
  it("loads the existing automation's name into the field", () => {
    resetStores();
    setDefinitions([EXISTING]);
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: 'auto-1' } });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-editor-name')).toHaveValue('Daily standup');
    expect(screen.getByTestId('automations-editor-save')).toHaveTextContent('Save');
  });

  it('renders the existing step in the recipe', () => {
    resetStores();
    setDefinitions([EXISTING]);
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: 'auto-1' } });
    render(<AutomationEditor />);
    expect(screen.getByTestId('automations-step-s1')).toBeInTheDocument();
  });

  it("saving keeps sending the existing automation's own project unless the picker changes it", async () => {
    resetStores();
    mockProjects([
      { id: 'proj-9', name: 'Proj 9' },
      { id: 'proj-2', name: 'Beta' },
    ]);
    const scoped: AutomationSummary = { ...EXISTING, projectId: 'proj-9' };
    setDefinitions([scoped]);
    let sent: AutomationCreateInput | undefined;
    useAutomationsStore.setState({
      gateway: fakeGateway({
        updateAutomation: async (_id, input) => {
          sent = input;
          return { ...scoped, ...input, projectId: input.projectId ?? null };
        },
      }),
    });
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: 'auto-1' } });
    const user = userEvent.setup();
    render(<AutomationEditor />);

    expect(screen.getByTestId('automations-editor-project-proj-9')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({ projectId: 'proj-9' });
  });
});

describe('AutomationEditor — renaming a value rewrites the steps that use it', () => {
  function openEditor(message: string) {
    const withValue: AutomationSummary = {
      ...EXISTING,
      id: 'auto-2',
      definition: {
        triggers: [],
        steps: [
          { id: 'v1', kind: 'set_variable', name: 'headline', value: ['Release day'] },
          { id: 'n1', kind: 'notify', message: [message] },
        ],
      },
    };
    setDefinitions([withValue]);
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: withValue.id } });
    render(<AutomationEditor />);
  }

  async function rename(user: ReturnType<typeof userEvent.setup>, to: string) {
    await user.click(screen.getByTestId('automations-step-setup-v1'));
    await user.clear(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard(`${to}{Enter}`);
  }

  it("rewrites a later step's $ref, leaving a longer lookalike name alone", async () => {
    resetStores();
    const user = userEvent.setup();
    openEditor('Ship $headline, not $headliner');

    await rename(user, 'title');

    await user.click(screen.getByTestId('automations-step-setup-n1'));
    expect(screen.getByTestId('automations-step-config-n1-message')).toHaveValue('Ship $title, not $headliner');
  });

  it('keeps the automation valid across the rename — no step is left pointing at a name that is gone', async () => {
    resetStores();
    const user = userEvent.setup();
    openEditor('Ship $headline');

    await rename(user, 'title');

    expect(screen.getByTestId('automations-editor-issues')).not.toHaveTextContent('no earlier step defines it');
    expect(screen.getByTestId('automations-editor-save')).toBeEnabled();
  });

  it('reports a stale $ref instead of rewriting it when the renamed key belongs to an Ask me field (Decision 9)', () => {
    resetStores();
    setDefinitions([
      {
        ...EXISTING,
        id: 'auto-3',
        definition: {
          triggers: [],
          steps: [
            {
              id: 'q1',
              kind: 'ask_me',
              title: 'Check-in',
              fields: [{ key: 'renamed', label: 'Headline', type: 'text' }],
            },
            { id: 'n1', kind: 'notify', message: ['Ship $field_1'] },
          ],
        },
      },
    ]);
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: 'auto-3' } });
    render(<AutomationEditor />);

    expect(screen.getByTestId('automations-editor-issues')).toHaveTextContent(
      'This step uses $field_1, but no earlier step defines it.',
    );
  });
});

describe('AutomationEditor — unresolved $name', () => {
  const UNRESOLVED: AutomationSummary = {
    ...EXISTING,
    id: 'auto-4',
    definition: { triggers: [], steps: [{ id: 'n1', kind: 'notify', message: ['Ship $nope'] }] },
  };

  function openUnresolved() {
    setDefinitions([UNRESOLVED]);
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: UNRESOLVED.id } });
    render(<AutomationEditor />);
  }

  it('reports the missing name on the step that uses it', () => {
    resetStores();
    openUnresolved();

    expect(screen.getByTestId('automations-step-n1')).toHaveTextContent(
      'This step uses $nope, but no earlier step defines it.',
    );
  });

  // The engine leaves an unresolved `$name` literal, so `cd $HOME && pnpm build`
  // is a legitimate prompt. Blocking Save on it made that unsaveable.
  it('leaves Save available — an unresolved name is a warning, not an error', () => {
    resetStores();
    openUnresolved();

    expect(screen.getByTestId('automations-editor-save')).toBeEnabled();
  });

  it('clears the issue once the ref is fixed', async () => {
    resetStores();
    const user = userEvent.setup();
    openUnresolved();

    await user.click(screen.getByTestId('automations-step-setup-n1'));
    await user.clear(screen.getByTestId('automations-step-config-n1-message'));
    await user.type(screen.getByTestId('automations-step-config-n1-message'), 'Ship it');

    expect(screen.getByTestId('automations-step-n1')).not.toHaveTextContent('no earlier step defines it');
    expect(screen.getByTestId('automations-editor-save')).toBeEnabled();
  });
});

/**
 * The editor edits plain text, but the wire carries `{token}` parts that address
 * a step structurally. Both conversions have to run at this boundary, or a trip
 * through the editor quietly demotes every ref to a name — and a name whose
 * ordinal is minted from position rebinds the moment a producer moves.
 */
describe('AutomationEditor — a definition survives the round trip', () => {
  const STEPS: AutomationStep[] = [
    { id: 'a1', kind: 'ask_agent', prompt: ['Summarize'] },
    { id: 'a2', kind: 'ask_agent', prompt: ['Review'] },
    { id: 'n1', kind: 'notify', message: ['Ship ', { token: { stepId: 'a1', output: 'result' } }] },
  ];

  let sent: AutomationCreateInput | undefined;

  function openEditor(steps: AutomationStep[]) {
    sent = undefined;
    // These steps are ask_agent (token round-tripping through them is what's
    // under test) — a project is required for them, unlike EXISTING's base fixture.
    setDefinitions([{ ...EXISTING, id: 'auto-5', projectId: 'proj-1', definition: { triggers: [], steps } }]);
    useAutomationsStore.setState({
      gateway: fakeGateway({
        updateAutomation: async (_id, input) => {
          sent = input;
          return { ...EXISTING, ...input, projectId: input.projectId ?? null };
        },
      }),
    });
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: 'auto-5' } });
    render(<AutomationEditor />);
  }

  async function save(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('automations-editor-save'));
    await waitFor(() => expect(sent).toBeDefined());
  }

  function savedMessage(id: string) {
    const step = sent?.definition.steps.find((s) => s.id === id);
    if (step?.kind !== 'notify') throw new Error(`no notify step ${id}`);
    return step.message;
  }

  function dragAbove(dragged: string, target: string) {
    const dataTransfer = { dropEffect: '' } as unknown as DataTransfer;
    fireEvent.dragStart(screen.getByTestId(`automations-step-grip-${dragged}`), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId(`automations-step-${target}`), { dataTransfer });
    fireEvent.drop(screen.getByTestId(`automations-step-${target}`), { dataTransfer });
  }

  it('saves the tokens it loaded, not the text the editor showed', async () => {
    resetStores();
    const user = userEvent.setup();
    openEditor(STEPS);

    await save(user);

    expect(savedMessage('n1')).toEqual(['Ship ', { token: { stepId: 'a1', output: 'result' } }]);
  });

  it('mints an outputName per producer, so their names stop depending on position', async () => {
    resetStores();
    const user = userEvent.setup();
    openEditor(STEPS);

    await save(user);

    expect(sent?.definition.steps[0]).toMatchObject({ id: 'a1', outputName: 'agent_result' });
    expect(sent?.definition.steps[1]).toMatchObject({ id: 'a2', outputName: 'agent_result_2' });
  });

  it('keeps a ref on its own step after another producer is dragged above it', async () => {
    resetStores();
    const user = userEvent.setup();
    openEditor(STEPS);

    dragAbove('a2', 'a1');
    await save(user);

    expect(savedMessage('n1')).toEqual(['Ship ', { token: { stepId: 'a1', output: 'result' } }]);
  });
});

describe('AutomationEditor — a rejected save', () => {
  function openValidDraft(rejection: unknown) {
    setDefinitions([EXISTING]);
    useAutomationsStore.setState({
      gateway: fakeGateway({
        updateAutomation: async () => {
          throw rejection;
        },
      }),
    });
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: EXISTING.id } });
    render(<AutomationEditor />);
  }

  it("puts the daemon's per-step rejection on that step and re-gates Save", async () => {
    resetStores();
    const user = userEvent.setup();
    openValidDraft(
      new ApiRequestError('This step uses $nope, but no earlier step defines it.', [
        { stepId: 's1', message: 'This step uses $nope, but no earlier step defines it.' },
      ]),
    );

    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() =>
      expect(screen.getByTestId('automations-step-s1')).toHaveTextContent(
        'This step uses $nope, but no earlier step defines it.',
      ),
    );
    expect(screen.getByTestId('automations-editor-save')).toBeDisabled();
  });

  it('drops the daemon issues on the next edit, so the fix re-enables Save', async () => {
    resetStores();
    const user = userEvent.setup();
    openValidDraft(new ApiRequestError('nope', [{ stepId: 's1', message: 'Choose an action for this step.' }]));

    await user.click(screen.getByTestId('automations-editor-save'));
    await waitFor(() => expect(screen.getByTestId('automations-editor-save')).toBeDisabled());

    await user.type(screen.getByTestId('automations-editor-name'), '!');

    expect(screen.getByTestId('automations-step-s1')).not.toHaveTextContent('Choose an action for this step.');
    expect(screen.getByTestId('automations-editor-save')).toBeEnabled();
  });

  it('leaves Save available after a failure that says nothing about the draft', async () => {
    resetStores();
    const user = userEvent.setup();
    openValidDraft(new Error('Failed to fetch'));

    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() => expect(screen.getByTestId('automations-editor-save')).toBeEnabled());
    expect(screen.getByTestId('automations-editor-issues')).not.toHaveTextContent('Failed to fetch');
  });
});

describe('AutomationEditor — footer validation summary', () => {
  it('shows the outstanding issue count when invalid', () => {
    resetStores();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    expect(screen.getByText(/to fix/)).toBeInTheDocument();
  });

  it('shows "Looks good" once every issue is resolved', async () => {
    resetStores();
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);
    expect(screen.getByText(/Looks good/)).toBeInTheDocument();
  });

  it('appends "ready to create" for a new automation once valid', async () => {
    resetStores();
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await fillValidDraft(user);
    expect(screen.getByText('Looks good · ready to create')).toBeInTheDocument();
  });

  it('appends "ready to save" once valid when editing an existing automation', () => {
    resetStores();
    setDefinitions([EXISTING]);
    useAutomationsNav.setState({ editorTarget: { mode: 'edit', automationId: EXISTING.id } });
    render(<AutomationEditor />);
    expect(screen.getByText('Looks good · ready to save')).toBeInTheDocument();
  });
});

describe('AutomationEditor — cancel/back', () => {
  it('clicking Cancel closes the editor', async () => {
    resetStores();
    const user = userEvent.setup();
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    render(<AutomationEditor />);
    await user.click(screen.getByTestId('automations-editor-cancel'));
    expect(useAutomationsNav.getState().editorTarget).toBeNull();
  });
});
