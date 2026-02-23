import type { PluginUIContext, UIZone, DaemonEvent } from '@mainframe/types';

export function createPluginUIContext(pluginId: string, emitEvent: (event: DaemonEvent) => void): PluginUIContext {
  return {
    addPanel({ zone, label, icon }: { zone: UIZone; label: string; icon?: string }): void {
      emitEvent({
        type: 'plugin.panel.registered',
        pluginId,
        zone,
        label,
        icon,
      });
    },

    removePanel(): void {
      emitEvent({
        type: 'plugin.panel.unregistered',
        pluginId,
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
