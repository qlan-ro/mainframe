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
import { TauriAdapter } from './tauri-adapter';
import { ElectronAdapter } from './electron-adapter';
import { isTauriRuntime, isElectronRuntime } from './detect';

export type { HostBridge } from '@qlan-ro/mainframe-types';
export { isTauriRuntime, isElectronRuntime } from './detect';
export { ElectronAdapter } from './electron-adapter';

let singleton: HostBridge | null = null;

function createHost(): HostBridge {
  if (isTauriRuntime()) return new TauriAdapter();
  if (isElectronRuntime()) return new ElectronAdapter();
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
