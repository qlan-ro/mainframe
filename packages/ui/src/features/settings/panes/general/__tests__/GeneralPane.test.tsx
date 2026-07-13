import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GeneralPane } from '../GeneralPane';
import { useSettingsStore } from '../../../../../store/settings';
import { useTheme } from '../../../../../store/theme';

const updateGeneralSettings = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../../lib/api/settings', () => ({
  updateGeneralSettings: (...a: unknown[]) => updateGeneralSettings(...a),
}));

beforeEach(() => {
  useSettingsStore.setState({
    general: {
      worktreeDir: '.worktrees',
      notifications: useSettingsStore.getState().general.notifications,
      updateChannel: 'stable',
    },
  });
  updateGeneralSettings.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('GeneralPane', () => {
  it('renders a top-level "General" pane heading (StgHeading parity — was entirely missing)', () => {
    render(<GeneralPane port={31415} />);
    expect(screen.getByRole('heading', { name: 'General', level: 2 })).toBeInTheDocument();
  });
  it('Save button appears only when worktreeDir is dirty and PUTs on click', async () => {
    render(<GeneralPane port={31415} />);
    expect(screen.queryByTestId('settings-worktree-dir-save')).toBeNull();
    fireEvent.change(screen.getByTestId('settings-worktree-dir-input'), { target: { value: 'wt' } });
    fireEvent.click(screen.getByTestId('settings-worktree-dir-save'));
    expect(updateGeneralSettings).toHaveBeenCalledWith(31415, { worktreeDir: 'wt' });
  });
  it('Save button is flex-centered to match the remote-access button pattern (Preflight resets line-height)', () => {
    render(<GeneralPane port={31415} />);
    fireEvent.change(screen.getByTestId('settings-worktree-dir-input'), { target: { value: 'wt' } });
    const saveButton = screen.getByTestId('settings-worktree-dir-save');
    expect(saveButton.className).toContain('inline-flex');
    expect(saveButton.className).toContain('items-center');
    expect(saveButton.className).toContain('justify-center');
  });
  it('mode toggle writes useTheme without any PUT', () => {
    useTheme.setState({ mode: 'light' });
    render(<GeneralPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-appearance-mode-dark'));
    expect(useTheme.getState().mode).toBe('dark');
    expect(updateGeneralSettings).not.toHaveBeenCalled();
  });
  it('scheme picker writes useTheme.scheme', () => {
    render(<GeneralPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-appearance-scheme-ocean'));
    expect(useTheme.getState().scheme).toBe('ocean');
  });
  it('window-style picker writes useTheme.windowStyle', () => {
    render(<GeneralPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-appearance-window-style-glass'));
    expect(useTheme.getState().windowStyle).toBe('glass');
  });
  it('UI size picker writes useTheme.uiScale', () => {
    useTheme.setState({ uiScale: 'normal' });
    render(<GeneralPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-appearance-ui-scale-large'));
    expect(useTheme.getState().uiScale).toBe('large');
    expect(updateGeneralSettings).not.toHaveBeenCalled();
  });

  describe('update channel', () => {
    it('renders the current channel as selected', () => {
      render(<GeneralPane port={31415} />);
      expect(screen.getByTestId('settings-updates-channel-stable').className).toContain('bg-accent text-foreground');
      expect(screen.getByTestId('settings-updates-channel-prerelease').className).not.toContain(
        'bg-accent text-foreground',
      );
    });

    it('selecting Pre-release PUTs the patch and updates the displayed selection optimistically', async () => {
      render(<GeneralPane port={31415} />);
      fireEvent.click(screen.getByTestId('settings-updates-channel-prerelease'));
      expect(updateGeneralSettings).toHaveBeenCalledWith(31415, { updateChannel: 'prerelease' });
      await waitFor(() => {
        expect(screen.getByTestId('settings-updates-channel-prerelease').className).toContain(
          'bg-accent text-foreground',
        );
      });
      expect(screen.getByTestId('settings-updates-channel-stable').className).not.toContain(
        'bg-accent text-foreground',
      );
    });
  });
});
