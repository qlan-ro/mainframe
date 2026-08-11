// @vitest-environment jsdom
/**
 * LinkRepoDialog.test.tsx
 *
 * The link dialog (`../LinkRepoDialog`), per the spec's "Linking a project to
 * a repository" section and task 30's `listGitHubRemotes(port, projectId,
 * chatId?)` client in `lib/api/git.ts`.
 *
 * Behaviors covered:
 *  1. Lists exactly the remotes the route returned, one radio per remote, the derived
 *     `owner/repo` as the label and the remote name as secondary text.
 *  2. `tasks-github-link-confirm` is disabled with neither a remote selected nor a
 *     token stored, and while only one of the two is satisfied.
 *  3. `tasks-github-link-confirm` is enabled once both a remote is selected and a
 *     token is stored, and confirming calls `linkRepo` with the selected remote's
 *     owner/repo/remoteName and the `github` credential label.
 *  4. Connectedness is seeded from the daemon's credential labels: 'github' present
 *     shows the connected pill; absent shows the paste-a-PAT field.
 *  5. Pasting and saving a token stores it and flips the dialog to connected.
 *  6. `tasks-github-link-cancel` calls `closeDialog()`.
 *
 * The token row is the real `GitHubTokenField` on the real automations store
 * with a fake gateway — the old `CredentialConnect` stub is gone, along with
 * the placeholder token GitHub rejected with a 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const PORT = 31415;
const PROJECT_ID = 'proj-abc';

const listGitHubRemotes = vi.fn();
vi.mock('@/lib/api/git', () => ({ listGitHubRemotes: (...args: unknown[]) => listGitHubRemotes(...args) }));

const linkRepo = vi.fn();
const closeDialog = vi.fn();
vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ port: PORT, projectId: PROJECT_ID, linkRepo, closeDialog }),
}));

import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { createFakeGateway as fakeGateway } from '@/features/automations/data/__tests__/fake-gateway';

const { LinkRepoDialog } = await import('../LinkRepoDialog');

const REMOTES = [
  { name: 'origin', owner: 'qlan-ro', repo: 'mainframe' },
  { name: 'upstream', owner: 'qlan-ro', repo: 'mainframe-fork' },
];

/** Seeds the daemon's stored credential labels the dialog reads connectedness from. */
const withStoredLabels = (labels: string[]): void => {
  useAutomationsStore.setState({ credentials: [], gateway: fakeGateway({ listCredentialLabels: async () => labels }) });
};

beforeEach(() => {
  vi.clearAllMocks();
  listGitHubRemotes.mockResolvedValue(REMOTES);
  withStoredLabels([]);
});

describe('LinkRepoDialog — remote list', () => {
  it('renders exactly one radio per remote the route returned, labelled owner/repo with the remote name as secondary text', async () => {
    render(<LinkRepoDialog />);

    const originRadio = await screen.findByTestId('tasks-github-remote-origin');
    const upstreamRadio = screen.getByTestId('tasks-github-remote-upstream');

    expect(originRadio.closest('label,div')?.textContent).toContain('qlan-ro/mainframe');
    expect(originRadio.closest('label,div')?.textContent).toContain('origin');
    expect(upstreamRadio.closest('label,div')?.textContent).toContain('qlan-ro/mainframe-fork');
    expect(upstreamRadio.closest('label,div')?.textContent).toContain('upstream');
    expect(screen.queryAllByRole('radio')).toHaveLength(2);
  });

  it('calls listGitHubRemotes with the port and projectId from the store', async () => {
    render(<LinkRepoDialog />);
    await screen.findByTestId('tasks-github-remote-origin');
    expect(listGitHubRemotes).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

describe('LinkRepoDialog — token row', () => {
  it('shows the paste-a-PAT field when no github token is stored', async () => {
    render(<LinkRepoDialog />);
    expect(await screen.findByTestId('tasks-github-credential-input')).toBeTruthy();
    expect(screen.queryByTestId('tasks-github-credential-connected')).toBeNull();
  });

  it('shows the connected pill instead of the field when a github token is stored', async () => {
    withStoredLabels(['github']);
    render(<LinkRepoDialog />);

    expect((await screen.findByTestId('tasks-github-credential-connected')).textContent).toContain('connected');
    expect(screen.queryByTestId('tasks-github-credential-input')).toBeNull();
  });

  it('reveals the field again when Replace… is clicked', async () => {
    withStoredLabels(['github']);
    render(<LinkRepoDialog />);

    await userEvent.click(await screen.findByTestId('tasks-github-credential-replace'));

    expect(screen.getByTestId('tasks-github-credential-input')).toBeTruthy();
    expect(screen.queryByTestId('tasks-github-credential-connected')).toBeNull();
  });

  it('stores a pasted token under the github label and flips the row to connected', async () => {
    const putCredential = vi.fn(async () => {});
    useAutomationsStore.setState({
      credentials: [],
      gateway: fakeGateway({ listCredentialLabels: async () => [], putCredential }),
    });
    render(<LinkRepoDialog />);

    await userEvent.type(await screen.findByTestId('tasks-github-credential-input'), 'ghp_live_abc');
    await userEvent.click(screen.getByTestId('tasks-github-credential-save'));

    expect(putCredential).toHaveBeenCalledWith('github', 'ghp_live_abc');
    expect((await screen.findByTestId('tasks-github-credential-connected')).textContent).toContain('connected');
  });
});

describe('LinkRepoDialog — confirm enablement', () => {
  it('is disabled with neither a remote selected nor a token stored', async () => {
    render(<LinkRepoDialog />);
    await screen.findByTestId('tasks-github-remote-origin');
    expect(screen.getByTestId('tasks-github-link-confirm')).toBeDisabled();
  });

  it('stays disabled with a remote selected but no token stored', async () => {
    render(<LinkRepoDialog />);
    await userEvent.click(await screen.findByTestId('tasks-github-remote-origin'));
    expect(screen.getByTestId('tasks-github-link-confirm')).toBeDisabled();
  });

  it('stays disabled with a token stored but no remote selected', async () => {
    withStoredLabels(['github']);
    render(<LinkRepoDialog />);
    await screen.findByTestId('tasks-github-credential-connected');
    expect(screen.getByTestId('tasks-github-link-confirm')).toBeDisabled();
  });

  it('enables once both a remote is selected and a token is stored, and confirm calls linkRepo', async () => {
    withStoredLabels(['github']);
    render(<LinkRepoDialog />);
    await screen.findByTestId('tasks-github-credential-connected');
    await userEvent.click(await screen.findByTestId('tasks-github-remote-origin'));

    const confirm = screen.getByTestId('tasks-github-link-confirm');
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    expect(linkRepo).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      owner: 'qlan-ro',
      repo: 'mainframe',
      remoteName: 'origin',
      credentialLabel: 'github',
    });
  });

  it('enables after a token is pasted and saved with a remote already selected', async () => {
    render(<LinkRepoDialog />);
    await userEvent.click(await screen.findByTestId('tasks-github-remote-origin'));
    expect(screen.getByTestId('tasks-github-link-confirm')).toBeDisabled();

    await userEvent.type(screen.getByTestId('tasks-github-credential-input'), 'ghp_live_abc');
    await userEvent.click(screen.getByTestId('tasks-github-credential-save'));

    await waitFor(() => {
      expect(screen.getByTestId('tasks-github-link-confirm')).toBeEnabled();
    });
  });
});

describe('LinkRepoDialog — cancel', () => {
  it('calls closeDialog()', async () => {
    render(<LinkRepoDialog />);
    await screen.findByTestId('tasks-github-remote-origin');
    await userEvent.click(screen.getByTestId('tasks-github-link-cancel'));
    expect(closeDialog).toHaveBeenCalledOnce();
  });
});
