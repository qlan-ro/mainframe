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
    <SidebarFooterView counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 2, waiting: 1, idle: 3 }} />,
    {
      wrapper: Wrapper,
    },
  );
  expect(screen.getByTestId('daemon-footer-trigger')).toBeInTheDocument();
  expect(screen.getByTestId('sidebar-footer-count-working')).toHaveTextContent('2');
  expect(screen.getByTestId('sidebar-footer-count-waiting')).toHaveTextContent('1');
});

describe('SidebarFooter — design-parity (Phase-3)', () => {
  it('root element has h-[25px] class (artboard specifies height: 25)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 0, waiting: 0, idle: 0 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const footer = screen.getByTestId('sidebar-footer');
    expect(footer.className).toContain('h-[25px]');
    expect(footer.className).not.toContain('h-7');
  });

  it('working-count dot has animate-pulse class (artboard shows tw-pulse animation)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 1, waiting: 0, idle: 0 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const workingCount = screen.getByTestId('sidebar-footer-count-working');
    const dot = workingCount.querySelector('.animate-pulse');
    expect(dot).toBeTruthy();
  });
});

describe('SidebarFooter — design-parity findings 1.7/1.10/1.11/1.12', () => {
  it('root element uses px-[12px] horizontal padding (finding 1.7 — design wants 12px, px-3 compresses to 6px)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 0, waiting: 0, idle: 0 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const footer = screen.getByTestId('sidebar-footer');
    expect(footer.className).toContain('px-[12px]');
    expect(footer.className).not.toContain('px-3');
  });

  it('count-cluster wrapper uses gap-[9px] between working/waiting/idle groups (finding 1.10)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 1, waiting: 1, idle: 1 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const clusterWrap = screen.getByTestId('sidebar-footer-counts');
    expect(clusterWrap.className).toContain('gap-[9px]');
  });

  it('each count span uses gap-[4px] between dot and digit (finding 1.11 — gap-1 compresses to 2px)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 1, waiting: 0, idle: 0 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const workingCount = screen.getByTestId('sidebar-footer-count-working');
    expect(workingCount.className).toContain('gap-[4px]');
    expect(workingCount.className).not.toContain('gap-1 ');
  });

  it('working count digit carries text-primary + font-semibold (finding 1.12)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 1, waiting: 0, idle: 0 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const workingCount = screen.getByTestId('sidebar-footer-count-working');
    expect(workingCount.className).toContain('text-primary');
    expect(workingCount.className).toContain('font-semibold');
  });

  it('waiting count digit carries text-mf-warning + font-semibold (finding 1.12)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 0, waiting: 1, idle: 0 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const waitingCount = screen.getByTestId('sidebar-footer-count-waiting');
    expect(waitingCount.className).toContain('text-mf-warning');
    expect(waitingCount.className).toContain('font-semibold');
  });

  it('idle count digit carries text-mf-text-3 + font-semibold (finding 1.12)', () => {
    render(
      <SidebarFooterView
        counts={{ 'worktree-missing': 0, 'transcript-missing': 0, working: 0, waiting: 0, idle: 1 }}
      />,
      {
        wrapper: Wrapper,
      },
    );
    const idleCount = screen.getByTestId('sidebar-footer-count-idle');
    expect(idleCount.className).toContain('text-mf-text-3');
    expect(idleCount.className).toContain('font-semibold');
  });
});
