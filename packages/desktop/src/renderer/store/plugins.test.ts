import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginLayoutStore } from './plugins';
import type { PluginUIContribution } from '@qlan-ro/mainframe-types';

const makeContrib = (pluginId: string, zone: PluginUIContribution['zone']): PluginUIContribution => ({
  pluginId,
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
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'fullview'));
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(1);
  });

  it('replaces an existing contribution from the same plugin', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'fullview'));
    usePluginLayoutStore.getState().registerContribution({ ...makeContrib('todos', 'fullview'), label: 'Updated' });
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(1);
    expect(usePluginLayoutStore.getState().contributions[0]?.label).toBe('Updated');
  });
});

describe('unregisterContribution', () => {
  it('removes the contribution and clears active state if that plugin was active', () => {
    usePluginLayoutStore.getState().registerContribution(makeContrib('todos', 'fullview'));
    usePluginLayoutStore.getState().activateFullview('todos');
    usePluginLayoutStore.getState().unregisterContribution('todos');
    expect(usePluginLayoutStore.getState().contributions).toHaveLength(0);
    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
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
