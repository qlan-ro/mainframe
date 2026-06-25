import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings';

const FRESH = {
  isOpen: false,
  activeTab: 'general' as const,
  selectedProvider: null,
  providers: {},
  general: useSettingsStore.getState().general,
  loading: false,
};

beforeEach(() => useSettingsStore.setState({ ...FRESH }));

describe('settings store', () => {
  it('open() with no args opens to general', () => {
    useSettingsStore.getState().open();
    const s = useSettingsStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.activeTab).toBe('general');
    expect(s.selectedProvider).toBeNull();
  });
  it('open(provider) opens to providers tab with that provider selected', () => {
    useSettingsStore.getState().open('claude');
    const s = useSettingsStore.getState();
    expect(s.activeTab).toBe('providers');
    expect(s.selectedProvider).toBe('claude');
  });
  it('open(undefined, tab) honors an explicit tab', () => {
    useSettingsStore.getState().open(undefined, 'about');
    expect(useSettingsStore.getState().activeTab).toBe('about');
  });
  it('close() clears isOpen', () => {
    useSettingsStore.getState().open();
    useSettingsStore.getState().close();
    expect(useSettingsStore.getState().isOpen).toBe(false);
  });
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
