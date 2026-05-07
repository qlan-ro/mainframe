import React from 'react';
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FullviewModal, useFullviewHeaderSlot } from './FullviewModal';
import { usePluginLayoutStore } from '../../store/plugins';
import type { PluginUIContribution } from '@qlan-ro/mainframe-types';

// PluginView mounts real plugin React trees (TodosPanel etc.) which pull in
// daemon clients and other heavy modules. The modal's behaviour is what we
// test here — plugin rendering is covered elsewhere.
const PROBE_SLOT = <button data-testid="slot-action">Slot Action</button>;
function HeaderSlotProbe(): React.ReactElement {
  useFullviewHeaderSlot(PROBE_SLOT);
  return <div data-testid="plugin-view">probe</div>;
}

vi.mock('../plugins/PluginView', () => ({
  PluginView: ({ pluginId }: { pluginId: string }) => {
    if (pluginId === 'probe') return <HeaderSlotProbe />;
    return <div data-testid="plugin-view">{pluginId}</div>;
  },
}));

function makeContribution(pluginId: string, label: string): PluginUIContribution {
  return {
    pluginId,
    panelId: 'panel-1',
    zone: 'fullview',
    label,
    icon: undefined,
  };
}

function resetStore(): void {
  usePluginLayoutStore.setState({
    contributions: [],
    actions: [],
    triggeredAction: null,
    activeFullviewId: null,
  });
}

describe('FullviewModal Integration', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders nothing when no fullview is active', () => {
    const { container } = render(<FullviewModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the plugin and uppercased label when activated', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    expect(screen.getByTestId('plugin-view')).toHaveTextContent('todos');

    const heading = screen.getByText('Todos');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('closes when the X button is clicked', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.click(screen.getByLabelText('Close'));

    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('closes when the backdrop is clicked', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.click(screen.getByTestId('fullview-modal-backdrop'));

    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('does not close when clicking inside the card', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.click(screen.getByTestId('plugin-view'));

    expect(usePluginLayoutStore.getState().activeFullviewId).toBe('todos');
  });

  it('closes when Escape is pressed', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('todos', 'Todos')],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(usePluginLayoutStore.getState().activeFullviewId).toBeNull();
  });

  it('falls back to pluginId in header when no contribution label is found', () => {
    usePluginLayoutStore.setState({
      contributions: [],
      activeFullviewId: 'todos',
    });

    render(<FullviewModal />);
    expect(screen.getByText('todos')).toBeInTheDocument();
  });

  it('renders header slot content registered by the active plugin', () => {
    usePluginLayoutStore.setState({
      contributions: [makeContribution('probe', 'Probe')],
      activeFullviewId: 'probe',
    });

    render(<FullviewModal />);

    expect(screen.getByTestId('slot-action')).toBeInTheDocument();
  });
});
