import type { PluginUIContext, UIZone, DaemonEvent } from '@qlan-ro/mainframe-types';

interface PanelInfo {
  panelId: string;
  zone: UIZone;
  label: string;
  icon?: string;
}

export function createPluginUIContext(pluginId: string, emitEvent: (event: DaemonEvent) => void): PluginUIContext {
  const panels = new Map<string, PanelInfo>();

  return {
    addPanel({ zone, label, icon }: { zone: UIZone; label: string; icon?: string }): string {
      const panelId = `${pluginId}:${zone}`;
      panels.set(panelId, { panelId, zone, label, icon });
      emitEvent({
        type: 'plugin.panel.registered',
        pluginId,
        panelId,
        zone,
        label,
        icon,
      });
      return panelId;
    },

    removePanel(panelId?: string): void {
      if (panelId) {
        panels.delete(panelId);
        emitEvent({
          type: 'plugin.panel.unregistered',
          pluginId,
          panelId,
        });
      } else {
        for (const id of panels.keys()) {
          emitEvent({
            type: 'plugin.panel.unregistered',
            pluginId,
            panelId: id,
          });
        }
        panels.clear();
      }
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
