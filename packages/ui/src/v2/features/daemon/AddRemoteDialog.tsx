/**
 * The two-step pairing dialog (Connect → Pair), stock dialog composition.
 *
 * `AddRemoteBody` stays pure/controlled and the state machine keeps the v1
 * behaviour verbatim: verify → continue → confirm, storage failures surfaced
 * as their own phase, onDone fired immediately on success with the close
 * deferred ~800ms so the "Paired" notice is visible. The auto-switch is
 * deferred with it — switching remounts `<AppShell key={target.id}>`, which
 * would tear this dialog down mid-notice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@v2/components/ui/dialog';
import { confirmPairing, PairingError, verifyDaemon } from '@/features/daemon/pair-daemon';
import { useDaemonRegistry } from '@/features/daemon/use-daemon-registry';
import { applyPairing } from '@/features/daemon/apply-pairing';
import { StepRail, type DialogMode, type UrlPhase } from './pairing-shared';
import { FooterStep0, FooterStep1, Step0Body, Step1Body, type Step1Phase } from './pairing-steps';

export { StepRail } from './pairing-shared';
export type { DialogMode } from './pairing-shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  const codeReady = code.length === 6;
  const lockedUrl = mode === 'repair' && target != null ? `https://${target.host}` : url;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Agents and code run on the server; this Mac stays a control surface.</DialogDescription>
      </DialogHeader>

      <div className="flex items-center justify-center rounded-md bg-muted py-2.5">
        <StepRail current={step} />
      </div>

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

      <DialogFooter>
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
      </DialogFooter>
    </>
  );
}

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
  const [code, setCode] = useState('');
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
      const deviceLabel = device.trim() || 'This Mac';
      const { token } = await confirmPairing(targetUrl, trimmedCode, deviceLabel);

      let addedId: string | undefined;
      try {
        ({ addedId } = await applyPairing({ mode, target, targetUrl, device: deviceLabel, token, registry }));
      } catch (storageErr) {
        console.warn('[daemon/AddRemoteDialog] token storage failed', storageErr);
        setStep1Phase('storage');
        return;
      }

      setStep1Phase('done');
      setPairedLabel(mode === 'repair' && target != null ? target.label : undefined);

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
      <DialogContent className="sm:max-w-md">
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
