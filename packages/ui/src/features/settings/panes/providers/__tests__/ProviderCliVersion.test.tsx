import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ProviderCliStatus } from '@qlan-ro/mainframe-types';
import { ProviderCliVersion } from '../ProviderCliVersion';
import { useCliUpdateStore, applyProviderCliStatus, resetProviderCliStatuses } from '../../../../../store/cli-update';

vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { onEvent: () => () => {} } }));

const checkProviderCliUpdate = vi.fn();
const updateProviderCli = vi.fn();
vi.mock('../../../../../lib/api/cli-update', () => ({
  checkProviderCliUpdate: (...a: unknown[]) => checkProviderCliUpdate(...a),
  updateProviderCli: (...a: unknown[]) => updateProviderCli(...a),
}));

const base = (overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus => ({
  adapterId: 'claude',
  installedVersion: '1.0.0',
  latestVersion: '1.0.0',
  updateAvailable: false,
  installMethod: 'homebrew',
  updateCommand: 'brew upgrade claude-code',
  canUpdate: true,
  checkFailed: false,
  ...overrides,
});

beforeEach(() => {
  resetProviderCliStatuses();
});
afterEach(() => vi.clearAllMocks());

describe('ProviderCliVersion', () => {
  it('renders nothing when the daemon has no status for this adapter', () => {
    const { container } = render(<ProviderCliVersion port={31415} adapterId="claude" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows installed/latest and calls the update API when an update is available and canUpdate', async () => {
    applyProviderCliStatus(base({ updateAvailable: true, latestVersion: '2.0.0' }));
    updateProviderCli.mockResolvedValue(base({ updateAvailable: true, latestVersion: '2.0.0' }));
    render(<ProviderCliVersion port={31415} adapterId="claude" />);

    expect(screen.getByTestId('settings-claude-cli-installed')).toHaveTextContent('Installed 1.0.0');
    expect(screen.getByTestId('settings-claude-cli-latest')).toHaveTextContent('Latest 2.0.0');

    const button = screen.getByTestId('settings-claude-cli-update-button');
    expect(button).toHaveTextContent('Update to 2.0.0');
    fireEvent.click(button);
    expect(updateProviderCli).toHaveBeenCalledWith('claude', 31415);
  });

  it('shows "Up to date" when no update is available and the latest version is known', () => {
    applyProviderCliStatus(base({ updateAvailable: false, latestVersion: '1.0.0' }));
    render(<ProviderCliVersion port={31415} adapterId="claude" />);
    expect(screen.getByTestId('settings-claude-cli-latest')).toHaveTextContent('Up to date');
    expect(screen.queryByTestId('settings-claude-cli-update-button')).toBeNull();
  });

  it('while running: disables the button, shows a spinner, and renders the growing output', () => {
    applyProviderCliStatus(
      base({
        updateAvailable: true,
        latestVersion: '2.0.0',
        update: { state: 'running', output: 'Fetching…\n', startedAt: 1, permissionDenied: false },
      }),
    );
    render(<ProviderCliVersion port={31415} adapterId="claude" />);

    const button = screen.getByTestId('settings-claude-cli-update-button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Updating…');
    expect(screen.getByTestId('settings-claude-cli-output')).toHaveTextContent('Fetching…');
  });

  it('on failure with permissionDenied: shows the error and a manual-command snippet, output tail visible', () => {
    applyProviderCliStatus(
      base({
        updateAvailable: true,
        latestVersion: '2.0.0',
        update: {
          state: 'failed',
          output: 'Permission denied\n',
          startedAt: 1,
          finishedAt: 2,
          error: 'The installer exited with an error.',
          permissionDenied: true,
        },
      }),
    );
    render(<ProviderCliVersion port={31415} adapterId="claude" />);

    expect(screen.getByTestId('settings-claude-cli-update-result')).toHaveTextContent(
      'The installer exited with an error.',
    );
    expect(screen.getByTestId('settings-claude-cli-output')).toHaveTextContent('Permission denied');
    const manual = screen.getByTestId('settings-claude-cli-manual-command');
    expect(manual).toHaveTextContent('brew upgrade claude-code');
    expect(screen.getByText(/administrator rights/)).toBeTruthy();
  });

  it('on success: shows the updated version and the restart note', () => {
    applyProviderCliStatus(
      base({
        updateAvailable: true,
        latestVersion: '2.0.0',
        update: {
          state: 'succeeded',
          output: 'done\n',
          startedAt: 1,
          finishedAt: 2,
          permissionDenied: false,
          versionAfter: '2.0.0',
        },
      }),
    );
    render(<ProviderCliVersion port={31415} adapterId="claude" />);

    const result = screen.getByTestId('settings-claude-cli-update-result');
    expect(result).toHaveTextContent('Updated to 2.0.0');
    expect(result).toHaveTextContent('Running sessions keep the previous version until they restart');
    // Output is hidden by default after a successful run.
    expect(screen.queryByTestId('settings-claude-cli-output')).toBeNull();
  });

  it('when installMethod is unknown: no update button, shows the manual command instead', () => {
    applyProviderCliStatus(
      base({ updateAvailable: true, latestVersion: '2.0.0', installMethod: 'unknown', canUpdate: false }),
    );
    render(<ProviderCliVersion port={31415} adapterId="claude" />);

    expect(screen.queryByTestId('settings-claude-cli-update-button')).toBeNull();
    expect(screen.getByTestId('settings-claude-cli-manual-command')).toHaveTextContent('brew upgrade claude-code');
    expect(screen.getByText(/can't tell how this CLI was installed/)).toBeTruthy();
  });

  it('checkFailed renders a muted line, no destructive banner', () => {
    applyProviderCliStatus(base({ checkFailed: true }));
    render(<ProviderCliVersion port={31415} adapterId="claude" />);
    const line = screen.getByText('Couldn’t check for updates');
    expect(line.className).toContain('text-muted-foreground');
  });

  it('Check for updates calls the check API and disables itself while pending', async () => {
    applyProviderCliStatus(base());
    let resolveCheck!: (v: ProviderCliStatus) => void;
    checkProviderCliUpdate.mockReturnValue(new Promise((resolve) => (resolveCheck = resolve)));
    render(<ProviderCliVersion port={31415} adapterId="claude" />);

    const checkButton = screen.getByTestId('settings-claude-cli-check-button');
    fireEvent.click(checkButton);
    expect(checkProviderCliUpdate).toHaveBeenCalledWith('claude', 31415);
    expect(checkButton).toBeDisabled();

    resolveCheck(base({ latestVersion: '3.0.0', updateAvailable: true }));
    await waitFor(() => expect(useCliUpdateStore.getState().byId.claude!.latestVersion).toBe('3.0.0'));
  });
});
