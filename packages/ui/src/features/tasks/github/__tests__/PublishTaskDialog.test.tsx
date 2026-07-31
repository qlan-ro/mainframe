// @vitest-environment jsdom
/**
 * PublishTaskDialog.test.tsx
 *
 * Red-phase test for the publish-confirmation dialog (`../PublishTaskDialog`, not
 * yet created — task 40 of the plan implements it against this file), per the
 * spec's "Publish" paragraph. Self-contained: reads `dialog` from the store (D5)
 * and renders nothing when it isn't `{ kind: 'publish' }`.
 *
 * Behaviors covered:
 *  1. Renders nothing when the store's dialog isn't a publish dialog.
 *  2. Header reads 'Publish task #{number} to {owner}/{repo}?'.
 *  3. Shows the exact Title/Body payload verbatim, and a Labels row listing only
 *     the syncable (non-workflow) labels — asserted against the row, since the
 *     withheld ones are named in the sentence covered by 4.
 *  4. Names withheld workflow labels with the exact count sentence (spec's own
 *     example) when the task carries any.
 *  5. Omits the withheld-labels sentence entirely when the task carries none.
 *  6. `tasks-github-publish-confirm` reads "Create issue" and calls
 *     `publish(todo.id)`; `tasks-github-publish-cancel` calls `closeDialog()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Todo } from '@/lib/api/todos';
import type { Link, WorkflowLabelSet } from '@/lib/api/todos-github';

const TODO: Todo = {
  id: 'todo-a',
  number: 285,
  project_id: 'proj-abc',
  title: 'Fix the login bug',
  body: 'Steps to reproduce the login failure...',
  status: 'open',
  type: 'bug',
  priority: 'medium',
  labels: ['bug', 'route:no-spec', 'gate:brief', 'ready-for-agent'],
  assignees: [],
  dependencies: [],
  order_index: 0,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const LINK_FIXTURE: Link = {
  projectId: 'proj-abc',
  owner: 'qlan-ro',
  repo: 'mainframe',
  remoteName: 'origin',
  credentialLabel: 'github',
  lastSyncedAt: null,
};

// Fetched from the daemon (`GET /link`'s `workflowLabels`) rather than
// hardcoded here — proves the dialog partitions using whatever the store
// hands it, not a UI-local copy of the denylist.
const WORKFLOW_LABELS_FIXTURE: WorkflowLabelSet = {
  prefixes: ['route:', 'gate:'],
  labels: ['ready-for-agent'],
};

const publish = vi.fn();
const closeDialog = vi.fn();

let dialog: null | { kind: 'publish'; todo: Todo } | { kind: 'link' };
let link: Link | null;

vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ dialog, link, workflowLabels: WORKFLOW_LABELS_FIXTURE, publish, closeDialog }),
}));

const { PublishTaskDialog } = await import('../PublishTaskDialog');

beforeEach(() => {
  vi.clearAllMocks();
  dialog = { kind: 'publish', todo: TODO };
  link = LINK_FIXTURE;
});

describe('PublishTaskDialog — visibility', () => {
  it('renders nothing when the dialog is not a publish dialog', () => {
    dialog = { kind: 'link' };
    const { container } = render(<PublishTaskDialog />);
    expect(container.textContent).toBe('');
  });
});

describe('PublishTaskDialog — payload', () => {
  it('renders the header "Publish task #285 to qlan-ro/mainframe?"', () => {
    render(<PublishTaskDialog />);
    expect(screen.getByTestId('tasks-github-publish-dialog').textContent).toContain(
      'Publish task #285 to qlan-ro/mainframe?',
    );
  });

  it('shows the title and body verbatim', () => {
    render(<PublishTaskDialog />);
    const dialogEl = screen.getByTestId('tasks-github-publish-dialog');
    expect(dialogEl.textContent).toContain('Fix the login bug');
    expect(dialogEl.textContent).toContain('Steps to reproduce the login failure...');
  });

  it('lists only the syncable label in the Labels row', () => {
    render(<PublishTaskDialog />);
    // Scoped to the row: the dialog names the withheld labels elsewhere, in the
    // sentence the next describe pins, so a whole-dialog assertion would
    // contradict it.
    const labelsRow = screen.getByTestId('tasks-github-publish-labels');
    expect(labelsRow.textContent).toContain('bug');
    expect(labelsRow.textContent).not.toContain('route:no-spec');
    expect(labelsRow.textContent).not.toContain('gate:brief');
    expect(labelsRow.textContent).not.toContain('ready-for-agent');
  });
});

describe('PublishTaskDialog — withheld workflow labels', () => {
  it('names them with the exact count sentence from the spec', () => {
    render(<PublishTaskDialog />);
    const dialogEl = screen.getByTestId('tasks-github-publish-dialog');
    expect(dialogEl.textContent).toContain(
      "3 workflow labels stay local — route:no-spec, gate:brief, ready-for-agent. Mainframe's pipeline labels are never published and never accepted back from GitHub.",
    );
  });

  it('omits the sentence entirely when the task carries no workflow labels', () => {
    dialog = { kind: 'publish', todo: { ...TODO, labels: ['bug', 'priority-high'] } };
    render(<PublishTaskDialog />);
    const dialogEl = screen.getByTestId('tasks-github-publish-dialog');
    expect(dialogEl.textContent).not.toContain('workflow label');
    expect(dialogEl.textContent).not.toContain('stay local');
  });
});

describe('PublishTaskDialog — actions', () => {
  it('confirm reads "Create issue" and calls publish(todo.id)', async () => {
    render(<PublishTaskDialog />);
    const confirm = screen.getByTestId('tasks-github-publish-confirm');
    expect(confirm.textContent).toContain('Create issue');
    await userEvent.click(confirm);
    expect(publish).toHaveBeenCalledWith('todo-a');
  });

  it('cancel calls closeDialog()', async () => {
    render(<PublishTaskDialog />);
    await userEvent.click(screen.getByTestId('tasks-github-publish-cancel'));
    expect(closeDialog).toHaveBeenCalledOnce();
  });
});
