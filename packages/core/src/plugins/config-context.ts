import type { PluginConfig } from '@mainframe/types';

export function createPluginConfig(
  pluginId: string,
  getSetting: (key: string) => unknown,
  setSetting: (key: string, value: unknown) => void,
): PluginConfig {
  const prefix = `plugin:${pluginId}:`;
  const keys: string[] = [];

  return {
    get(key: string): unknown {
      return getSetting(`${prefix}${key}`);
    },
    set(key: string, value: unknown): void {
      if (!keys.includes(key)) keys.push(key);
      setSetting(`${prefix}${key}`, value);
    },
    getAll(): Record<string, unknown> {
      return Object.fromEntries(keys.map((k) => [k, getSetting(`${prefix}${k}`)]));
    },
  };
}
