import { describe, it, expect, vi } from 'vitest';
import { createPluginUIContext } from '../../plugins/ui-context.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

describe('PluginUIContext', () => {
  it('returns a panelId from addPanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const panelId = ui.addPanel({ zone: 'left-panel', label: 'My Panel' });
    expect(panelId).toBe('my-plugin:left-panel');
  });

  it('emits correct zone, label, and panelId on addPanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    ui.addPanel({ zone: 'right-panel', label: 'My Panel', icon: 'star' });
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.panel.registered',
      pluginId: 'my-plugin',
      panelId: 'my-plugin:right-panel',
      zone: 'right-panel',
      label: 'My Panel',
      icon: 'star',
    });
  });

  it('emits panel.unregistered with panelId when specific panel removed', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const panelId = ui.addPanel({ zone: 'left-panel', label: 'LP' });
    ui.removePanel(panelId);
    expect(emitEvent).toHaveBeenLastCalledWith({
      type: 'plugin.panel.unregistered',
      pluginId: 'my-plugin',
      panelId: 'my-plugin:left-panel',
    });
  });

  it('emits unregistered for all panels when removePanel called without id', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    ui.addPanel({ zone: 'left-panel', label: 'LP' });
    ui.addPanel({ zone: 'right-panel', label: 'RP' });
    emitEvent.mockClear();
    ui.removePanel();
    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.panel.unregistered', panelId: 'my-plugin:left-panel' }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.panel.unregistered', panelId: 'my-plugin:right-panel' }),
    );
  });

  it('emits notification on notify', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    ui.notify({ title: 'Hello', body: 'World', level: 'info' });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.notification', pluginId: 'my-plugin', title: 'Hello' }),
    );
  });
});

describe('createPluginUIContext', () => {
  it('addAction emits plugin.action.registered event', () => {
    const emitEvent = vi.fn<(event: DaemonEvent) => void>();
    const ui = createPluginUIContext('todos', emitEvent);

    ui.addAction({ id: 'quick-create', label: 'New Task', shortcut: 'mod+t', icon: 'plus' });

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.action.registered',
      pluginId: 'todos',
      actionId: 'quick-create',
      label: 'New Task',
      shortcut: 'mod+t',
      icon: 'plus',
    });
  });

  it('removeAction emits plugin.action.unregistered event', () => {
    const emitEvent = vi.fn<(event: DaemonEvent) => void>();
    const ui = createPluginUIContext('todos', emitEvent);

    ui.removeAction('quick-create');

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.action.unregistered',
      pluginId: 'todos',
      actionId: 'quick-create',
    });
  });
});
