import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProvidersPane } from '../ProvidersPane';
import { useSettingsStore } from '../../../../../store/settings';
import { seedAdapters, resetAdapters } from '../../../../../store/adapters';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { onEvent: () => () => {} } }));
const updateGeneralSettings = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../../lib/api/settings', () => ({
  updateProviderSettings: vi.fn().mockResolvedValue(undefined),
  getConfigConflicts: vi.fn().mockResolvedValue([]),
  updateGeneralSettings: (...a: unknown[]) => updateGeneralSettings(...a),
}));

const claudeAdapter = {
  id: 'claude',
  name: 'Claude',
  description: '',
  installed: true,
  capabilities: { planMode: true },
  models: [{ id: 'opus', label: 'Opus', isDefault: true }],
} as unknown as AdapterInfo;

const geminiAdapter = {
  id: 'gemini',
  name: 'Gemini',
  description: '',
  installed: false,
  capabilities: { planMode: false },
  models: [],
} as unknown as AdapterInfo;

beforeEach(() => {
  useSettingsStore.setState({
    providers: {},
    selectedProvider: 'claude',
    general: { ...useSettingsStore.getState().general, defaultAdapterId: null },
  });
  resetAdapters();
});
afterEach(() => vi.clearAllMocks());

describe('ProvidersPane header', () => {
  it('renders an avatar tile with the provider initial and "Detected on PATH" when installed', async () => {
    seedAdapters([claudeAdapter]);
    render(<ProvidersPane port={31415} />);
    const header = await screen.findByTestId('settings-provider-header-claude');
    expect(header).toHaveTextContent('C');
    expect(header).toHaveTextContent('Claude');
    expect(header).toHaveTextContent('Detected on PATH');
  });

  it('shows "Not installed" status when the adapter is not installed', async () => {
    useSettingsStore.setState({ providers: {}, selectedProvider: 'gemini' });
    seedAdapters([geminiAdapter]);
    render(<ProvidersPane port={31415} />);
    const header = await screen.findByTestId('settings-provider-header-gemini');
    await waitFor(() => expect(header).toHaveTextContent('Not installed'));
  });
});

describe('ProvidersPane — default provider picker', () => {
  it('lists only installed adapters plus an "Auto" option', () => {
    seedAdapters([claudeAdapter, geminiAdapter]);
    render(<ProvidersPane port={31415} />);
    const select = screen.getByTestId('settings-default-provider-select') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['', 'claude']);
  });

  it('reflects the stored defaultAdapterId as the selected value', () => {
    useSettingsStore.setState({ general: { ...useSettingsStore.getState().general, defaultAdapterId: 'claude' } });
    seedAdapters([claudeAdapter]);
    render(<ProvidersPane port={31415} />);
    const select = screen.getByTestId('settings-default-provider-select') as HTMLSelectElement;
    expect(select.value).toBe('claude');
  });

  it('selecting a provider PUTs the patch and updates the store optimistically', async () => {
    seedAdapters([claudeAdapter]);
    render(<ProvidersPane port={31415} />);
    const select = screen.getByTestId('settings-default-provider-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'claude' } });
    expect(updateGeneralSettings).toHaveBeenCalledWith(31415, { defaultAdapterId: 'claude' });
    await waitFor(() => expect(useSettingsStore.getState().general.defaultAdapterId).toBe('claude'));
  });

  it('selecting "Auto" clears the setting back to null', async () => {
    useSettingsStore.setState({ general: { ...useSettingsStore.getState().general, defaultAdapterId: 'claude' } });
    seedAdapters([claudeAdapter]);
    render(<ProvidersPane port={31415} />);
    const select = screen.getByTestId('settings-default-provider-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(updateGeneralSettings).toHaveBeenCalledWith(31415, { defaultAdapterId: null });
    await waitFor(() => expect(useSettingsStore.getState().general.defaultAdapterId).toBeNull());
  });
});
