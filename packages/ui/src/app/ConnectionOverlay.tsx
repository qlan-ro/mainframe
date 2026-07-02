import React from 'react';
import ReactDOM from 'react-dom';

const DEFAULT_TITLE = 'Reconnecting to daemon…';
const DEFAULT_SUBTITLE = 'Your sessions are safe. Work resumes automatically the moment the connection is back.';

interface ConnectionOverlayProps {
  open: boolean;
  embedded?: boolean;
  /** Overlay heading. Defaults to the reconnect copy. */
  title?: string;
  /** Secondary line under the heading. Defaults to the reconnect copy. */
  subtitle?: string;
  /** Card `data-testid` (so the boot/"starting" variant can keep its own hook). */
  testId?: string;
  /**
   * Optional body override. When provided, renders this node instead of the
   * default spinner card. The glass scrim container is still applied.
   * Use this slot to inject DaemonUnreachableBody or similar surfaces.
   */
  children?: React.ReactNode;
}

export function ConnectionOverlay({
  open,
  embedded = false,
  title = DEFAULT_TITLE,
  subtitle = DEFAULT_SUBTITLE,
  testId = 'connection-overlay',
  children,
}: ConnectionOverlayProps): React.ReactElement | null {
  if (!open) return null;

  const inner = children != null ? children : <Card title={title} subtitle={subtitle} testId={testId} />;

  const body = (
    <div
      className="absolute inset-0 z-[11000] flex items-center justify-center"
      style={{
        // Bespoke lower-opacity warm scrim (design 14-windowstates.jsx:145,
        // rgba(233,231,226,0.62)) — distinct from --mf-glass (the
        // titlebar/sidebar chrome-glass token, which is the same base hue at
        // 0.84 alpha). --mf-window (#e9e7e2) is an exact RGB match for the
        // design value, so we derive the 0.62-alpha scrim from it via
        // color-mix rather than hardcoding a light-only rgba (keeps the
        // scrim theme-adaptive across all 6 mf-* theme variants).
        background: 'color-mix(in srgb, var(--mf-window) 62%, transparent)',
        backdropFilter: 'blur(10px) saturate(120%)',
        WebkitBackdropFilter: 'blur(10px) saturate(120%)',
      }}
    >
      {inner}
    </div>
  );

  if (embedded) return body;

  return ReactDOM.createPortal(<div className="fixed inset-0 z-[11000]">{body}</div>, document.body);
}

function Card({ title, subtitle, testId }: { title: string; subtitle: string; testId: string }): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-[16px] rounded-[13px] bg-background border-[0.5px] border-mf-border-hover min-w-[320px] pt-[30px] px-[38px] pb-[26px]"
      style={{
        boxShadow: 'var(--mf-shadow-modal)',
      }}
    >
      <Spinner />
      <TextBlock title={title} subtitle={subtitle} />
      <ProgressRail />
    </div>
  );
}

function Spinner(): React.ReactElement {
  return (
    <div className="relative w-[46px] h-[46px]">
      <div className="absolute inset-0 rounded-full" style={{ border: '2px solid var(--mf-chip)' }} />
      <div
        className="absolute inset-0 rounded-full border-2 border-transparent animate-[tw-spin_0.9s_linear_infinite]"
        style={{
          borderTopColor: 'var(--primary)',
          borderRightColor: 'var(--primary)',
        }}
      />
      <div className="absolute top-1/2 left-1/2 w-[7px] h-[7px] -mt-[3.5px] -ml-[3.5px] rounded-full bg-primary animate-[twPulse_1.4s_ease-in-out_infinite]" />
    </div>
  );
}

function TextBlock({ title, subtitle }: { title: string; subtitle: string }): React.ReactElement {
  return (
    <div className="text-center">
      <p className="text-heading font-semibold text-foreground tracking-tight">{title}</p>
      <p className="text-label text-muted-foreground mt-[5px] leading-normal max-w-[248px]">{subtitle}</p>
    </div>
  );
}

function ProgressRail(): React.ReactElement {
  return (
    <div className="w-[200px] h-[3px] rounded-[2px] overflow-hidden" style={{ background: 'var(--mf-chip)' }}>
      <div className="w-[40%] h-full rounded-[2px] bg-primary animate-[ws-indeterminate_1.5s_ease-in-out_infinite]" />
    </div>
  );
}
