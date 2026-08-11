// @vitest-environment jsdom
/**
 * GitHubTokenField.test.tsx
 *
 * The paste-a-PAT field and its saving hook (`../GitHubTokenField`), which
 * replaced the Automations placeholder `CredentialConnect` for GitHub sync —
 * that one stored a fake token GitHub answered with 401.
 *
 * Behaviors covered:
 *  1. Save is disabled while the input is empty or whitespace-only, and while busy.
 *  2. Clicking Save and pressing Enter both submit the trimmed token.
 *  3. useSaveGitHubToken writes the token under the fixed `github` label and
 *     registers that label with the automations store.
 *  4. A gateway failure toasts and reports failure, leaving no credential behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { createFakeGateway as fakeGateway } from '@/features/automations/data/__tests__/fake-gateway';
import { GITHUB_CREDENTIAL_LABEL, GitHubTokenField, useSaveGitHubToken } from '../GitHubTokenField';

beforeEach(() => {
  vi.clearAllMocks();
  useAutomationsStore.setState({ credentials: [], gateway: fakeGateway() });
});

describe('GITHUB_CREDENTIAL_LABEL', () => {
  it('is the fixed "github" label the link rows reference', () => {
    expect(GITHUB_CREDENTIAL_LABEL).toBe('github');
  });
});

describe('GitHubTokenField — save enablement', () => {
  it('disables Save while the input is empty', () => {
    render(<GitHubTokenField busy={false} onSave={vi.fn()} testId="tasks-github-token" />);
    expect(screen.getByTestId('tasks-github-token-save')).toBeDisabled();
  });

  it('keeps Save disabled for a whitespace-only token', async () => {
    render(<GitHubTokenField busy={false} onSave={vi.fn()} testId="tasks-github-token" />);
    await userEvent.type(screen.getByTestId('tasks-github-token-input'), '   ');
    expect(screen.getByTestId('tasks-github-token-save')).toBeDisabled();
  });

  it('enables Save once a token is typed', async () => {
    render(<GitHubTokenField busy={false} onSave={vi.fn()} testId="tasks-github-token" />);
    await userEvent.type(screen.getByTestId('tasks-github-token-input'), 'ghp_abc123');
    expect(screen.getByTestId('tasks-github-token-save')).toBeEnabled();
  });

  it('disables Save while a save is in flight', async () => {
    const onSave = vi.fn();
    render(<GitHubTokenField busy onSave={onSave} testId="tasks-github-token" />);
    await userEvent.type(screen.getByTestId('tasks-github-token-input'), 'ghp_abc123');

    expect(screen.getByTestId('tasks-github-token-save')).toBeDisabled();
    await userEvent.type(screen.getByTestId('tasks-github-token-input'), '{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('GitHubTokenField — submission', () => {
  it('submits the trimmed token when Save is clicked', async () => {
    const onSave = vi.fn();
    render(<GitHubTokenField busy={false} onSave={onSave} testId="tasks-github-token" />);

    await userEvent.type(screen.getByTestId('tasks-github-token-input'), '  ghp_abc123  ');
    await userEvent.click(screen.getByTestId('tasks-github-token-save'));

    expect(onSave).toHaveBeenCalledWith('ghp_abc123');
  });

  it('submits the trimmed token when Enter is pressed in the input', async () => {
    const onSave = vi.fn();
    render(<GitHubTokenField busy={false} onSave={onSave} testId="tasks-github-token" />);

    await userEvent.type(screen.getByTestId('tasks-github-token-input'), '  ghp_abc123  {Enter}');

    expect(onSave).toHaveBeenCalledWith('ghp_abc123');
  });

  it('does not submit on Enter with an empty input', async () => {
    const onSave = vi.fn();
    render(<GitHubTokenField busy={false} onSave={onSave} testId="tasks-github-token" />);

    await userEvent.type(screen.getByTestId('tasks-github-token-input'), '{Enter}');

    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders the input as a password field so the token is not shoulder-readable', () => {
    render(<GitHubTokenField busy={false} onSave={vi.fn()} testId="tasks-github-token" />);
    expect(screen.getByTestId('tasks-github-token-input').getAttribute('type')).toBe('password');
  });
});

describe('useSaveGitHubToken', () => {
  it('stores the token under the "github" label and registers it with the automations store', async () => {
    const putCredential = vi.fn(async () => {});
    useAutomationsStore.setState({ gateway: fakeGateway({ putCredential }) });

    const { result } = renderHook(() => useSaveGitHubToken());
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save('ghp_live_abc');
    });

    expect(putCredential).toHaveBeenCalledWith('github', 'ghp_live_abc');
    expect(saved).toBe(true);
    expect(useAutomationsStore.getState().credentials).toEqual(['github']);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts and reports failure without registering a credential when the gateway rejects', async () => {
    useAutomationsStore.setState({
      gateway: fakeGateway({
        putCredential: async () => {
          throw new Error('keyring locked');
        },
      }),
    });

    const { result } = renderHook(() => useSaveGitHubToken());
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save('ghp_live_abc');
    });

    expect(saved).toBe(false);
    expect(toastError).toHaveBeenCalledWith('Could not save the GitHub token', { description: 'keyring locked' });
    expect(useAutomationsStore.getState().credentials).toEqual([]);
  });
});
