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

describe('ProviderSection — Start in Plan Mode', () => {
  beforeEach(() => {
    updateProviderSettings.mockClear();
    adaptersState.adapters = [{ id: 'claude', name: 'Claude', capabilities: { planMode: true }, models: [] }];
    useSettingsStore.setState({
      isOpen: false,
      activeTab: 'providers',
      selectedProvider: 'claude',
      providers: {},
      general: { worktreeDir: '.worktrees' },
      loading: false,
    });
  });

  it('renders the checkbox only when adapter supports plan mode', async () => {
    render(<ProviderSection adapterId="claude" label="Claude" />);

    expect(await screen.findByLabelText(/start in plan mode/i)).toBeInTheDocument();
  });

  it('writes defaultPlanMode on click', async () => {
    render(<ProviderSection adapterId="claude" label="Claude" />);

    fireEvent.click(await screen.findByLabelText(/start in plan mode/i));

    await waitFor(() => {
      expect(updateProviderSettings).toHaveBeenCalledWith('claude', { defaultPlanMode: 'true' });
    });
    expect(useSettingsStore.getState().providers.claude?.defaultPlanMode).toBe('true');
  });

  it('is hidden for adapters without plan capability', () => {
    adaptersState.adapters = [{ id: 'codex', name: 'Codex', capabilities: { planMode: false }, models: [] }];

    render(<ProviderSection adapterId="codex" label="Codex" />);

    expect(screen.queryByLabelText(/start in plan mode/i)).toBeNull();
  });
});
