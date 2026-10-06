import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings';

const FRESH = {
  activeTab: 'general' as const,
  selectedProvider: null,
  providers: {},
  general: useSettingsStore.getState().general,
  loading: false,
};

beforeEach(() => useSettingsStore.setState({ ...FRESH }));

describe('settings store', () => {
  // `isOpen`/`open`/`close` are gone (D2): the store is just the tab/
  // selection owner now — `ui-prefs.sidebarView` decides whether Settings is
  // showing.
  it('loadProviders + setProviderConfig optimistic patch', () => {
    useSettingsStore.getState().loadProviders({ claude: { defaultModel: 'opus' } });
    useSettingsStore.getState().setProviderConfig('claude', { defaultModel: 'sonnet' });
    expect(useSettingsStore.getState().providers['claude']).toEqual({ defaultModel: 'sonnet' });
  });
  it('setNotifications replaces the notifications sub-object only', () => {
    const before = useSettingsStore.getState().general.worktreeDir;
    const next = { ...useSettingsStore.getState().general.notifications };
    useSettingsStore.getState().setNotifications(next);
    expect(useSettingsStore.getState().general.worktreeDir).toBe(before);
    expect(useSettingsStore.getState().general.notifications).toBe(next);
  });
  it('setActiveTab and setSelectedProvider update independently', () => {
    useSettingsStore.getState().setActiveTab('remote-access');
    useSettingsStore.getState().setSelectedProvider('codex');
    const s = useSettingsStore.getState();
    expect(s.activeTab).toBe('remote-access');
    expect(s.selectedProvider).toBe('codex');
  });
});
