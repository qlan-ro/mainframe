import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderSection } from '../ProviderSection';
import { useSettingsStore } from '../../../store/settings';

const { updateProviderSettings, adaptersState } = vi.hoisted(() => ({
  updateProviderSettings: vi.fn().mockResolvedValue(undefined),
  adaptersState: {
    adapters: [{ id: 'claude', name: 'Claude', capabilities: { planMode: true }, models: [] }],
  },
}));

vi.mock('../../../lib/api', () => ({
  getConfigConflicts: vi.fn().mockResolvedValue([]),
  updateProviderSettings,
}));

vi.mock('../../../store/adapters', () => ({
  useAdaptersStore: (selector: (state: typeof adaptersState) => unknown) => selector(adaptersState),
}));

vi.mock('../../DirectoryPickerModal', () => ({
  DirectoryPickerModal: ({
    open,
    mode,
    onSelect,
    onCancel,
  }: {
    open: boolean;
    mode?: string;
    onSelect: (path: string) => void;
    onCancel: () => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="dir-picker-modal" data-mode={mode}>
        <button type="button" onClick={() => onSelect('/usr/bin/claude')}>
          Pick
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  },
}));

describe('ProviderSection — executable path', () => {
  beforeEach(() => {
    updateProviderSettings.mockClear();
    adaptersState.adapters = [{ id: 'claude', name: 'Claude', capabilities: { planMode: true }, models: [] }];
    useSettingsStore.setState({
      isOpen: false,
      activeTab: 'providers',
      selectedProvider: 'claude',
      providers: {},
      general: {
        worktreeDir: '.worktrees',
        notifications: {
          chat: { taskComplete: true, sessionError: true },
          permission: { toolRequest: true, userQuestion: true, planApproval: true },
          other: { plugin: true },
        },
      },
      loading: false,
    });
  });

  it('prefills input with executablePath and hides the not-found message when valid config', () => {
    useSettingsStore.setState({
      providers: {
        claude: {
          executablePath: '/opt/homebrew/bin/claude',
          resolvedExecutable: { path: '/opt/homebrew/bin/claude', source: 'config', valid: true },
        },
      },
    });

    render(<ProviderSection adapterId="claude" label="Claude" />);

    const input = screen.getByPlaceholderText('claude') as HTMLInputElement;
    expect(input.value).toBe('/opt/homebrew/bin/claude');
    expect(screen.queryByText(/not found on path/i)).toBeNull();
  });

  it('shows not-found message when source is fallback', () => {
    useSettingsStore.setState({
      providers: {
        claude: {
          executablePath: '',
          resolvedExecutable: { path: 'claude', source: 'fallback', valid: false },
        },
      },
    });

    render(<ProviderSection adapterId="claude" label="Claude" />);

    expect(screen.getByText(/not found on path — browse to select the binary/i)).toBeInTheDocument();
  });

  it('Browse button opens DirectoryPickerModal with mode=file and persists selection via update', async () => {
    useSettingsStore.setState({
      providers: {
        claude: {
          executablePath: '',
          resolvedExecutable: { path: 'claude', source: 'fallback', valid: false },
        },
      },
    });

    render(<ProviderSection adapterId="claude" label="Claude" />);

    fireEvent.click(screen.getByRole('button', { name: /browse/i }));

    const modal = await screen.findByTestId('dir-picker-modal');
    expect(modal).toHaveAttribute('data-mode', 'file');

    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));

    await waitFor(() => {
      expect(updateProviderSettings).toHaveBeenCalledWith('claude', { executablePath: '/usr/bin/claude' });
    });
    expect(useSettingsStore.getState().providers.claude?.executablePath).toBe('/usr/bin/claude');
  });
});
