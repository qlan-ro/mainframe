import { createContext, useContext } from 'react';
import type { ConnectionState } from './useConnectionState';

export interface ConnectionStatus {
  state: ConnectionState;
  daemonStatus: string;
}

const ConnectionStatusContext = createContext<ConnectionStatus | null>(null);

export const ConnectionStatusProvider = ConnectionStatusContext.Provider;

export function useConnectionStatus(): ConnectionStatus {
  const ctx = useContext(ConnectionStatusContext);
  if (!ctx) throw new Error('useConnectionStatus must be used within ConnectionStatusProvider');
  return ctx;
}

/** False while the daemon is out of reach. True where nothing watches the connection. */
export function useIsConnected(): boolean {
  const ctx = useContext(ConnectionStatusContext);
  return ctx == null || ctx.state === 'connected';
}
