import { useSyncExternalStore } from 'react';
import { daemonClient } from '../lib/client';

export function useConnectionState(): boolean {
  return useSyncExternalStore(daemonClient.subscribeConnection, daemonClient.getConnectionSnapshot);
}
