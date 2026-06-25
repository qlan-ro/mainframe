import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GeneralPane } from '../GeneralPane';
import { useSettingsStore } from '../../../../../store/settings';
import { useTheme } from '../../../../../store/theme';

const updateGeneralSettings = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../../lib/api/settings', () => ({
  updateGeneralSettings: (...a: unknown[]) => updateGeneralSettings(...a),
}));

beforeEach(() => {
  useSettingsStore.setState({
    general: { worktreeDir: '.worktrees', notifications: useSettingsStore.getState().general.notifications },
  });
  updateGeneralSettings.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('GeneralPane', () => {
  it('Save button appears only when worktreeDir is dirty and PUTs on click', async () => {
    render(<GeneralPane port={31415} />);
    expect(screen.queryByTestId('settings-worktree-dir-save')).toBeNull();
    fireEvent.change(screen.getByTestId('settings-worktree-dir-input'), { target: { value: 'wt' } });
    fireEvent.click(screen.getByTestId('settings-worktree-dir-save'));
    expect(updateGeneralSettings).toHaveBeenCalledWith(31415, { worktreeDir: 'wt' });
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
});
