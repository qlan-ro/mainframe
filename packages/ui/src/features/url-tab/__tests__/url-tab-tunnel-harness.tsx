/**
 * Shared scaffolding for `UrlTabInstance` tunnel tests (#281). Extracted once a
 * third file needed the same fake handle/host, store seeding, and render
 * wrapper as `UrlTabInstance.tunnel.test.tsx` and
 * `UrlTabInstance.tunnel-retarget-ownership.test.tsx` (project rule: extract at
 * 3+ duplications).
 *
 * No `vi.mock(...)` here — those calls are hoisted per module and cannot move
 * out of the test files that need them. This file is not itself collected as a
 * test (`vitest.config.ts` only picks up `*.test.tsx`/`*.test.ts`).
 */
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting } from '@/lib/host';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import { useLayoutStore } from '@/store/layout';
import { usePortTunnelsStore, type PortTunnelEntry } from '@/store/port-tunnels';
import { useSandboxStore } from '@/store/sandbox';
import { UrlTabInstance } from '../UrlTabInstance';

const FRESH_LAYOUT = { top: ['workspace' as const], bottom: null as null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

export function makeFakeHandle(): PreviewHandle {
  return {
    setVisible: vi.fn(),
    compositesAboveDom: false,
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array()),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockReturnValue(() => {}),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockReturnValue(() => {}),
    onNavigate: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
    reanchor: vi.fn(),
    setDevice: vi.fn(),
    destroy: vi.fn(),
  };
}

let installedHost: FakeHostBridge | null = null;

/** Installs a fresh fake host + webview handle and points `setHostForTesting` at it. */
export function installFakeHost(): { fakeHost: FakeHostBridge; fakeHandle: PreviewHandle } {
  const fakeHandle = makeFakeHandle();
  const fakeHost = new FakeHostBridge();
  fakeHost.preview.mount = vi.fn().mockReturnValue(fakeHandle);
  setHostForTesting(fakeHost);
  installedHost = fakeHost;
  return { fakeHost, fakeHandle };
}

/** Resets the sandbox, port-tunnels, and layout stores to a fresh, empty baseline. */
export function seedStores(): void {
  useSandboxStore.setState({
    captures: [],
    logsOutput: [],
    selectedConfigByScope: {},
    lastStartedProcess: null,
    processStatuses: {},
  });
  usePortTunnelsStore.setState({ byPort: {}, daemonPort: 31415, generation: 0 });
  useLayoutStore.setState({ layout: { ...FRESH_LAYOUT }, run: null, sessions: new Map(), activeSessionId: null });
}

export function setPortEntry(port: number, entry: PortTunnelEntry): void {
  usePortTunnelsStore.setState((s) => ({ byPort: { ...s.byPort, [port]: entry }, generation: s.generation + 1 }));
}

/** Renders `UrlTabInstance`, visible, wrapped in the host installed by `installFakeHost`. */
export function renderTab(url: string, { tabId = 't1' }: { tabId?: string } = {}) {
  if (installedHost === null) throw new Error('renderTab() called before installFakeHost()');
  const host = installedHost;
  return render(<UrlTabInstance tabId={tabId} url={url} visible />, {
    // The url-tab toolbar is full of v2 `Hint`s — the v2 TooltipProvider is part of the stack.
    wrapper: ({ children }) => (
      <HostProvider host={host}>
        <TooltipProvider>{children}</TooltipProvider>
      </HostProvider>
    ),
  });
}
