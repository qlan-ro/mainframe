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
  models: [
    { id: 'opus', label: 'Opus', isDefault: true, supportedEfforts: ['low', 'high'], defaultEffort: 'medium' },
    { id: 'sonnet', label: 'Sonnet', supportedEfforts: ['low', 'high'], defaultEffort: 'medium' },
  ],
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
  it('clearing the executable path sends "" (the daemon clear sentinel) — not undefined', () => {
    // Seed the store with an existing path so there is something to clear.
    useSettingsStore.setState({
      providers: { claude: { executablePath: '/old/claude' } },
      selectedProvider: 'claude',
    });
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    const input = screen.getByTestId('settings-claude-executable-path-input');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    // The PUT body must carry '' (the sentinel the daemon uses to delete the key),
    // not undefined (which JSON.stringify drops, making the clear a no-op).
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { executablePath: '' });
  });
  it('two rapid updates preserve both fields optimistically (no stale config closure)', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    // First update: toggle system prompt on
    fireEvent.click(screen.getByTestId('settings-claude-system-prompt-toggle'));
    // Second update immediately after (before re-render): toggle plan mode on
    fireEvent.click(screen.getByTestId('settings-claude-plan-mode-toggle'));
    // Both fields must be present in the optimistic store — neither overwrites the other
    const { providers } = useSettingsStore.getState();
    expect(providers.claude?.systemPrompt).toBe('enabled');
    expect(providers.claude?.defaultPlanMode).toBe('true');
  });
  it('selecting a default session mode PUTs defaultMode (radio-group primitive)', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    fireEvent.click(screen.getByTestId('settings-claude-mode-option-yolo'));
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { defaultMode: 'yolo' });
  });
  it('the systemPrompt toggle (switch primitive) PUTs enabled on, and clears with "" off (D-C)', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    const toggle = screen.getByTestId('settings-claude-system-prompt-toggle');
    fireEvent.click(toggle); // off → on
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { systemPrompt: 'enabled' });
    fireEvent.click(toggle); // on → off, '' clears the key per the route contract
    expect(updateProviderSettings).toHaveBeenLastCalledWith(31415, 'claude', { systemPrompt: '' });
  });
  it('the plan-mode toggle (switch primitive) PUTs defaultPlanMode true/false', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    fireEvent.click(screen.getByTestId('settings-claude-plan-mode-toggle'));
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { defaultPlanMode: 'true' });
  });
  it('selecting a default effort PUTs defaultEffort (select primitive)', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    fireEvent.click(screen.getByTestId('settings-claude-default-effort'));
    fireEvent.click(screen.getByTestId('settings-claude-default-effort-option-high'));
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { defaultEffort: 'high' });
  });
  it('choosing a default model PUTs defaultModel (dropdown-menu primitive)', () => {
    render(<ProviderConfigForm port={31415} adapterId="claude" label="Claude" adapter={adapter} />);
    // Radix DropdownMenu opens on pointer events (a real mouse click fires these too).
    const trigger = screen.getByTestId('settings-claude-model-dropdown-trigger');
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.pointerUp(trigger);
    fireEvent.click(screen.getByTestId('settings-claude-model-option-sonnet'));
    expect(updateProviderSettings).toHaveBeenCalledWith(31415, 'claude', { defaultModel: 'sonnet' });
  });
});
