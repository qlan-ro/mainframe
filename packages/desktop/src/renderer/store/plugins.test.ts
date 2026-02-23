import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginLayoutStore } from './plugins';
import type { PluginUIContribution } from '@mainframe/types';

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
    activeLeftPanelId: null,
    activeRightPanelId: null,
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

  it('deactivates fullview when left panel is activated', () => {
    usePluginLayoutStore.getState().activateFullview('todos');
    usePluginLayoutStore.getState().setActiveLeftPanel('myPlugin');
    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
    expect(usePluginLayoutStore.getState().activeLeftPanelId).toBe('myPlugin');
  });
});

describe('setActiveLeftPanel / setActiveRightPanel', () => {
  it('sets null to restore default', () => {
    usePluginLayoutStore.getState().setActiveLeftPanel('p1');
    usePluginLayoutStore.getState().setActiveLeftPanel(null);
    expect(usePluginLayoutStore.getState().activeLeftPanelId).toBeNull();
  });

  it('left and right are independent', () => {
    usePluginLayoutStore.getState().setActiveLeftPanel('p1');
    usePluginLayoutStore.getState().setActiveRightPanel('p2');
    expect(usePluginLayoutStore.getState().activeLeftPanelId).toBe('p1');
    expect(usePluginLayoutStore.getState().activeRightPanelId).toBe('p2');
  });
});
