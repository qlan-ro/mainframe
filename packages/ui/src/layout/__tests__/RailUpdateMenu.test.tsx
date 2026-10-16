/**
 * RailUpdateButton with provider CLI updates (todo #405): the same rail button
 * opens a menu listing every pending update. Updatable CLIs start the update
 * in place; failed or manual-only ones open Settings → Providers.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderCliStatus } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { applyProviderCliStatus, resetProviderCliStatuses, useCliUpdateStore } from '@/store/cli-update';
import { useSettingsStore } from '@/store/settings';
import { useUiPrefs } from '@/store/ui-prefs';

let mockAppStatus: { state: string; version?: string } = { state: 'not-available' };
const download = vi.fn();
vi.mock('@/lib/host', () => ({
  useHost: () => ({
    updates: {
      onStatus: (cb: (s: typeof mockAppStatus) => void) => {
        cb(mockAppStatus);
        return Promise.resolve(() => undefined);
      },
      download,
      install: vi.fn(),
    },
  }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
const updateProviderCli = vi.fn();
vi.mock('@/lib/api/cli-update', () => ({
  updateProviderCli: (...a: unknown[]) => updateProviderCli(...a),
}));

import { RailUpdateButton } from '../RailUpdateButton';

const cli = (adapterId: string, overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus => ({
  adapterId,
  installedVersion: '0.155.1',
  latestVersion: '0.163.0',
  updateAvailable: true,
  installMethod: 'homebrew',
  updateCommand: 'brew upgrade --cask codex',
  canUpdate: true,
  checkFailed: false,
  ...overrides,
});

const render_ = () =>
  render(
    <TooltipProvider>
      <RailUpdateButton />
    </TooltipProvider>,
  );

async function openMenu() {
  await userEvent.setup({ delay: null }).click(screen.getByTestId('shell-rail-update'));
  return screen.findByTestId('shell-rail-update-menu');
}

beforeEach(() => {
  mockAppStatus = { state: 'not-available' };
  download.mockClear();
  updateProviderCli.mockReset();
  resetProviderCliStatuses();
  useSettingsStore.setState({ activeTab: 'general', selectedProvider: null });
  useUiPrefs.setState({ sidebarView: 'chats', sidebarVisible: false });
});

describe('RailUpdateButton — provider CLI updates', () => {
  it('stays hidden when neither the app nor a CLI has an update', () => {
    applyProviderCliStatus(cli('codex', { updateAvailable: false }));
    render_();
    expect(screen.queryByTestId('shell-rail-update')).toBeNull();
  });

  it('shows the button with a dot for a CLI update alone', () => {
    applyProviderCliStatus(cli('codex'));
    render_();
    expect(screen.getByTestId('shell-rail-update')).toHaveAccessibleName('An update is available for codex');
    expect(screen.getByTestId('shell-rail-update-dot')).toBeInTheDocument();
  });

  it('lists the app and every CLI update, and starts a CLI update in place', async () => {
    mockAppStatus = { state: 'available', version: '2.11.0' };
    applyProviderCliStatus(cli('codex'));
    updateProviderCli.mockResolvedValue(
      cli('codex', { update: { state: 'running', output: '', startedAt: 1, permissionDenied: false } }),
    );
    render_();
    expect(screen.getByTestId('shell-rail-update')).toHaveAccessibleName('2 updates available');
    await openMenu();
    expect(screen.getByTestId('shell-rail-update-app')).toHaveTextContent('Version 2.11.0 is available');
    expect(screen.getByTestId('shell-rail-update-cli-codex')).toHaveTextContent('0.155.1 → 0.163.0');

    await userEvent.setup({ delay: null }).click(screen.getByTestId('shell-rail-update-cli-codex'));
    expect(updateProviderCli).toHaveBeenCalledWith('codex', 31415);
    await vi.waitFor(() => expect(useCliUpdateStore.getState().byId.codex?.update?.state).toBe('running'));
    expect(download).not.toHaveBeenCalled();
  });

  it('the app row still downloads the app update', async () => {
    mockAppStatus = { state: 'available', version: '2.11.0' };
    applyProviderCliStatus(cli('codex'));
    render_();
    await openMenu();
    await userEvent.setup({ delay: null }).click(screen.getByTestId('shell-rail-update-app'));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('a running CLI update spins the button and disables its row', async () => {
    applyProviderCliStatus(
      cli('codex', { update: { state: 'running', output: '', startedAt: 1, permissionDenied: false } }),
    );
    render_();
    expect(screen.getByTestId('shell-rail-update')).toHaveAccessibleName('Updating codex…');
    await openMenu();
    expect(screen.getByTestId('shell-rail-update-cli-codex')).toHaveAttribute('data-disabled');
  });

  it('a manual-only install opens Settings → Providers instead of running anything', async () => {
    applyProviderCliStatus(cli('claude', { canUpdate: false, installMethod: 'unknown' }));
    render_();
    await openMenu();
    expect(screen.getByTestId('shell-rail-update-cli-claude')).toHaveTextContent('update manually');
    await userEvent.setup({ delay: null }).click(screen.getByTestId('shell-rail-update-cli-claude'));
    expect(updateProviderCli).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().activeTab).toBe('providers');
    expect(useSettingsStore.getState().selectedProvider).toBe('claude');
    expect(useUiPrefs.getState().sidebarView).toBe('settings');
    expect(useUiPrefs.getState().sidebarVisible).toBe(true);
  });

  it('a failed run opens Settings → Providers where the output lives', async () => {
    applyProviderCliStatus(
      cli('codex', {
        update: { state: 'failed', output: 'EACCES', startedAt: 1, finishedAt: 2, permissionDenied: true },
      }),
    );
    render_();
    await openMenu();
    expect(screen.getByTestId('shell-rail-update-cli-codex')).toHaveTextContent('Update failed');
    await userEvent.setup({ delay: null }).click(screen.getByTestId('shell-rail-update-cli-codex'));
    expect(updateProviderCli).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().selectedProvider).toBe('codex');
  });
});
