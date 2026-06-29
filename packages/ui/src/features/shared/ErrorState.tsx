import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';

interface ErrorStateProps {
  error: Error | null | undefined;
  onRetry?: () => void;
  embedded?: boolean;
}

/**
 * Centered error panel rendered by MfErrorBoundary (and usable standalone).
 * Shows the error message in a mono detail block with Copy / Reload / Try again actions.
 */
export function ErrorState({ error, onRetry, embedded = false }: ErrorStateProps) {
  const [copied, setCopied] = useState(false);

  const msg = error?.message ?? 'An unexpected error occurred while rendering this view.';

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(msg).catch(() => {
        /* expected: clipboard may be unavailable in some environments */
      });
    } catch {
      /* expected: clipboard API unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const wrapperClass = embedded
    ? 'relative w-full h-full flex items-center justify-center bg-mf-window p-[28px]'
    : 'absolute inset-0 flex items-center justify-center bg-mf-window p-[28px]';

  return (
    <div className={wrapperClass}>
      <div
        data-testid="error-state-root"
        className={[
          'w-[420px] max-w-full bg-background rounded-[13px]',
          'border-[0.5px] border-mf-border-hover text-center',
          'pt-[26px] px-[24px] pb-[22px]',
          'shadow-[0_24px_64px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.05)]',
        ].join(' ')}
      >
        {/* Icon tile */}
        <div className="w-[44px] h-[44px] mx-auto rounded-[13px] bg-mf-destructive-tint text-destructive flex items-center justify-center">
          <TriangleAlert size={22} />
        </div>

        {/* Heading */}
        <p className="text-title font-semibold text-foreground mt-[14px] tracking-tight">Something went wrong</p>

        {/* Reassurance */}
        <p className="text-label text-muted-foreground mt-[5px] leading-normal">
          This view hit an error and stopped rendering. Your session and files are unaffected.
        </p>

        {/* Mono error detail */}
        <div
          className={[
            'mt-[14px] py-[10px] px-[12px] rounded-[8px]',
            'bg-mf-code-bg border-[0.5px] border-border',
            'font-mono text-caption text-muted-foreground text-left leading-normal',
            'max-h-[96px] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]',
          ].join(' ')}
        >
          {msg}
        </div>

        {/* Button row */}
        <div className="flex gap-[8px] mt-[16px] justify-center">
          <button
            data-testid="error-state-copy"
            onClick={handleCopy}
            className={[
              'h-[28px] px-[12px] rounded-[8px]',
              'border-[0.5px] border-border bg-background',
              'text-muted-foreground text-label font-medium',
              'cursor-pointer',
            ].join(' ')}
          >
            {copied ? 'Copied ✓' : 'Copy details'}
          </button>

          <button
            data-testid="error-state-reload"
            onClick={() => window.location.reload()}
            className={[
              'h-[28px] px-[12px] rounded-[8px]',
              'border-[0.5px] border-border bg-background',
              'text-muted-foreground text-label font-medium',
              'cursor-pointer',
            ].join(' ')}
          >
            Reload
          </button>

          <button
            data-testid="error-state-retry"
            onClick={onRetry}
            className={[
              'h-[28px] px-[14px] rounded-[8px]',
              'bg-primary text-primary-foreground',
              'text-label font-medium',
              'cursor-pointer',
            ].join(' ')}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
