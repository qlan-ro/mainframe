/**
 * The body of a `url` workspace tab: the webview frame when there is something to
 * show, and one explicit state for every other resolver outcome (#281, AC9).
 * Mirrors `PreviewBodyState`'s frames so the two tab kinds read as one surface.
 */
import type { ReactNode, RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import type { UrlTabTarget } from './resolve-url-target';

interface UrlTabBodyStateProps {
  target: UrlTabTarget;
  device: 'desktop' | 'mobile';
  inspectActive: boolean;
  anchorRef: RefObject<HTMLDivElement | null>;
  onRetry: () => void;
}

function LoadedBody({
  device,
  inspectActive,
  anchorRef,
}: Pick<UrlTabBodyStateProps, 'device' | 'inspectActive' | 'anchorRef'>) {
  const inspectFrame = inspectActive ? 'outline outline-[2px] outline-primary -outline-offset-2' : '';
  const inspectBadge = inspectActive ? (
    <div
      data-testid="url-tab-inspect-active-indicator"
      className="absolute top-[8px] left-[8px] z-10 rounded-[6px] bg-primary px-[7px] py-[2px] font-mono text-caption font-semibold text-primary-foreground"
    >
      Click an element
    </div>
  ) : null;

  return (
    <div data-testid="url-tab-body-loaded" className="absolute inset-0">
      {device === 'desktop' ? (
        <div
          className={`absolute inset-0 overflow-hidden rounded-md [border:0.5px_solid_var(--border)] ${inspectFrame}`}
        >
          <div ref={anchorRef} className="absolute inset-0" />
          {inspectBadge}
        </div>
      ) : (
        <div className="flex items-center justify-center h-full">
          <div
            className={`relative w-[230px] h-[420px] overflow-hidden rounded-[22px] [border:0.5px_solid_var(--border)] [box-shadow:var(--mf-shadow-pop)] ${inspectFrame}`}
          >
            <div ref={anchorRef} className="w-full h-full" />
            {inspectBadge}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBody({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="absolute inset-0 grid place-items-center bg-card">
      <div className="flex max-w-[80%] flex-col items-center gap-2.5 text-center">{children}</div>
    </div>
  );
}

function FailureLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-destructive" />
      <span className="text-body text-muted-foreground">{text}</span>
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      data-testid="url-tab-retry"
      onClick={onRetry}
      className="rounded-md border border-border px-3 py-1.5 text-label text-foreground transition-colors hover:bg-accent"
    >
      Retry
    </button>
  );
}

export function UrlTabBodyState({ target, device, inspectActive, anchorRef, onRetry }: UrlTabBodyStateProps) {
  if (target.kind === 'direct' || target.kind === 'tunnelled') {
    return <LoadedBody device={device} inspectActive={inspectActive} anchorRef={anchorRef} />;
  }

  if (target.kind === 'pending') {
    return (
      <MessageBody testId="url-tab-body-pending">
        <div className="flex items-center gap-[8px]">
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
          <span className="text-label text-muted-foreground">Starting a tunnel for port {target.port}…</span>
        </div>
      </MessageBody>
    );
  }

  if (target.kind === 'rejected') {
    return (
      <MessageBody testId="url-tab-body-rejected">
        <FailureLine text={target.reason} />
      </MessageBody>
    );
  }

  if (target.kind === 'failed') {
    return (
      <MessageBody testId="url-tab-body-failed">
        <FailureLine text={target.error} />
        <RetryButton onRetry={onRetry} />
      </MessageBody>
    );
  }

  if (target.kind === 'stopped') {
    return (
      <MessageBody testId="url-tab-body-stopped">
        <FailureLine text={`The tunnel for port ${target.port} was stopped`} />
        <RetryButton onRetry={onRetry} />
      </MessageBody>
    );
  }

  // kind === 'invalid' — the address bar above is the only way out.
  return (
    <MessageBody testId="url-tab-body-invalid">
      <FailureLine text="This tab’s saved address can’t be opened" />
      {target.url !== '' && <span className="line-clamp-2 font-mono text-caption text-mf-text-3">{target.url}</span>}
    </MessageBody>
  );
}
