/**
 * Step bodies and footer rows for the pairing dialog.
 *
 * The code entry is the stock `InputOTP` (six slots, 3+3): it replaces the v1
 * hand-rolled box row and brings paste, caret and slot a11y for free. The
 * value is a plain string — no space-padding sentinel.
 */
import { REGEXP_ONLY_DIGITS_AND_CHARS } from 'input-otp';
import { ShieldIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { INSECURE_ENDPOINT_MESSAGE } from './endpoint-policy';
import { NoticeCard, UrlAdornment, UrlChip, type UrlPhase } from './pairing-shared';

export interface Step0BodyProps {
  url: string;
  phase: UrlPhase;
  version?: string;
  onUrlChange: (v: string) => void;
  onVerify: () => void;
}

export function Step0Body({ url, phase, version, onUrlChange, onVerify }: Step0BodyProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="daemon-add-url">Server URL</Label>
        <div className="relative flex items-center">
          <Input
            id="daemon-add-url"
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
          <div className="pointer-events-none absolute right-2.5">
            <UrlAdornment phase={phase} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
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
              className="text-xs font-semibold text-primary hover:underline"
            >
              Retry
            </button>
          }
        >
          Couldn&apos;t reach this URL
        </NoticeCard>
      )}
      {phase === 'refused' && (
        // No Retry action: the same URL can never pass the policy.
        <NoticeCard kind="error" testId="daemon-add-insecure">
          {INSECURE_ENDPOINT_MESSAGE}
        </NoticeCard>
      )}
    </div>
  );
}

export type Step1Phase = 'idle' | 'confirming' | 'invalid' | 'done' | 'unreachable' | 'storage' | 'insecure';

export interface Step1BodyProps {
  lockedUrl: string;
  code: string;
  device: string;
  phase: Step1Phase;
  pairedLabel?: string;
  onCodeChange: (v: string) => void;
  onDeviceChange: (v: string) => void;
}

const OTP_SLOT = 'h-11 w-9 font-mono text-lg font-bold';

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
    <div className="flex flex-col gap-2.5">
      <UrlChip url={lockedUrl} />

      <div className="flex flex-col gap-1.5">
        <Label>Pairing code</Label>
        <InputOTP
          data-testid="daemon-pair-code"
          maxLength={6}
          value={code}
          onChange={(v) => onCodeChange(v.toUpperCase())}
          pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
          disabled={disabled}
          autoFocus
        >
          <InputOTPGroup>
            {[0, 1, 2].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid={isInvalid} className={OTP_SLOT} />
            ))}
          </InputOTPGroup>
          <InputOTPSeparator className="text-muted-foreground" />
          <InputOTPGroup>
            {[3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid={isInvalid} className={OTP_SLOT} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <p className="text-xs text-muted-foreground">
          On the server, open{' '}
          <strong className="font-semibold text-foreground">Remote Access → Generate pairing code</strong> (or{' '}
          <code className="font-mono">mainframe-daemon pair</code>). It&apos;s valid for 5 minutes.
        </p>
      </div>

      {isInvalid && (
        <NoticeCard kind="error" testId="daemon-add-error">
          That code didn&apos;t work
        </NoticeCard>
      )}

      {phase === 'insecure' && (
        <NoticeCard kind="error" testId="daemon-pair-insecure">
          {INSECURE_ENDPOINT_MESSAGE}
        </NoticeCard>
      )}

      {phase === 'storage' && (
        <NoticeCard kind="error" testId="daemon-add-storage-error">
          Paired, but couldn&apos;t save the credential to this device&apos;s keychain. The connection won&apos;t
          persist — check Keychain access and try again.
        </NoticeCard>
      )}

      {isDone && pairedLabel != null && <NoticeCard kind="success">Paired with {pairedLabel}</NoticeCard>}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="daemon-add-device">Device name</Label>
        <Input
          id="daemon-add-device"
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

function TunnelNote() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ShieldIcon className="size-3 shrink-0" />
      <span>Encrypted over your Cloudflare tunnel</span>
    </div>
  );
}

export interface FooterStep0Props {
  phase: UrlPhase;
  url: string;
  onCancel: () => void;
  onVerify: () => void;
  onContinue: () => void;
}

export function FooterStep0({ phase, url, onCancel, onVerify, onContinue }: FooterStep0Props) {
  const isVerifying = phase === 'verifying';

  return (
    <div className="flex w-full items-center justify-between">
      <TunnelNote />
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" data-testid="daemon-add-cancel" onClick={onCancel}>
          Cancel
        </Button>
        {phase === 'reachable' ? (
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
    <div className="flex w-full items-center justify-between">
      <TunnelNote />
      <div className="flex items-center gap-1.5">
        {mode === 'add' ? (
          <Button variant="ghost" size="sm" data-testid="daemon-add-back" onClick={onBack}>
            Back
          </Button>
        ) : (
          <Button variant="ghost" size="sm" data-testid="daemon-add-cancel" onClick={onCancel}>
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
