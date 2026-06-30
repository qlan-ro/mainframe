import { it, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DaemonTarget } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { ActiveDaemonProvider } from '@/features/daemon/active-daemon-context';
import { ConnectionStatusProvider } from '@/app/ConnectionStatusContext';
import { SidebarFooterView } from '../SidebarFooter';

// ---------------------------------------------------------------------------
// Mocks — same set used by DaemonFooterStatus tests
// ---------------------------------------------------------------------------

vi.mock('@/lib/daemon/dispose-daemon-session', () => ({
  disposeDaemonSession: vi.fn(),
}));
vi.mock('@/lib/lsp', () => ({
  rebindLspToActiveDaemon: vi.fn(() => Promise.resolve()),
  initLspPort: vi.fn(() => Promise.resolve()),
  lspClientManager: {},
  getLspLanguage: vi.fn(() => null),
  hasLspSupport: vi.fn(() => false),
  initAutoConnect: vi.fn(() => () => undefined),
}));
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    setPort: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribe: vi.fn(),
    send: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PORT = 31415;

const LOCAL_TARGET: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'This Mac',
  baseUrl: `http://127.0.0.1:${TEST_PORT}`,
  token: null,
};

// ---------------------------------------------------------------------------
// Wrapper — provides all required contexts
// ---------------------------------------------------------------------------

let fakeHost: FakeHostBridge;

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  setHostForTesting(fakeHost);
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DaemonPortProvider port={TEST_PORT}>
      <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>
        <ConnectionStatusProvider value={{ state: 'connected', daemonStatus: 'ok' }}>
          <TooltipProvider>{children}</TooltipProvider>
        </ConnectionStatusProvider>
      </ActiveDaemonProvider>
    </DaemonPortProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

it('renders the daemon-footer-trigger and per-status counts', () => {
  render(
    <SidebarFooterView
      connection={{ state: 'connected', daemonStatus: 'ok' }}
      counts={{ 'worktree-missing': 0, working: 2, waiting: 1, idle: 3 }}
    />,
    { wrapper: Wrapper },
  );
  expect(screen.getByTestId('daemon-footer-trigger')).toBeInTheDocument();
  expect(screen.getByTestId('sidebar-footer-count-working')).toHaveTextContent('2');
  expect(screen.getByTestId('sidebar-footer-count-waiting')).toHaveTextContent('1');
});

describe('SidebarFooter — design-parity (Phase-3)', () => {
  it('root element has h-[25px] class (artboard specifies height: 25)', () => {
    render(
      <SidebarFooterView
        connection={{ state: 'connected', daemonStatus: 'ok' }}
        counts={{ 'worktree-missing': 0, working: 0, waiting: 0, idle: 0 }}
      />,
      { wrapper: Wrapper },
    );
    const footer = screen.getByTestId('sidebar-footer');
    expect(footer.className).toContain('h-[25px]');
    expect(footer.className).not.toContain('h-7');
  });

  it('working-count dot has animate-pulse class (artboard shows tw-pulse animation)', () => {
    render(
      <SidebarFooterView
        connection={{ state: 'connected', daemonStatus: 'ok' }}
        counts={{ 'worktree-missing': 0, working: 1, waiting: 0, idle: 0 }}
      />,
      { wrapper: Wrapper },
    );
    const workingCount = screen.getByTestId('sidebar-footer-count-working');
    const dot = workingCount.querySelector('.animate-pulse');
    expect(dot).toBeTruthy();
  });
});
