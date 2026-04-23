import { nanoid } from 'nanoid';
import type { PluginUIContext, UIZone, DaemonEvent } from '@qlan-ro/mainframe-types';

export function createPluginUIContext(pluginId: string, emitEvent: (event: DaemonEvent) => void): PluginUIContext {
  /** Track live panel ids so removePanel() (no args) can clean them all up. */
  const activePanelIds = new Set<string>();

  return {
    addPanel({ zone, label, icon }: { zone: UIZone; label: string; icon?: string }): string {
      const panelId = nanoid();
      activePanelIds.add(panelId);
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

    removePanel(id?: string): void {
      if (id !== undefined) {
        activePanelIds.delete(id);
        emitEvent({ type: 'plugin.panel.unregistered', pluginId, panelId: id });
      } else {
        // Remove all panels owned by this plugin.
        for (const panelId of activePanelIds) {
          emitEvent({ type: 'plugin.panel.unregistered', pluginId, panelId });
        }
        activePanelIds.clear();
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
