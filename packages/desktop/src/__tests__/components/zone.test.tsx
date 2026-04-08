import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ZoneHeader } from '../../renderer/components/zone/ZoneHeader.js';
import { Zone } from '../../renderer/components/zone/Zone.js';
import { DragProvider } from '../../renderer/components/zone/DragOverlay.js';
import { TooltipProvider } from '../../renderer/components/ui/tooltip.js';
import { useLayoutStore } from '../../renderer/store/layout.js';

function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TooltipProvider>
      <DragProvider>{children}</DragProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  useLayoutStore.getState().resetLayout();
  localStorage.clear();
});

describe('ZoneHeader', () => {
  it('renders the active panel label', () => {
    render(
      <Providers>
        <ZoneHeader zoneId="left-top" />
      </Providers>,
    );
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('shows only the active panel name, not all tabs', () => {
    render(
      <Providers>
        <ZoneHeader zoneId="left-bottom" />
      </Providers>,
    );
    // Active tab is 'skills', so only Skills shows
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.queryByText('Agents')).toBeNull();
  });

  it('has a minimize button', () => {
    render(
      <Providers>
        <ZoneHeader zoneId="left-top" />
      </Providers>,
    );
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument();
  });

  it('returns null when zone has no active tab', () => {
    useLayoutStore.getState().removeFromZone('sessions');
    render(
      <Providers>
        <ZoneHeader zoneId="left-top" />
      </Providers>,
    );
    expect(screen.queryByText('Sessions')).toBeNull();
  });

  it('updates label when active tab changes', () => {
    useLayoutStore.getState().setActiveTab('left-bottom', 'agents');
    render(
      <Providers>
        <ZoneHeader zoneId="left-bottom" />
      </Providers>,
    );
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.queryByText('Skills')).toBeNull();
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

  it('renders ZoneHeader with active panel name', () => {
    render(
      <Providers>
        <Zone id="left-top" />
      </Providers>,
    );
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
  });

  it('renders only the active panel for multi-tab zone', () => {
    render(
      <Providers>
        <Zone id="left-bottom" />
      </Providers>,
    );
    // Header shows active panel name
    expect(screen.getByText('Skills')).toBeInTheDocument();
    // Other panel in same zone is NOT shown
    expect(screen.queryByText('Agents')).toBeNull();
  });
});
