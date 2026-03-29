import type { PluginUIContext, UIZone, DaemonEvent } from '@qlan-ro/mainframe-types';

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

    addAction({ id, label, shortcut, icon }: { id: string; label: string; shortcut: string; icon?: string }): void {
      emitEvent({
        type: 'plugin.action.registered',
        pluginId,
        actionId: id,
        label,
        shortcut,
        icon,
      });
    },

    removeAction(id: string): void {
      emitEvent({
        type: 'plugin.action.unregistered',
        pluginId,
        actionId: id,
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
