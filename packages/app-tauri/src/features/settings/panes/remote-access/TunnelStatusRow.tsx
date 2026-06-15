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
      <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
        <Loader2 size={12} className="animate-spin text-yellow-500 shrink-0" />
        <span className="text-mf-small text-mf-text-secondary flex-1">
          {state === 'starting' ? 'Starting tunnel…' : 'Verifying DNS…'}
        </span>
      </div>
    );
  }

  if (state === 'verifying' && url) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
        <Loader2 size={12} className="animate-spin text-yellow-500 shrink-0" />
        <span className="text-mf-small text-mf-text-secondary flex-1">
          Verifying DNS for <code className="text-mf-text-primary">{url}</code>…
        </span>
      </div>
    );
  }

  if (state === 'ready' && url) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <code className="text-mf-small text-mf-text-primary truncate flex-1">{url}</code>
        <CopyButton text={url} testId="tunnel-url-copy-ready" />
      </div>
    );
  }

  if (state === 'unreachable' && url) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
          <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
          <code className="text-mf-small text-mf-text-secondary truncate flex-1">{url}</code>
          <CopyButton text={url} testId="tunnel-url-copy-unreachable" />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-mf-status text-yellow-500">
            DNS not yet propagated — tunnel may not be reachable. Pairing disabled.
          </p>
          <button
            data-testid="tunnel-recheck-verify"
            onClick={onRetryVerify}
            className="text-mf-small text-mf-accent hover:underline shrink-0 ml-2"
          >
            Re-check
          </button>
        </div>
      </div>
    );
  }

  return null;
}
