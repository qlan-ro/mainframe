import { describe, it, expect } from 'vitest';
import { createPluginConfig } from '../../plugins/config-context.js';

describe('PluginConfig', () => {
  it('stores and retrieves plugin-namespaced keys', () => {
    const settingsStore = new Map<string, string>();
    const getSetting = (k: string) => (settingsStore.has(k) ? JSON.parse(settingsStore.get(k)!) : undefined);
    const setSetting = (k: string, v: unknown) => settingsStore.set(k, JSON.stringify(v));

    const config = createPluginConfig('my-plugin', getSetting, setSetting);
    config.set('apiKey', 'abc123');
    expect(config.get('apiKey')).toBe('abc123');
    expect(settingsStore.has('plugin:my-plugin:apiKey')).toBe(true);
  });

  it('getAll returns all set keys', () => {
    const store = new Map<string, unknown>();
    const config = createPluginConfig(
      'p',
      (k) => store.get(k),
      (k, v) => store.set(k, v),
    );
    config.set('a', 1);
    config.set('b', 2);
    expect(config.getAll()).toEqual({ a: 1, b: 2 });
  });

  it('namespaces keys to prevent cross-plugin collision', () => {
    const store = new Map<string, unknown>();
    const configA = createPluginConfig(
      'plugin-a',
      (k) => store.get(k),
      (k, v) => store.set(k, v),
    );
    const configB = createPluginConfig(
      'plugin-b',
      (k) => store.get(k),
      (k, v) => store.set(k, v),
    );
    configA.set('key', 'from-a');
    configB.set('key', 'from-b');
    expect(configA.get('key')).toBe('from-a');
    expect(configB.get('key')).toBe('from-b');
  });
});
