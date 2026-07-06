/**
 * DaemonPortContext — the single synchronous home for the live daemon port in
 * the runtime layer.
 *
 * The global runtimeHook runs inside assistant-ui's per-thread binder where no
 * props reach it, so it resolves the port from context. App provides this once
 * the connection is up; everything under it (sidebar, picker, chat surface)
 * reads the port without prop-drilling. EVERY consumer imports useDaemonPort
 * from here — there is no second port source.
 */
import { createContext, useContext, type ReactNode } from 'react';

const DaemonPortContext = createContext<number | null>(null);

export function DaemonPortProvider({ port, children }: { port: number; children: ReactNode }) {
  return <DaemonPortContext.Provider value={port}>{children}</DaemonPortContext.Provider>;
}

export function useDaemonPort(): number {
  const port = useContext(DaemonPortContext);
  if (port === null) {
    throw new Error('useDaemonPort must be used within a DaemonPortProvider');
  }
  return port;
}
