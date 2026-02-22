import { useState, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';

type PluginPanelAPI = {
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

export function usePluginComponent(entryPoint: string): ComponentType<{ api: PluginPanelAPI }> | null {
  const [Component, setComponent] = useState<ComponentType<{ api: PluginPanelAPI }> | null>(null);
  const loaded = useRef(new Map<string, ComponentType<{ api: PluginPanelAPI }>>());

  useEffect(() => {
    if (loaded.current.has(entryPoint)) {
      setComponent(() => loaded.current.get(entryPoint)!);
      return;
    }
    // Dynamic ESM import — Electron renderer can load file:// paths
    import(/* @vite-ignore */ `file://${entryPoint}`)
      .then((mod: { PanelComponent: ComponentType<{ api: PluginPanelAPI }> }) => {
        loaded.current.set(entryPoint, mod.PanelComponent);
        setComponent(() => mod.PanelComponent);
      })
      .catch((err: unknown) => {
        console.warn(`[plugin] Failed to load ${entryPoint}:`, err);
      });
  }, [entryPoint]);

  return Component;
}
