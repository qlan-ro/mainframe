/**
 * pairing-steps — step bodies and footer rows for AddRemoteDialog.
 *
 * Exported: Step0Body, Step1Body, FooterStep0, FooterStep1 and their prop types.
 */
import { Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PairCodeInput } from './PairCodeInput';
import { NoticeCard, UrlChip, UrlAdornment, type UrlPhase } from './pairing-shared';

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
        <NoticeCard kind="success" testId="daemon-add-reachable">
          Daemon reachable{version != null && ` — v${version}`}
        </NoticeCard>
      )}
      {phase === 'unreachable' && (
        <NoticeCard
          kind="error"
          testId="daemon-add-unreachable"
          action={
            <button
              type="button"
              data-testid="daemon-add-retry"
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

export type Step1Phase = 'idle' | 'confirming' | 'invalid' | 'done' | 'unreachable';

export interface Step1BodyProps {
  lockedUrl: string;
  code: string;
  device: string;
  phase: Step1Phase;
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
          <code className="font-mono text-[11px]">mainframe-daemon pair</code>). It&apos;s valid for 5 minutes.
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
// FooterStep0
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

// ---------------------------------------------------------------------------
// FooterStep1
// ---------------------------------------------------------------------------

export interface FooterStep1Props {
  mode: 'add' | 'repair';
  phase: Step1Phase;
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
          {isDone ? 'Paired' : isConfirming ? loadingLabel : label}
        </Button>
      </div>
    </div>
  );
}
