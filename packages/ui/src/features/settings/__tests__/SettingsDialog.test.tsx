import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SettingsDialog } from '../SettingsDialog';
import { useSettingsStore } from '../../../store/settings';

// Stub the API the dialog fires on open so no real fetch runs.
vi.mock('../../../lib/api/settings', () => ({
  getProviderSettings: vi.fn().mockResolvedValue({}),
  getGeneralSettings: vi.fn().mockResolvedValue({ worktreeDir: '.worktrees', notifications: {} }),
}));
vi.mock('../../../lib/api/adapters', () => ({ getAdapters: vi.fn().mockResolvedValue([]) }));

beforeEach(() =>
  useSettingsStore.setState({
    isOpen: false,
    activeTab: 'general',
    selectedProvider: null,
    providers: {},
    loading: false,
  }),
);
afterEach(() => vi.clearAllMocks());

describe('SettingsDialog', () => {
  it('renders nothing interactive when closed', () => {
    render(<SettingsDialog port={31415} />);
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
  });
  it('renders the dialog and nav rows when open', async () => {
    render(<SettingsDialog port={31415} />);
    await act(async () => {
      useSettingsStore.getState().open();
    });
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-general')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-providers')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-nav-keybindings')).toBeNull(); // S4 dropped
  });
  it('clicking a nav row routes the content pane', async () => {
    render(<SettingsDialog port={31415} />);
    await act(async () => {
      useSettingsStore.getState().open();
    });
    fireEvent.click(screen.getByTestId('settings-nav-about'));
    expect(screen.getByTestId('settings-pane-about')).toBeInTheDocument();
  });
  it('close button closes the dialog', async () => {
    render(<SettingsDialog port={31415} />);
    await act(async () => {
      useSettingsStore.getState().open();
    });
    fireEvent.click(screen.getByTestId('settings-dialog-close'));
    expect(useSettingsStore.getState().isOpen).toBe(false);
  });
});
