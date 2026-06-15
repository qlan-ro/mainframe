import { Loader2 } from 'lucide-react';
import { CopyButton } from './CopyButton';
import type { TunnelUiState } from './use-tunnel-status';

interface TunnelStatusRowProps {
  state: TunnelUiState;
  url: string | null;
  onRetryVerify: () => void;
}

/**
 * Single source of truth for the tunnel-status pill (dot + URL + spinner /
 * warning) shared by Named and Quick sections so both render the same state
 * the same way.
 */
export function TunnelStatusRow({ state, url, onRetryVerify }: TunnelStatusRowProps): React.ReactElement | null {
  if (state === 'idle' || state === 'error') return null;

  if (state === 'starting' || (state === 'verifying' && !url)) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-card border border-border rounded-md">
        <Loader2 size={12} className="animate-spin text-mf-warning shrink-0" />
        <span className="text-caption text-muted-foreground flex-1">
          {state === 'starting' ? 'Starting tunnel…' : 'Verifying DNS…'}
        </span>
      </div>
    );
  }

  if (state === 'verifying' && url) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-card border border-border rounded-md">
        <Loader2 size={12} className="animate-spin text-mf-warning shrink-0" />
        <span className="text-caption text-muted-foreground flex-1">
          Verifying DNS for <code className="text-foreground">{url}</code>…
        </span>
      </div>
    );
  }

  if (state === 'ready' && url) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-card border border-border rounded-md">
        <span className="w-2 h-2 rounded-full bg-mf-success shrink-0" />
        <code className="text-caption text-foreground truncate flex-1">{url}</code>
        <CopyButton text={url} testId="tunnel-url-copy-ready" />
      </div>
    );
  }

  if (state === 'unreachable' && url) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 p-2.5 bg-card border border-border rounded-md">
          <span className="w-2 h-2 rounded-full bg-mf-warning shrink-0" />
          <code className="text-caption text-muted-foreground truncate flex-1">{url}</code>
          <CopyButton text={url} testId="tunnel-url-copy-unreachable" />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-micro text-mf-warning">
            DNS not yet propagated — tunnel may not be reachable. Pairing disabled.
          </p>
          <button
            data-testid="tunnel-recheck-verify"
            onClick={onRetryVerify}
            className="text-caption text-primary hover:underline shrink-0 ml-2"
          >
            Re-check
          </button>
        </div>
      </div>
    );
  }

  return null;
}
