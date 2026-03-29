import type React from 'react';

const BUILTIN_GLOBAL_COMPONENTS: Record<string, React.ComponentType> = {};

export function registerBuiltinGlobalComponent(pluginId: string, Component: React.ComponentType): void {
  BUILTIN_GLOBAL_COMPONENTS[pluginId] = Component;
}

export function PluginGlobalComponents(): React.ReactElement | null {
  const entries = Object.entries(BUILTIN_GLOBAL_COMPONENTS);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(([id, Component]) => (
        <Component key={id} />
      ))}
    </>
  );
}
