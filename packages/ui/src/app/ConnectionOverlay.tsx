import React from 'react';
import ReactDOM from 'react-dom';

interface ConnectionOverlayProps {
  open: boolean;
  embedded?: boolean;
}

export function ConnectionOverlay({ open, embedded = false }: ConnectionOverlayProps): React.ReactElement | null {
  if (!open) return null;

  const body = (
    <div
      className="absolute inset-0 z-[11000] flex items-center justify-center"
      style={{
        background: 'var(--mf-glass)',
        backdropFilter: 'blur(10px) saturate(120%)',
        WebkitBackdropFilter: 'blur(10px) saturate(120%)',
      }}
    >
      <Card />
    </div>
  );

  if (embedded) return body;

  return ReactDOM.createPortal(<div className="fixed inset-0 z-[11000]">{body}</div>, document.body);
}

function Card(): React.ReactElement {
  return (
    <div
      data-testid="connection-overlay"
      className="flex flex-col items-center gap-[16px] rounded-[13px] bg-background border-[0.5px] border-mf-border-hover min-w-[320px] pt-[30px] px-[38px] pb-[26px]"
      style={{
        boxShadow: 'var(--mf-shadow-modal)',
      }}
    >
      <Spinner />
      <TextBlock />
      <ProgressRail />
    </div>
  );
}

function Spinner(): React.ReactElement {
  return (
    <div className="relative w-[46px] h-[46px]">
      <div className="absolute inset-0 rounded-full" style={{ border: '2px solid var(--border)' }} />
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

function TextBlock(): React.ReactElement {
  return (
    <div className="text-center">
      <p className="text-heading font-semibold text-foreground tracking-tight">Reconnecting to daemon…</p>
      <p className="text-label text-muted-foreground mt-[5px] leading-normal max-w-[248px]">
        Your sessions are safe. Work resumes automatically the moment the connection is back.
      </p>
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
