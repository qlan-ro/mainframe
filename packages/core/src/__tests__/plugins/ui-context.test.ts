import { describe, it, expect, vi } from 'vitest';
import { createPluginUIContext } from '../../plugins/ui-context.js';

describe('PluginUIContext', () => {
  it('calls emit on addPanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    ui.addPanel({ zone: 'left-panel', label: 'My Panel' });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.panel.registered', pluginId: 'my-plugin' }),
    );
  });

  it('emits correct zone and label on addPanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    ui.addPanel({ zone: 'right-panel', label: 'My Panel', icon: 'star' });
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.panel.registered',
      pluginId: 'my-plugin',
      zone: 'right-panel',
      label: 'My Panel',
      icon: 'star',
    });
  });

  it('emits panel.unregistered on removePanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', emitEvent);
    ui.removePanel();
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.panel.unregistered',
      pluginId: 'my-plugin',
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
