/**
 * AddRemoteDialog — two-step pairing dialog (Connect → Pair).
 *
 * Exports:
 *   StepRail          — pure progress indicator component (re-exported from pairing-shared).
 *   AddRemoteBody     — pure/controlled dialog body (no async logic).
 *   AddRemoteDialog   — live state machine wired to verifyDaemon/confirmPairing/registry.
 *
 * Visual spec: task-B7-brief.md / 17-daemon.jsx design intent.
 * Token mapping: text-foreground / text-muted-foreground / text-mf-text-3 /
 *   bg-mf-content2 / mf-success / destructive / primary / rounded-md /
 *   font-mono / text-micro / text-caption / text-label / text-body.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Server, X } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { getHost } from '@/lib/host';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { verifyDaemon, confirmPairing, parseRemoteUrl, PairingError } from './pair-daemon';
import { useDaemonRegistry } from './use-daemon-registry';
import { StepRail, type UrlPhase } from './pairing-shared';
import { Step0Body, Step1Body, FooterStep0, FooterStep1, type Step1Phase } from './pairing-steps';

export { StepRail } from './pairing-shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DialogMode = 'add' | 'repair';

export interface AddRemoteBodyProps {
  mode: DialogMode;
  target?: DaemonMeta;
  step: 0 | 1;
  urlPhase: UrlPhase;
  urlVersion?: string;
  step1Phase: Step1Phase;
  url: string;
  code: string;
  device: string;
  pairedLabel?: string;
  onClose: () => void;
  onUrlChange: (v: string) => void;
  onVerify: () => void;
  onContinue: () => void;
  onBack: () => void;
  onCodeChange: (v: string) => void;
  onDeviceChange: (v: string) => void;
  onConfirm: () => void;
}

// ---------------------------------------------------------------------------
// AddRemoteBody (pure / controlled)
// ---------------------------------------------------------------------------

export function AddRemoteBody({
  mode,
  target,
  step,
  urlPhase,
  urlVersion,
  step1Phase,
  url,
  code,
  device,
  pairedLabel,
  onClose,
  onUrlChange,
  onVerify,
  onContinue,
  onBack,
  onCodeChange,
  onDeviceChange,
  onConfirm,
}: AddRemoteBodyProps) {
  const title = mode === 'repair' && target != null ? `Re-pair ${target.label}` : 'Add remote daemon';
  const codeReady = code.replace(/ /g, '').length === 6;
  const lockedUrl = mode === 'repair' && target != null ? `https://${target.host}` : url;

  return (
    <div className="flex w-[460px] max-w-full flex-col gap-0">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-start gap-[12px] pb-[16px]">
        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Server size={17} className="text-primary" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <h2 className="text-heading font-bold text-foreground leading-tight">{title}</h2>
          <p className="text-caption text-muted-foreground leading-normal">
            Agents and code run on the server; this Mac stays a control surface.
          </p>
        </div>
        <button
          type="button"
          data-testid="daemon-add-close"
          onClick={onClose}
          className={cn(
            'flex size-[28px] shrink-0 items-center justify-center rounded-md',
            'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          )}
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Step rail ─────────────────────────────────────────────── */}
      <div className="mb-[16px] flex items-center justify-center rounded-md bg-mf-content2 py-[10px]">
        <StepRail current={step} />
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-[12px]">
        {step === 0 ? (
          <Step0Body url={url} phase={urlPhase} version={urlVersion} onUrlChange={onUrlChange} onVerify={onVerify} />
        ) : (
          <Step1Body
            lockedUrl={lockedUrl}
            code={code}
            device={device}
            phase={step1Phase}
            pairedLabel={pairedLabel}
            onCodeChange={onCodeChange}
            onDeviceChange={onDeviceChange}
          />
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <div className="mt-[16px]">
        {step === 0 ? (
          <FooterStep0 phase={urlPhase} url={url} onCancel={onClose} onVerify={onVerify} onContinue={onContinue} />
        ) : (
          <FooterStep1
            mode={mode}
            phase={step1Phase}
            codeReady={codeReady}
            onBack={onBack}
            onCancel={onClose}
            onConfirm={onConfirm}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddRemoteDialog (live state machine)
// ---------------------------------------------------------------------------

export interface AddRemoteDialogProps {
  open: boolean;
  mode?: DialogMode;
  target?: DaemonMeta;
  onClose: () => void;
  onDone: () => void;
}

export function AddRemoteDialog({ open, mode = 'add', target, onClose, onDone }: AddRemoteDialogProps) {
  const registry = useDaemonRegistry();
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialStep: 0 | 1 = mode === 'repair' ? 1 : 0;
  const initialUrl = mode === 'repair' && target != null ? `https://${target.host}` : '';

  const [step, setStep] = useState<0 | 1>(initialStep);
  const [urlPhase, setUrlPhase] = useState<UrlPhase>('idle');
  const [urlVersion, setUrlVersion] = useState<string | undefined>(undefined);
  const [step1Phase, setStep1Phase] = useState<Step1Phase>('idle');
  const [url, setUrl] = useState(initialUrl);
  // 6-space string is the blank sentinel for PairCodeInput (one space per character slot)
  const [code, setCode] = useState('      ');
  const [device, setDevice] = useState('This Mac');
  const [pairedLabel, setPairedLabel] = useState<string | undefined>(undefined);

  // Clear the deferred close timer on unmount to avoid setting state after unmount.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleUrlChange = useCallback((v: string) => {
    setUrl(v);
    setUrlPhase('idle');
    setUrlVersion(undefined);
  }, []);

  const handleVerify = useCallback(async () => {
    if (!url.trim()) return;
    setUrlPhase('verifying');
    const result = await verifyDaemon(url.trim());
    if (result.ok) {
      setUrlPhase('reachable');
      setUrlVersion(result.version);
    } else {
      setUrlPhase('unreachable');
    }
  }, [url]);

  const handleContinue = useCallback(() => {
    setStep(1);
    setStep1Phase('idle');
  }, []);

  const handleBack = useCallback(() => {
    setStep(0);
    setStep1Phase('idle');
  }, []);

  const handleConfirm = useCallback(async () => {
    const trimmedCode = code.replace(/ /g, '');
    if (trimmedCode.length !== 6) return;

    const targetUrl = mode === 'repair' && target != null ? `https://${target.host}` : url.trim();
    setStep1Phase('confirming');

    try {
      const { token } = await confirmPairing(targetUrl, trimmedCode, device.trim() || 'This Mac');

      let addedId: string | undefined;
      if (mode === 'add') {
        const host = parseRemoteUrl(targetUrl).host;
        const label = host.split('.')[0] ?? 'New server';
        const meta: DaemonMeta = {
          id: crypto.randomUUID(),
          kind: 'remote',
          label,
          host,
          device: device.trim() || 'This Mac',
          paired: 'Just now',
        };
        await registry.add(meta, token);
        addedId = meta.id;
      } else if (target != null) {
        await getHost().daemons.setToken(target.id, token);
      }

      setStep1Phase('done');
      setPairedLabel(mode === 'repair' && target != null ? target.label : undefined);

      // Fire onDone immediately; defer close by 800 ms so the "Paired" notice
      // is visible before the dialog dismisses. Defer the auto-switch too:
      // switching flips `<AppShell key={target.id}>` in App.tsx, remounting
      // the subtree this dialog lives in — switching eagerly used to tear the
      // still-open dialog down before it ever reached this "done" phase.
      onDone();
      closeTimerRef.current = setTimeout(() => {
        onClose();
        if (addedId != null) void registry.switchTo(addedId);
      }, 800);
    } catch (err) {
      if (err instanceof PairingError) {
        setStep1Phase(err.kind === 'invalid' ? 'invalid' : 'unreachable');
      } else {
        setStep1Phase('unreachable');
      }
    }
  }, [code, mode, target, url, device, registry, onDone, onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="p-[20px] max-w-[500px]" hideClose>
        <AddRemoteBody
          mode={mode}
          target={target}
          step={step}
          urlPhase={urlPhase}
          urlVersion={urlVersion}
          step1Phase={step1Phase}
          url={url}
          code={code}
          device={device}
          pairedLabel={pairedLabel}
          onClose={onClose}
          onUrlChange={handleUrlChange}
          onVerify={() => {
            void handleVerify();
          }}
          onContinue={handleContinue}
          onBack={handleBack}
          onCodeChange={setCode}
          onDeviceChange={setDevice}
          onConfirm={() => {
            void handleConfirm();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
