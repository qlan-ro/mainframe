import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ZoneTabBar } from '../../renderer/components/zone/ZoneTabBar.js';
import { Zone } from '../../renderer/components/zone/Zone.js';
import { useLayoutStore } from '../../renderer/store/layout.js';

beforeEach(() => {
  useLayoutStore.getState().resetLayout();
  localStorage.clear();
});

describe('ZoneTabBar', () => {
  it('renders tab labels for the zone', () => {
    render(<ZoneTabBar zoneId="left-bottom" />);
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('renders the single tab for left-top zone', () => {
    render(<ZoneTabBar zoneId="left-top" />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('highlights the active tab with data-active=true', () => {
    render(<ZoneTabBar zoneId="left-bottom" />);
    const skillsTab = screen.getByText('Skills').closest('button');
    const agentsTab = screen.getByText('Agents').closest('button');
    expect(skillsTab).toHaveAttribute('data-active', 'true');
    expect(agentsTab).toHaveAttribute('data-active', 'false');
  });

  it('clicking an inactive tab sets it as active', () => {
    render(<ZoneTabBar zoneId="left-bottom" />);
    const agentsTab = screen.getByText('Agents').closest('button')!;
    expect(agentsTab).toHaveAttribute('data-active', 'false');

    fireEvent.click(agentsTab);

    const state = useLayoutStore.getState();
    expect(state.zones['left-bottom']!.activeTab).toBe('agents');
  });

  it('clicking the active tab keeps it active', () => {
    render(<ZoneTabBar zoneId="left-bottom" />);
    const skillsTab = screen.getByText('Skills').closest('button')!;
    fireEvent.click(skillsTab);

    const state = useLayoutStore.getState();
    expect(state.zones['left-bottom']!.activeTab).toBe('skills');
  });

  it('returns null when zone has no tabs', () => {
    // Move all tabs out of left-top to create an empty zone
    useLayoutStore.getState().removeFromZone('sessions');
    const { container } = render(<ZoneTabBar zoneId="left-top" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders tabs for right-bottom zone', () => {
    render(<ZoneTabBar zoneId="right-bottom" />);
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
  });

  it('active tab has data-active=true, others have data-active=false', () => {
    render(<ZoneTabBar zoneId="right-bottom" />);
    const contextTab = screen.getByText('Context').closest('button');
    const changesTab = screen.getByText('Changes').closest('button');
    expect(contextTab).toHaveAttribute('data-active', 'true');
    expect(changesTab).toHaveAttribute('data-active', 'false');
  });
});

describe('Zone', () => {
  it('returns null when zone has no tabs', () => {
    useLayoutStore.getState().removeFromZone('sessions');
    const { container } = render(<Zone id="left-top" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders ZoneTabBar when zone has tabs', () => {
    render(<Zone id="left-top" />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('renders tab bar and content area for multi-tab zone', () => {
    render(<Zone id="left-bottom" />);
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });
});
