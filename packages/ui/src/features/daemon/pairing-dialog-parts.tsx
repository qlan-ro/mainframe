/**
 * pairing-dialog-parts — sub-components for AddRemoteDialog.
 *
 * Exported: StepRail, UrlChip, NoticeCard, Step0Body, Step1Body, DialogFooterRow.
 * Kept separate to hold the main dialog under 300 lines.
 */
import { Globe, Check, AlertTriangle, Lock, Shield, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PairCodeInput } from './PairCodeInput';

// ---------------------------------------------------------------------------
// StepRail
// ---------------------------------------------------------------------------

const STEPS = ['Connect', 'Pair'] as const;

export interface StepRailProps {
  current: 0 | 1;
}

export function StepRail({ current }: StepRailProps) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center">
            {/* connector before (except first) */}
            {i > 0 && <div className={cn('h-px w-8 transition-colors', done ? 'bg-mf-success' : 'bg-border')} />}
            <div className="flex flex-col items-center gap-[3px]">
              <div
                className={cn(
                  'flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                  done && 'bg-mf-success text-white',
                  active && 'bg-primary text-primary-foreground',
                  !done && !active && 'bg-mf-chip text-mf-text-3',
                )}
              >
                {done ? <Check size={10} strokeWidth={2.5} /> : i + 1}
              </div>
              <span className={cn('text-micro', active ? 'font-semibold text-foreground' : 'text-mf-text-3')}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NoticeCard — success / error / info banners
// ---------------------------------------------------------------------------

export type NoticeKind = 'success' | 'error' | 'info';

export interface NoticeCardProps {
  kind: NoticeKind;
  children: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}

const NOTICE_STYLES: Record<NoticeKind, string> = {
  success: 'bg-mf-success-tint border-mf-success/30 text-foreground',
  error: 'bg-destructive/8 border-destructive/30 text-foreground',
  info: 'bg-mf-content2 border-border text-muted-foreground',
};

const NOTICE_ICON: Record<NoticeKind, React.ReactNode> = {
  success: <Check size={13} className="shrink-0 text-mf-success" />,
  error: <AlertTriangle size={13} className="shrink-0 text-destructive" />,
  info: <Globe size={13} className="shrink-0 text-muted-foreground" />,
};

export function NoticeCard({ kind, children, action, testId }: NoticeCardProps) {
  return (
    <div
      data-testid={testId}
      className={cn('flex items-start gap-[7px] rounded-md border px-[10px] py-[8px]', NOTICE_STYLES[kind])}
    >
      {NOTICE_ICON[kind]}
      <span className="min-w-0 flex-1 text-caption leading-[1.4]">{children}</span>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UrlChip — locked URL display for step 1
// ---------------------------------------------------------------------------

export function UrlChip({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-[6px] rounded-md border border-border bg-mf-content2 px-[10px] py-[6px]">
      <Check size={12} className="shrink-0 text-mf-success" />
      <span className="min-w-0 flex-1 truncate font-mono text-caption text-foreground">{url}</span>
      <Lock size={12} className="shrink-0 text-mf-text-3" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// UrlAdornment — right-side icon for URL input
// ---------------------------------------------------------------------------

export type UrlPhase = 'idle' | 'verifying' | 'reachable' | 'unreachable';

export function UrlAdornment({ phase }: { phase: UrlPhase }) {
  if (phase === 'verifying') return <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />;
  if (phase === 'reachable') return <Check size={14} className="shrink-0 text-mf-success" />;
  if (phase === 'unreachable') return <AlertTriangle size={14} className="shrink-0 text-destructive" />;
  return <Globe size={14} className="shrink-0 text-mf-text-3" />;
}

// ---------------------------------------------------------------------------
// Step0Body
// ---------------------------------------------------------------------------

export interface Step0BodyProps {
  url: string;
  phase: UrlPhase;
  version?: string;
  onUrlChange: (v: string) => void;
  onVerify: () => void;
}

export function Step0Body({ url, phase, version, onUrlChange, onVerify }: Step0BodyProps) {
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-col gap-[4px]">
        <label className="text-label font-semibold text-muted-foreground">Server URL</label>
        <div className="relative flex items-center">
          <Input
            data-testid="daemon-add-url"
            type="url"
            value={url}
            placeholder="https://your-tunnel.trycloudflare.com"
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim()) onVerify();
            }}
            disabled={phase === 'verifying'}
            className="pr-8"
          />
          <div className="pointer-events-none absolute right-[10px]">
            <UrlAdornment phase={phase} />
          </div>
        </div>
        <p className="text-caption text-mf-text-3 leading-[1.4]">
          Use the <strong className="font-semibold text-foreground">named tunnel</strong> URL from the server's Remote
          Access settings. Quick tunnels rotate their URL on restart.
        </p>
      </div>

      {phase === 'reachable' && (
        <NoticeCard kind="success">Daemon reachable{version != null && ` — v${version}`}</NoticeCard>
      )}
      {phase === 'unreachable' && (
        <NoticeCard
          kind="error"
          action={
            <button
              type="button"
              onClick={onVerify}
              className="text-caption font-semibold text-primary hover:underline"
            >
              Retry
            </button>
          }
        >
          Couldn&apos;t reach this URL
        </NoticeCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step1Body
// ---------------------------------------------------------------------------

export interface Step1BodyProps {
  lockedUrl: string;
  code: string;
  device: string;
  phase: 'idle' | 'confirming' | 'invalid' | 'done' | 'unreachable';
  pairedLabel?: string;
  onCodeChange: (v: string) => void;
  onDeviceChange: (v: string) => void;
}

export function Step1Body({
  lockedUrl,
  code,
  device,
  phase,
  pairedLabel,
  onCodeChange,
  onDeviceChange,
}: Step1BodyProps) {
  const isInvalid = phase === 'invalid';
  const isDone = phase === 'done';
  const disabled = phase === 'confirming' || isDone;

  return (
    <div className="flex flex-col gap-[10px]">
      <UrlChip url={lockedUrl} />

      <div className="flex flex-col gap-[4px]">
        <label className="text-label font-semibold text-muted-foreground">Pairing code</label>
        <PairCodeInput value={code} onChange={onCodeChange} invalid={isInvalid} disabled={disabled} autoFocus />
        <p className="text-caption text-mf-text-3 leading-[1.4]">
          On the server, open{' '}
          <strong className="font-semibold text-foreground">Remote Access → Generate pairing code</strong> (or{' '}
          <code className="font-mono text-[11px]">curl POST /api/auth/pair</code>). It&apos;s valid for 5 minutes.
        </p>
      </div>

      {isInvalid && (
        <NoticeCard kind="error" testId="daemon-add-error">
          That code didn&apos;t work
        </NoticeCard>
      )}

      {isDone && pairedLabel != null && <NoticeCard kind="success">Paired with {pairedLabel}</NoticeCard>}

      <div className="flex flex-col gap-[4px]">
        <label className="text-label font-semibold text-muted-foreground">Device name</label>
        <Input
          data-testid="daemon-add-device"
          type="text"
          value={device}
          placeholder="This Mac"
          onChange={(e) => onDeviceChange(e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DialogFooterRow
// ---------------------------------------------------------------------------

export interface FooterStep0Props {
  phase: UrlPhase;
  url: string;
  onCancel: () => void;
  onVerify: () => void;
  onContinue: () => void;
}

export function FooterStep0({ phase, url, onCancel, onVerify, onContinue }: FooterStep0Props) {
  const isVerifying = phase === 'verifying';
  const isReachable = phase === 'reachable';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-[5px] text-caption text-mf-text-3">
        <Shield size={12} className="shrink-0" />
        <span>Encrypted over your Cloudflare tunnel</span>
      </div>
      <div className="flex items-center gap-[6px]">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {isReachable ? (
          <Button size="sm" data-testid="daemon-add-continue" onClick={onContinue}>
            Continue
          </Button>
        ) : (
          <Button size="sm" data-testid="daemon-add-verify" disabled={!url.trim() || isVerifying} onClick={onVerify}>
            {isVerifying ? 'Verifying…' : 'Verify'}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface FooterStep1Props {
  mode: 'add' | 'repair';
  phase: 'idle' | 'confirming' | 'invalid' | 'done' | 'unreachable';
  codeReady: boolean;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function FooterStep1({ mode, phase, codeReady, onBack, onCancel, onConfirm }: FooterStep1Props) {
  const isConfirming = phase === 'confirming';
  const isDone = phase === 'done';
  const label = mode === 'repair' ? 'Re-pair' : 'Pair daemon';
  const loadingLabel = mode === 'repair' ? 'Re-pairing…' : 'Pairing…';
  const doneLabel = 'Paired';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-[5px] text-caption text-mf-text-3">
        <Shield size={12} className="shrink-0" />
        <span>Encrypted over your Cloudflare tunnel</span>
      </div>
      <div className="flex items-center gap-[6px]">
        {mode === 'add' ? (
          <Button variant="ghost" size="sm" data-testid="daemon-add-back" onClick={onBack}>
            Back
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          data-testid="daemon-add-confirm"
          disabled={!codeReady || isConfirming || isDone}
          onClick={onConfirm}
        >
          {isDone ? doneLabel : isConfirming ? loadingLabel : label}
        </Button>
      </div>
    </div>
  );
}
