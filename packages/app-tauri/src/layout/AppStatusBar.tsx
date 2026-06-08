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
  port: number | null;
}

export function AppStatusBar({ state, daemonStatus, port }: Props) {
  return (
    <div data-testid="app-status-bar" className="flex h-[22px] flex-shrink-0 items-center px-3">
      {/* Left slot — daemon connection status (matches the design StatusBar) */}
      <div className="flex items-center gap-1.5 text-[10px] tracking-[-0.05em] text-muted-foreground">
        <span data-testid="app-connection-dot" className={cn('inline-block size-[6px] rounded-full', DOT[state])} />
        <span>
          {daemonStatus}
          {port != null ? ` · ${port}` : ''}
        </span>
      </div>

      {/* Right slot — future additions go here */}
      <div className="flex-1" />
    </div>
  );
}
