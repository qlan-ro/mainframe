import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginLayoutStore } from './plugins';
import type { PluginUIContribution } from '@qlan-ro/mainframe-types';

const makeContrib = (pluginId: string, panelId: string, zone: PluginUIContribution['zone']): PluginUIContribution => ({
  pluginId,
  panelId,
  zone,
  label: pluginId,
  icon: 'star',
});

beforeEach(() => {
  usePluginLayoutStore.setState({
    contributions: [],
    activeFullviewId: null,
  });
});

describe('registerContribution', () => {
  it('adds a contribution', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-1', 'fullview'));
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(1);
  });

  it('replaces an existing contribution with the same pluginId+panelId', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-1', 'fullview'));
    usePluginLayoutStore
      .getState()
      .registerContribution({ ...makeContrib('todos', 'panel-1', 'fullview'), label: 'Updated' });
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(1);
    expect(usePluginLayoutStore.getState().contributions[0]?.label).toBe('Updated');
  });

  it('allows multiple panels from the same plugin with different panelIds', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-1', 'fullview'));
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-2', 'right-top'));
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(2);
  });
});

describe('unregisterContribution', () => {
  it('removes the contribution and clears active state if that plugin was active', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-1', 'fullview'));
    usePluginLayoutStore.getState().activateFullview('todos');
    usePluginLayoutStore.getState().unregisterContribution('todos');
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(0);
    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('removes only the specified panel when panelId is provided', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-1', 'fullview'));
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-2', 'right-top'));
    usePluginLayoutStore.getState().unregisterContribution('todos', 'panel-1');
    const remaining = usePluginLayoutStore.getState().contributions;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.panelId).toBe('panel-2');
  });

  it('removes all panels for a plugin when panelId is omitted', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-1', 'fullview'));
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-2', 'right-top'));
    usePluginLayoutStore.getState().unregisterContribution('todos');
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(0);
  });

  it('does not remove panels from other plugins', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'panel-1', 'fullview'));
    usePluginLayoutStore.getState().registerContribution(makeContrib('other', 'panel-x', 'right-top'));
    usePluginLayoutStore.getState().unregisterContribution('todos');
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(1);
    expect(usePluginLayoutStore.getState().contributions[0]?.pluginId).toBe('other');
  });
});

describe('activateFullview / deactivateFullview', () => {
  it('sets activeFullviewId', () => {
    usePluginLayoutStore.getState().activateFullview('todos');
    expect(usePluginLayoutStore.getState().activeFullviewId).toBe('todos');
  });

  it('toggles off when same id activated again', () => {
    usePluginLayoutStore.getState().activateFullview('todos');
    usePluginLayoutStore.getState().activateFullview('todos');
    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });
});
