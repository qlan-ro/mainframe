/**
 * lib/host — the renderer-side host port.
 *
 * getHost() returns a process-wide singleton: a TauriAdapter under Tauri,
 * a FakeHostBridge otherwise (browser/dev/test). React components read it via
 * useHost(); non-component modules (stores, lsp, terminal factory, the
 * connection bootstrap) call getHost() directly. Both resolve the same
 * singleton, so they never diverge.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { HostBridge } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from './fake-adapter';

export type { HostBridge } from '@qlan-ro/mainframe-types';
export { isTauriRuntime } from './detect';

let singleton: HostBridge | null = null;

function createHost(): HostBridge {
  // Task 4 adds the TauriAdapter branch here:
  //   return isTauriRuntime() ? new TauriAdapter() : new FakeHostBridge();
  return new FakeHostBridge();
}

export function getHost(): HostBridge {
  if (singleton === null) singleton = createHost();
  return singleton;
}

/** Test-only: replace the singleton. Pair with resetHostForTesting in afterEach. */
export function setHostForTesting(host: HostBridge): void {
  singleton = host;
}

/** Test-only: drop the singleton so the next getHost() re-detects. */
export function resetHostForTesting(): void {
  singleton = null;
}

const HostContext = createContext<HostBridge | null>(null);

export function HostProvider({ host, children }: { host?: HostBridge; children: ReactNode }) {
  return createElement(HostContext.Provider, { value: host ?? getHost() }, children);
}

export function useHost(): HostBridge {
  const ctx = useContext(HostContext);
  return ctx ?? getHost();
}
