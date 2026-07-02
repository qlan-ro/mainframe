import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProvidersPane } from '../ProvidersPane';
import { useSettingsStore } from '../../../../../store/settings';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

const getAdapters = vi.fn();
vi.mock('../../../../../lib/api/adapters', () => ({
  getAdapters: (...a: unknown[]) => getAdapters(...a),
}));
vi.mock('../../../../../lib/api/settings', () => ({
  updateProviderSettings: vi.fn().mockResolvedValue(undefined),
  getConfigConflicts: vi.fn().mockResolvedValue([]),
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
  useSettingsStore.setState({ providers: {}, selectedProvider: 'claude' });
  getAdapters.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('ProvidersPane header', () => {
  it('renders an avatar tile with the provider initial and "Detected on PATH" when installed', async () => {
    getAdapters.mockResolvedValue([claudeAdapter]);
    render(<ProvidersPane port={31415} />);
    const header = await screen.findByTestId('settings-provider-header-claude');
    expect(header).toHaveTextContent('C');
    expect(header).toHaveTextContent('Claude');
    expect(header).toHaveTextContent('Detected on PATH');
  });

  it('shows "Not installed" status when the adapter is not installed', async () => {
    useSettingsStore.setState({ providers: {}, selectedProvider: 'gemini' });
    getAdapters.mockResolvedValue([geminiAdapter]);
    render(<ProvidersPane port={31415} />);
    const header = await screen.findByTestId('settings-provider-header-gemini');
    await waitFor(() => expect(header).toHaveTextContent('Not installed'));
  });
});
