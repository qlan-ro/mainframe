/**
 * SettingsSidebar — "Providers" nav auto-select regression test.
 *
 * Bug: clicking the top-level "Providers" nav item only set `activeTab`, never
 * `selectedProvider`, so `ProvidersPane` rendered its blank state ("Select a
 * provider from the sidebar to configure it.") until the user picked a specific
 * provider underneath. Fix: clicking "Providers" with no provider selected yet
 * auto-selects the first installed adapter (falling back to the first adapter),
 * mirroring the fallback chain in `ProviderModelSelect.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsSidebar } from '../SettingsSidebar';
import { useSettingsStore } from '../../../store/settings';
import { seedAdapters, resetAdapters } from '../../../store/adapters';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { onEvent: () => () => {} } }));

const geminiAdapter = {
  id: 'gemini',
  name: 'Gemini',
  description: '',
  installed: false,
  capabilities: { planMode: false },
  models: [],
} as unknown as AdapterInfo;

const claudeAdapter = {
  id: 'claude',
  name: 'Claude',
  description: '',
  installed: true,
  capabilities: { planMode: true },
  models: [],
} as unknown as AdapterInfo;

beforeEach(() => {
  useSettingsStore.setState({ activeTab: 'general', selectedProvider: null });
  resetAdapters();
});
afterEach(() => vi.clearAllMocks());

describe('SettingsSidebar — Providers nav auto-select', () => {
  it('auto-selects the first installed adapter when clicking Providers with none selected', () => {
    seedAdapters([geminiAdapter, claudeAdapter]);
    render(<SettingsSidebar />);
    fireEvent.click(screen.getByTestId('settings-nav-providers'));
    expect(useSettingsStore.getState().selectedProvider).toBe('claude');
  });

  it('falls back to the first adapter when none are installed', () => {
    seedAdapters([geminiAdapter]);
    render(<SettingsSidebar />);
    fireEvent.click(screen.getByTestId('settings-nav-providers'));
    expect(useSettingsStore.getState().selectedProvider).toBe('gemini');
  });

  it('does not override an already-selected provider', () => {
    useSettingsStore.setState({ selectedProvider: 'gemini' });
    seedAdapters([geminiAdapter, claudeAdapter]);
    render(<SettingsSidebar />);
    fireEvent.click(screen.getByTestId('settings-nav-providers'));
    expect(useSettingsStore.getState().selectedProvider).toBe('gemini');
  });

  it('does not touch selectedProvider when clicking a different tab', () => {
    seedAdapters([claudeAdapter]);
    render(<SettingsSidebar />);
    fireEvent.click(screen.getByTestId('settings-nav-about'));
    expect(useSettingsStore.getState().selectedProvider).toBeNull();
  });
});

describe('SettingsSidebar — Chat tab', () => {
  it('lists Chat right after General', () => {
    render(<SettingsSidebar />);
    const ids = screen.getAllByTestId(/^settings-nav-/).map((el) => el.getAttribute('data-testid'));
    expect(ids.slice(0, 3)).toEqual(['settings-nav-general', 'settings-nav-chat', 'settings-nav-providers']);
    expect(screen.getByTestId('settings-nav-chat')).toHaveTextContent('Chat');
  });

  it('opens the Chat tab when clicked', () => {
    render(<SettingsSidebar />);
    fireEvent.click(screen.getByTestId('settings-nav-chat'));
    expect(useSettingsStore.getState().activeTab).toBe('chat');
  });
});
