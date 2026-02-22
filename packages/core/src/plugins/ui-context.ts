import path from 'node:path';
import type { PluginUIContext, PluginPanelSpec } from '@mainframe/types';
import type { DaemonEvent } from '@mainframe/types';

export function createPluginUIContext(
  pluginId: string,
  pluginDir: string,
  emitEvent: (event: DaemonEvent) => void,
): PluginUIContext {
  return {
    addPanel(spec: PluginPanelSpec): void {
      const absoluteEntryPoint = path.resolve(pluginDir, spec.entryPoint);
      emitEvent({
        type: 'plugin.panel.registered',
        pluginId,
        panelId: spec.id,
        label: spec.label,
        icon: spec.icon,
        position: spec.position,
        entryPoint: absoluteEntryPoint,
      });
    },

    removePanel(panelId: string): void {
      emitEvent({
        type: 'plugin.panel.unregistered',
        pluginId,
        panelId,
      });
    },

    notify(options): void {
      emitEvent({
        type: 'plugin.notification',
        pluginId,
        title: options.title,
        body: options.body,
        level: options.level,
      });
    },
  };
}
