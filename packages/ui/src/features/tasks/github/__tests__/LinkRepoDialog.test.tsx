// @vitest-environment jsdom
/**
 * LinkRepoDialog.test.tsx
 *
 * Red-phase test for the link dialog (`../LinkRepoDialog`, not yet created —
 * task 36 of the plan implements it against this file, per the spec's
 * "Linking a project to a repository" section and task 30's
 * `listGitHubRemotes(port, projectId, chatId?)` client, added to `lib/api/git.ts`).
 *
 * Behaviors covered:
 *  1. Lists exactly the remotes the route returned, one radio per remote, the derived
 *     `owner/repo` as the label and the remote name as secondary text.
 *  2. `tasks-github-link-confirm` is disabled with neither a remote selected nor a
 *     credential connected, and while only one of the two is satisfied.
 *  3. `tasks-github-link-confirm` is enabled once both a remote is selected and a
 *     credential is connected, and confirming calls `linkRepo` with the selected remote's
 *     owner/repo/remoteName and the connected credential label.
 *  4. `tasks-github-link-cancel` calls `closeDialog()`.
 *
 * The credential row reuses `CredentialConnect` (an existing, separately tested
 * component) — stubbed here to a single button that fires `onChange`, so this file
 * exercises only LinkRepoDialog's own confirm-enablement logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('@/features/automations/steps/CredentialConnect', () => ({
  CredentialConnect: ({ onChange }: { onChange: (label: string | undefined) => void }) => (
    <button data-testid="stub-credential-connect" onClick={() => onChange('github-creds')}>
      Connect GitHub
    </button>
  ),
}));

const { LinkRepoDialog } = await import('../LinkRepoDialog');

const REMOTES = [
  { name: 'origin', owner: 'qlan-ro', repo: 'mainframe' },
  { name: 'upstream', owner: 'qlan-ro', repo: 'mainframe-fork' },
];

beforeEach(() => {
  vi.clearAllMocks();
  listGitHubRemotes.mockResolvedValue(REMOTES);
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

describe('LinkRepoDialog — confirm enablement', () => {
  it('is disabled with neither a remote selected nor a credential connected', async () => {
    render(<LinkRepoDialog />);
    await screen.findByTestId('tasks-github-remote-origin');
    expect(screen.getByTestId('tasks-github-link-confirm')).toBeDisabled();
  });

  it('stays disabled with a remote selected but no credential connected', async () => {
    render(<LinkRepoDialog />);
    await userEvent.click(await screen.findByTestId('tasks-github-remote-origin'));
    expect(screen.getByTestId('tasks-github-link-confirm')).toBeDisabled();
  });

  it('stays disabled with a credential connected but no remote selected', async () => {
    render(<LinkRepoDialog />);
    await screen.findByTestId('tasks-github-remote-origin');
    await userEvent.click(screen.getByTestId('stub-credential-connect'));
    expect(screen.getByTestId('tasks-github-link-confirm')).toBeDisabled();
  });

  it('enables once both a remote is selected and a credential is connected, and confirm calls linkRepo', async () => {
    render(<LinkRepoDialog />);
    await userEvent.click(await screen.findByTestId('tasks-github-remote-origin'));
    await userEvent.click(screen.getByTestId('stub-credential-connect'));

    const confirm = screen.getByTestId('tasks-github-link-confirm');
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    expect(linkRepo).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      owner: 'qlan-ro',
      repo: 'mainframe',
      remoteName: 'origin',
      credentialLabel: 'github-creds',
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
