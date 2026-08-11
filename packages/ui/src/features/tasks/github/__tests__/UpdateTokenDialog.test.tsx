// @vitest-environment jsdom
/**
 * UpdateTokenDialog.test.tsx
 *
 * The standalone "Update GitHub token" dialog (`../UpdateTokenDialog`), opened
 * from the sync pill's menu and from the import dialog's auth-failure state.
 *
 * Behaviors covered:
 *  1. Renders only for `{ kind: 'token' }`.
 *  2. A saved token is stored under the `github` label and confirmed by a toast.
 *  3. `returnTo: 'import'` reopens the import dialog; without it the dialog closes.
 *  4. A failed save leaves the dialog open, with no success toast and no navigation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

const openDialog = vi.fn();
const closeDialog = vi.fn();
let dialog: null | { kind: 'import' } | { kind: 'token'; returnTo?: 'import' };

vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ dialog, openDialog, closeDialog }),
}));

import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { createFakeGateway as fakeGateway } from '@/features/automations/data/__tests__/fake-gateway';

const { UpdateTokenDialog } = await import('../UpdateTokenDialog');

const typeAndSave = async (token: string): Promise<void> => {
  await userEvent.type(screen.getByTestId('tasks-github-token-input'), token);
  await userEvent.click(screen.getByTestId('tasks-github-token-save'));
};

beforeEach(() => {
  vi.clearAllMocks();
  dialog = { kind: 'token' };
  useAutomationsStore.setState({ credentials: [], gateway: fakeGateway() });
});

describe('UpdateTokenDialog — visibility', () => {
  it('renders nothing when the open dialog is not the token dialog', () => {
    dialog = { kind: 'import' };
    render(<UpdateTokenDialog />);
    expect(screen.queryByTestId('tasks-github-token-dialog')).toBeNull();
  });

  it('renders nothing when no dialog is open', () => {
    dialog = null;
    render(<UpdateTokenDialog />);
    expect(screen.queryByTestId('tasks-github-token-dialog')).toBeNull();
  });

  it('renders the token dialog with the paste-a-PAT field', () => {
    render(<UpdateTokenDialog />);
    expect(screen.getByTestId('tasks-github-token-dialog')).toBeTruthy();
    expect(screen.getByTestId('tasks-github-token-input')).toBeTruthy();
  });
});

describe('UpdateTokenDialog — saving', () => {
  it('stores the token under the github label and confirms with a toast', async () => {
    const putCredential = vi.fn(async () => {});
    useAutomationsStore.setState({ gateway: fakeGateway({ putCredential }) });
    render(<UpdateTokenDialog />);

    await typeAndSave('ghp_live_abc');

    expect(putCredential).toHaveBeenCalledWith('github', 'ghp_live_abc');
    expect(toastSuccess).toHaveBeenCalledWith('GitHub token updated');
  });

  it('reopens the import dialog when it was reached from the import failure', async () => {
    dialog = { kind: 'token', returnTo: 'import' };
    render(<UpdateTokenDialog />);

    await typeAndSave('ghp_live_abc');

    expect(openDialog).toHaveBeenCalledWith({ kind: 'import' });
    expect(closeDialog).not.toHaveBeenCalled();
  });

  it('just closes when it was reached from the sync menu', async () => {
    render(<UpdateTokenDialog />);

    await typeAndSave('ghp_live_abc');

    expect(closeDialog).toHaveBeenCalledOnce();
    expect(openDialog).not.toHaveBeenCalled();
  });
});

describe('UpdateTokenDialog — failed save', () => {
  it('keeps the dialog open, toasts the failure, and navigates nowhere', async () => {
    dialog = { kind: 'token', returnTo: 'import' };
    useAutomationsStore.setState({
      gateway: fakeGateway({
        putCredential: async () => {
          throw new Error('keyring locked');
        },
      }),
    });
    render(<UpdateTokenDialog />);

    await typeAndSave('ghp_live_abc');

    expect(toastError).toHaveBeenCalledWith('Could not save the GitHub token', { description: 'keyring locked' });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(openDialog).not.toHaveBeenCalled();
    expect(closeDialog).not.toHaveBeenCalled();
    expect(screen.getByTestId('tasks-github-token-dialog')).toBeTruthy();
  });
});
