/**
 * GithubDeviceConnect — the device-flow half of GitHub's credential connect
 * (`GithubCredentialConnect.tsx`), rendered only once the parent has
 * confirmed a GitHub App client ID is configured; `TokenCredentialField`
 * next to it is the always-available path, never gated behind this one.
 *
 * Each poll is one daemon round trip (`github_device.rs`'s `poll_once`); this
 * component owns the interval-respecting retry loop — `pending` keeps the
 * current interval, `slow_down` adopts the daemon's new one. `unavailable`
 * is a defensive fallback for the 501 the daemon would still return if this
 * ever mounted out of sync with the parent's client-ID check.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GithubDeviceStart } from '@/lib/api/automations';
import { ApiRequestError } from '@/lib/api/http';
import { useAutomationsStore } from '../data/use-automations-store';

export interface GithubDeviceConnectProps {
  onChange: (label: string | undefined) => void;
  testId: string;
}

const GITHUB_LABEL = 'github';
const NOT_CONFIGURED_STATUS = 501;

type Phase =
  | { kind: 'idle' }
  | { kind: 'unavailable' }
  | { kind: 'starting' }
  | { kind: 'waiting'; start: GithubDeviceStart }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

export function GithubDeviceConnect({ onChange, testId }: GithubDeviceConnectProps) {
  const gateway = useAutomationsStore((s) => s.gateway);
  const addCredential = useAutomationsStore((s) => s.addCredential);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      cancelled.current = true;
      clearTimeout(timer.current);
    },
    [],
  );

  function schedulePoll(deviceCode: string, intervalSeconds: number) {
    timer.current = setTimeout(() => void poll(deviceCode, intervalSeconds), intervalSeconds * 1000);
  }

  async function poll(deviceCode: string, intervalSeconds: number) {
    if (cancelled.current) return;
    try {
      const result = await gateway.pollGithubDeviceFlow(deviceCode);
      if (cancelled.current) return;
      switch (result.status) {
        case 'pending':
          schedulePoll(deviceCode, intervalSeconds);
          return;
        case 'slow_down':
          schedulePoll(deviceCode, result.interval ?? intervalSeconds + 5);
          return;
        case 'expired':
          setPhase({ kind: 'expired' });
          return;
        case 'denied':
          setPhase({ kind: 'denied' });
          return;
        case 'connected':
          addCredential(GITHUB_LABEL);
          onChange(GITHUB_LABEL);
          return;
        case 'error':
          setPhase({ kind: 'error', message: result.message ?? 'GitHub connect failed' });
      }
    } catch (err) {
      if (cancelled.current) return;
      setPhase({ kind: 'error', message: describeError(err) });
    }
  }

  async function start() {
    setPhase({ kind: 'starting' });
    try {
      const started = await gateway.startGithubDeviceFlow();
      if (cancelled.current) return;
      setPhase({ kind: 'waiting', start: started });
      schedulePoll(started.deviceCode, started.interval);
    } catch (err) {
      if (cancelled.current) return;
      if (err instanceof ApiRequestError && err.status === NOT_CONFIGURED_STATUS) {
        setPhase({ kind: 'unavailable' });
        return;
      }
      setPhase({ kind: 'error', message: describeError(err) });
    }
  }

  async function copyCode(userCode: string) {
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (phase.kind === 'unavailable') {
    return (
      <div
        data-testid={`${testId}-unavailable`}
        className="flex flex-col gap-1 rounded-md border-[0.5px] border-border bg-card p-2.5 text-xs text-muted-foreground"
      >
        <span className="font-medium text-foreground">GitHub connection isn't available yet</span>
        <span>Use the token field above — sign-in with GitHub is coming soon.</span>
      </div>
    );
  }

  if (phase.kind === 'waiting') {
    return (
      <div
        data-testid={`${testId}-waiting`}
        className="flex flex-col gap-1.5 rounded-md border-[0.5px] border-border bg-card p-2.5"
      >
        <span className="text-xs text-muted-foreground">
          Enter this code at{' '}
          <a href={phase.start.verificationUri} target="_blank" rel="noreferrer" className="text-primary underline">
            {phase.start.verificationUri}
          </a>
        </span>
        <div className="flex items-center gap-1.5">
          <span
            data-testid={`${testId}-code`}
            className="rounded-sm bg-muted px-2 py-1 font-mono text-sm tracking-wide text-foreground"
          >
            {phase.start.userCode}
          </span>
          <button
            type="button"
            data-testid={`${testId}-copy`}
            onClick={() => void copyCode(phase.start.userCode)}
            aria-label="Copy code"
            className="flex size-[22px] items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
          >
            {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          </button>
        </div>
        <span className="text-xs text-muted-foreground">Waiting for authorization…</span>
      </div>
    );
  }

  if (phase.kind === 'expired' || phase.kind === 'denied' || phase.kind === 'error') {
    const message =
      phase.kind === 'expired'
        ? 'The code expired before it was entered.'
        : phase.kind === 'denied'
          ? 'The GitHub connection was cancelled.'
          : phase.message;
    return (
      <div className="flex flex-col gap-1.5">
        <span data-testid={`${testId}-status`} className="text-xs text-destructive">
          {message}
        </span>
        <Button
          variant="outline"
          size="sm"
          data-testid={`${testId}-retry`}
          onClick={() => void start()}
          className="w-fit gap-1.5 border-[0.5px] bg-card font-semibold text-primary"
        >
          <Plug size={12} aria-hidden />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      data-testid={`${testId}-connect`}
      onClick={() => void start()}
      disabled={phase.kind === 'starting'}
      className="gap-1.5 border-[0.5px] bg-card font-semibold text-primary"
    >
      <Plug size={12} aria-hidden />
      Connect GitHub…
    </Button>
  );
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : 'GitHub connect failed';
}
