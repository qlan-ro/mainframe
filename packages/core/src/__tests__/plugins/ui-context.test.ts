import { describe, it, expect, vi } from 'vitest';
import { createPluginUIContext } from '../../plugins/ui-context.js';

describe('PluginUIContext', () => {
  it('calls emit on addPanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', '/path/to/plugin', emitEvent);
    ui.addPanel({ id: 'main', label: 'My Panel', position: 'sidebar-primary', entryPoint: './ui.mjs' });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.panel.registered', pluginId: 'my-plugin' }),
    );
  });

  it('resolves entryPoint to absolute path', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', '/path/to/plugin', emitEvent);
    ui.addPanel({ id: 'main', label: 'L', position: 'sidebar-primary', entryPoint: './ui.mjs' });
    const call = emitEvent.mock.calls[0]?.[0] as { entryPoint: string };
    expect(call.entryPoint).toBe('/path/to/plugin/ui.mjs');
  });

  it('emits panel.unregistered on removePanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', '/path/to/plugin', emitEvent);
    ui.removePanel('main');
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'plugin.panel.unregistered',
      pluginId: 'my-plugin',
      panelId: 'main',
    });
  });

  it('emits notification on notify', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', '/path/to/plugin', emitEvent);
    ui.notify({ title: 'Hello', body: 'World', level: 'info' });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.notification', pluginId: 'my-plugin', title: 'Hello' }),
    );
  });
});
