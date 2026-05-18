import { describe, it, expect, vi } from 'vitest';
import { createPluginUIContext } from '../../plugins/ui-context.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

describe('PluginUIContext', () => {
  it('addPanel returns a panelId string', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const panelId = ui.addPanel({ zone: 'left-top', label: 'My Panel' });
    expect(typeof panelId).toBe('string');
    expect(panelId.length).toBeGreaterThan(0);
  });

  it('calls emit on addPanel with the panelId', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const panelId = ui.addPanel({ zone: 'left-top', label: 'My Panel' });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.panel.registered', pluginId: 'my-plugin', panelId }),
    );
  });

  it('emits correct zone and label on addPanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const panelId = ui.addPanel({ zone: 'right-top', label: 'My Panel', icon: 'star' });
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.panel.registered',
      pluginId: 'my-plugin',
      panelId,
      zone: 'right-top',
      label: 'My Panel',
      icon: 'star',
    });
  });

  it('multiple addPanel calls return different ids', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const id1 = ui.addPanel({ zone: 'fullview', label: 'Panel A' });
    const id2 = ui.addPanel({ zone: 'right-top', label: 'Panel B' });
    expect(id1).not.toBe(id2);
    expect(emitEvent).toHaveBeenCalledTimes(2);
  });

  it('removePanel(id) removes only that panel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const id1 = ui.addPanel({ zone: 'fullview', label: 'Panel A' });
    ui.addPanel({ zone: 'right-top', label: 'Panel B' });
    emitEvent.mockClear();

    ui.removePanel(id1);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.panel.unregistered',
      pluginId: 'my-plugin',
      panelId: id1,
    });
  });

  it('removePanel() (no args) removes all panels for the plugin', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    const id1 = ui.addPanel({ zone: 'fullview', label: 'Panel A' });
    const id2 = ui.addPanel({ zone: 'right-top', label: 'Panel B' });
    emitEvent.mockClear();

    ui.removePanel();
    expect(emitEvent).toHaveBeenCalledTimes(2);
    const calls = emitEvent.mock.calls.map((c) => (c[0] as { panelId: string }).panelId);
    expect(calls).toContain(id1);
    expect(calls).toContain(id2);
  });

  it('emits panel.unregistered with panelId on removePanel(id)', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    ui.removePanel('nonexistent-id');
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.panel.unregistered',
      pluginId: 'my-plugin',
      panelId: 'nonexistent-id',
    });
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
