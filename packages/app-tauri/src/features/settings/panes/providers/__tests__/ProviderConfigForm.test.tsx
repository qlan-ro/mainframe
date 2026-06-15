import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderConfigForm } from '../ProviderConfigForm';
import { useSettingsStore } from '../../../../../store/settings';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

const updateProviderSettings = vi.fn().mockResolvedValue(undefined);
const getConfigConflicts = vi.fn().mockResolvedValue([]);
vi.mock('../../../../../lib/api/settings', () => ({
  updateProviderSettings: (...a: unknown[]) => updateProviderSettings(...a),
  getConfigConflicts: (...a: unknown[]) => getConfigConflicts(...a),
}));

const adapter = {
  id: 'claude',
  label: 'Claude',
  capabilities: { planMode: true },
  models: [{ id: 'opus', isDefault: true, supportedEfforts: [], defaultEffort: 'medium' }],
} as unknown as AdapterInfo;

beforeEach(() => {
  useSettingsStore.setState({ providers: {}, selectedProvider: 'claude' });
  updateProviderSettings.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('ProviderConfigForm', () => {
  it('editing the executable path commits one PUT on blur (not per keystroke)', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    const input = screen.getByTestId('settings-claude-executable-path-input');
    fireEvent.change(input, { target: { value: '/bin/claude' } });
    expect(updateProviderSettings).not.toHaveBeenCalled(); // no per-keystroke PUT
    fireEvent.blur(input);
    expect(updateProviderSettings).toHaveBeenCalledTimes(1);
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { executablePath: '/bin/claude' });
    expect(useSettingsStore.getState().providers.claude?.executablePath).toBe('/bin/claude');
  });
  it('selecting a default session mode PUTs defaultMode', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    fireEvent.click(screen.getByTestId('settings-claude-mode-option-yolo'));
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { defaultMode: 'yolo' });
  });
  it('the systemPrompt toggle PUTs enabled on, and clears with "" off (D-C)', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    const toggle = screen.getByTestId('settings-claude-system-prompt-toggle');
    fireEvent.click(toggle); // off → on
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { systemPrompt: 'enabled' });
    fireEvent.click(toggle); // on → off, '' clears the key per the route contract
    expect(updateProviderSettings).toHaveBeenLastCalledWith(31415, 'claude', { systemPrompt: '' });
  });
});
