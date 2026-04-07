import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ZoneTabBar } from '../../renderer/components/zone/ZoneTabBar.js';
import { Zone } from '../../renderer/components/zone/Zone.js';
import { DragProvider } from '../../renderer/components/zone/DragOverlay.js';
import { TooltipProvider } from '../../renderer/components/ui/tooltip.js';
import { useLayoutStore } from '../../renderer/store/layout.js';

function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TooltipProvider>
      <Providers>{children}</Providers>
    </TooltipProvider>
  );
}

beforeEach(() => {
  useLayoutStore.getState().resetLayout();
  localStorage.clear();
});

describe('ZoneTabBar', () => {
  it('renders tab labels for the zone', () => {
    render(
      <Providers>
        <ZoneTabBar zoneId="left-bottom" />
      </Providers>,
    );
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('renders the single tab for left-top zone', () => {
    render(
      <Providers>
        <ZoneTabBar zoneId="left-top" />
      </Providers>,
    );
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('highlights the active tab with data-active=true', () => {
    render(
      <Providers>
        <ZoneTabBar zoneId="left-bottom" />
      </Providers>,
    );
    const skillsTab = screen.getByText('Skills').closest('button');
    const agentsTab = screen.getByText('Agents').closest('button');
    expect(skillsTab).toHaveAttribute('data-active', 'true');
    expect(agentsTab).toHaveAttribute('data-active', 'false');
  });

  it('clicking an inactive tab sets it as active', () => {
    render(
      <Providers>
        <ZoneTabBar zoneId="left-bottom" />
      </Providers>,
    );
    const agentsTab = screen.getByText('Agents').closest('button')!;
    expect(agentsTab).toHaveAttribute('data-active', 'false');

    fireEvent.click(agentsTab);

    const state = useLayoutStore.getState();
    expect(state.zones['left-bottom']!.activeTab).toBe('agents');
  });

  it('clicking the active tab keeps it active', () => {
    render(
      <Providers>
        <ZoneTabBar zoneId="left-bottom" />
      </Providers>,
    );
    const skillsTab = screen.getByText('Skills').closest('button')!;
    fireEvent.click(skillsTab);

    const state = useLayoutStore.getState();
    expect(state.zones['left-bottom']!.activeTab).toBe('skills');
  });

  it('returns null when zone has no tabs', () => {
    // Move all tabs out of left-top to create an empty zone
    useLayoutStore.getState().removeFromZone('sessions');
    render(
      <Providers>
        <ZoneTabBar zoneId="left-top" />
      </Providers>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders tabs for right-bottom zone', () => {
    render(
      <Providers>
        <ZoneTabBar zoneId="right-bottom" />
      </Providers>,
    );
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
  });

  it('active tab has data-active=true, others have data-active=false', () => {
    render(
      <Providers>
        <ZoneTabBar zoneId="right-bottom" />
      </Providers>,
    );
    const contextTab = screen.getByText('Context').closest('button');
    const changesTab = screen.getByText('Changes').closest('button');
    expect(contextTab).toHaveAttribute('data-active', 'true');
    expect(changesTab).toHaveAttribute('data-active', 'false');
  });
});

describe('Zone', () => {
  it('returns null when zone has no tabs', () => {
    useLayoutStore.getState().removeFromZone('sessions');
    render(
      <Providers>
        <Zone id="left-top" />
      </Providers>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders ZoneTabBar when zone has tabs', () => {
    render(
      <Providers>
        <Zone id="left-top" />
      </Providers>,
    );
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('renders tab bar and content area for multi-tab zone', () => {
    render(
      <Providers>
        <Zone id="left-bottom" />
      </Providers>,
    );
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });
});
