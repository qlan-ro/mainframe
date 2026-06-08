import type { ConnectionState } from '../app/useConnectionState';
import { cn } from '@/lib/utils';

const DOT: Record<ConnectionState, string> = {
  connecting: 'bg-mf-warning',
  connected: 'bg-mf-success',
  disconnected: 'bg-destructive',
};

interface Props {
  state: ConnectionState;
  daemonStatus: string;
}

export function AppStatusBar({ state, daemonStatus }: Props) {
  return (
    <div data-testid="app-status-bar" className="flex h-[28px] flex-shrink-0 items-center px-3 pb-1.5">
      {/* Left slot — daemon connection status (matches the design StatusBar) */}
      <div className="flex items-center gap-1.5 text-micro tracking-normal text-muted-foreground">
        <span data-testid="app-connection-dot" className={cn('inline-block size-[6px] rounded-full', DOT[state])} />
        <span>{state === 'connected' ? 'Daemon Connected' : daemonStatus}</span>
      </div>

      {/* Right slot — future additions go here */}
      <div className="flex-1" />
    </div>
  );
}
