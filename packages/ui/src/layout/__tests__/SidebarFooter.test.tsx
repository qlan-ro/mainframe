import { it, expect, vi, beforeEach, afterEach } from 'vitest';
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

it('renders the daemon-footer-trigger', () => {
  render(
    <SidebarFooterView counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 2, waiting: 1, idle: 3 }} />,
    {
      wrapper: Wrapper,
    },
  );
  expect(screen.getByTestId('daemon-footer-trigger')).toBeInTheDocument();
});

// Session counts (Working/Waiting/Idle) are hidden for now per product
// request — this guards the hidden state rather than asserting the (currently
// unreachable) per-status content, which the earlier "Phase-3"/"1.7-1.12"
// suites below covered when the counts were visible.
it('does not render the session-count cluster while counts are hidden', () => {
  render(
    <SidebarFooterView counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 2, waiting: 1, idle: 3 }} />,
    {
      wrapper: Wrapper,
    },
  );
  expect(screen.queryByTestId('sidebar-footer-counts')).not.toBeInTheDocument();
});

it('renders the sidebar-footer root', () => {
  render(
    <SidebarFooterView counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 0, waiting: 0, idle: 0 }} />,
    {
      wrapper: Wrapper,
    },
  );
  expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
});
