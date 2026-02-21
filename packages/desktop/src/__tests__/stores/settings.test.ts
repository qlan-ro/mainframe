import { describe, it, expect, beforeEach } from 'vitest';
import type { ProviderConfig } from '@mainframe/types';
import { GENERAL_DEFAULTS } from '@mainframe/types';
import { useSettingsStore } from '../../renderer/store/settings.js';
import type { SettingsTab } from '../../renderer/store/settings.js';

function resetStore(): void {
  useSettingsStore.setState({
    isOpen: false,
    activeTab: 'general',
    selectedProvider: null,
    providers: {},
    general: { ...GENERAL_DEFAULTS },
    loading: false,
  });
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts closed', () => {
      expect(useSettingsStore.getState().isOpen).toBe(false);
    });

    it('starts with general as activeTab', () => {
      expect(useSettingsStore.getState().activeTab).toBe('general');
    });

    it('starts with null selectedProvider', () => {
      expect(useSettingsStore.getState().selectedProvider).toBeNull();
    });

    it('starts with empty providers', () => {
      expect(useSettingsStore.getState().providers).toEqual({});
    });

    it('starts with loading false', () => {
      expect(useSettingsStore.getState().loading).toBe(false);
    });
  });

  describe('open', () => {
    it('opens the settings modal', () => {
      useSettingsStore.getState().open();
      expect(useSettingsStore.getState().isOpen).toBe(true);
    });

    it('defaults to general tab when no provider specified', () => {
      useSettingsStore.getState().open();
      expect(useSettingsStore.getState().activeTab).toBe('general');
      expect(useSettingsStore.getState().selectedProvider).toBeNull();
    });

    it('switches to providers tab when a default provider is given', () => {
      useSettingsStore.getState().open('claude');
      expect(useSettingsStore.getState().activeTab).toBe('providers');
      expect(useSettingsStore.getState().selectedProvider).toBe('claude');
    });

    it('opens directly to a given tab', () => {
      useSettingsStore.getState().open(undefined, 'about');
      expect(useSettingsStore.getState().isOpen).toBe(true);
      expect(useSettingsStore.getState().activeTab).toBe('about');
      expect(useSettingsStore.getState().selectedProvider).toBeNull();
    });

    it('tab param takes precedence over defaultProvider', () => {
      useSettingsStore.getState().open('claude', 'about');
      expect(useSettingsStore.getState().activeTab).toBe('about');
      expect(useSettingsStore.getState().selectedProvider).toBe('claude');
    });
  });

  describe('close', () => {
    it('closes the settings modal', () => {
      useSettingsStore.getState().open();
      useSettingsStore.getState().close();
      expect(useSettingsStore.getState().isOpen).toBe(false);
    });
  });

  describe('setActiveTab', () => {
    it('changes the active tab', () => {
      const tabs: SettingsTab[] = ['providers', 'general', 'keybindings', 'about'];
      for (const tab of tabs) {
        useSettingsStore.getState().setActiveTab(tab);
        expect(useSettingsStore.getState().activeTab).toBe(tab);
      }
    });
  });

  describe('setSelectedProvider', () => {
    it('sets the selected provider', () => {
      useSettingsStore.getState().setSelectedProvider('claude');
      expect(useSettingsStore.getState().selectedProvider).toBe('claude');
    });

    it('clears the selected provider with null', () => {
      useSettingsStore.getState().setSelectedProvider('claude');
      useSettingsStore.getState().setSelectedProvider(null);
      expect(useSettingsStore.getState().selectedProvider).toBeNull();
    });
  });

  describe('setProviderConfig', () => {
    it('sets a provider config by adapterId', () => {
      const config: ProviderConfig = { defaultModel: 'opus', defaultMode: 'default' };
      useSettingsStore.getState().setProviderConfig('claude', config);
      expect(useSettingsStore.getState().providers['claude']).toEqual(config);
    });

    it('merges with existing providers without overwriting others', () => {
      useSettingsStore.getState().setProviderConfig('claude', { defaultModel: 'opus' });
      useSettingsStore.getState().setProviderConfig('gemini', { defaultModel: 'pro' });
      expect(useSettingsStore.getState().providers['claude']).toEqual({ defaultModel: 'opus' });
      expect(useSettingsStore.getState().providers['gemini']).toEqual({ defaultModel: 'pro' });
    });

    it('replaces an existing provider config', () => {
      useSettingsStore.getState().setProviderConfig('claude', { defaultModel: 'opus' });
      useSettingsStore.getState().setProviderConfig('claude', { defaultModel: 'sonnet' });
      expect(useSettingsStore.getState().providers['claude']!.defaultModel).toBe('sonnet');
    });
  });

  describe('loadProviders', () => {
    it('replaces all providers at once', () => {
      useSettingsStore.getState().setProviderConfig('old', { defaultModel: 'old' });
      const newProviders: Record<string, ProviderConfig> = {
        claude: { defaultModel: 'opus' },
        gemini: { defaultModel: 'pro' },
      };
      useSettingsStore.getState().loadProviders(newProviders);
      expect(useSettingsStore.getState().providers).toEqual(newProviders);
      expect(useSettingsStore.getState().providers['old']).toBeUndefined();
    });
  });

  describe('setLoading', () => {
    it('sets loading state', () => {
      useSettingsStore.getState().setLoading(true);
      expect(useSettingsStore.getState().loading).toBe(true);
      useSettingsStore.getState().setLoading(false);
      expect(useSettingsStore.getState().loading).toBe(false);
    });
  });
});
