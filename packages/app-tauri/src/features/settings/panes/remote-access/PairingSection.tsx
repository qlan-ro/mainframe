import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { generatePairingCode } from '../../../../lib/api/remote-access';
import { CopyButton } from './CopyButton';

const PAIRING_EXPIRY_MS = 5 * 60 * 1000;

interface PairingSectionProps {
  port: number;
}

export function PairingSection({ port }: PairingSectionProps): React.ReactElement {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [generating, setGenerating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup the interval on unmount to avoid the "setState on unmounted component" footgun.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, expiresAt - Date.now());
      setRemaining(left);
      if (left === 0) {
        setCode(null);
        setExpiresAt(null);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [expiresAt]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await generatePairingCode(port);
      setCode(result.pairingCode);
      setExpiresAt(Date.now() + PAIRING_EXPIRY_MS);
    } catch (err) {
      console.warn('[settings/PairingSection] failed to generate pairing code', err);
    } finally {
      setGenerating(false);
    }
  }, [port]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-mf-small text-mf-text-secondary">Mobile Pairing</label>
        <p className="text-mf-status text-mf-text-tertiary mt-0.5">Generate a code to pair a mobile device.</p>
      </div>

      {code ? (
        <PairingCodeDisplay
          code={code}
          minutes={minutes}
          seconds={seconds}
          generating={generating}
          onGenerate={handleGenerate}
        />
      ) : (
        <button
          data-testid="pairing-generate-code"
          onClick={handleGenerate}
          disabled={generating}
          className="px-3 py-1.5 text-mf-small bg-mf-accent text-white rounded-mf-input hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {generating ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Generating...
            </span>
          ) : (
            'Generate Pairing Code'
          )}
        </button>
      )}
    </div>
  );
}

function PairingCodeDisplay({
  code,
  minutes,
  seconds,
  generating,
  onGenerate,
}: {
  code: string;
  minutes: number;
  seconds: number;
  generating: boolean;
  onGenerate: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-3 p-4 bg-mf-input-bg border border-mf-divider rounded-mf-input">
        <span className="text-2xl font-mono font-bold tracking-[0.3em] text-mf-text-primary">{code}</span>
        <CopyButton text={code} testId="pairing-code-copy" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-mf-status text-mf-text-tertiary">
          Expires in {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
        <button
          data-testid="pairing-regenerate-code"
          onClick={onGenerate}
          disabled={generating}
          className="text-mf-small text-mf-accent hover:underline disabled:opacity-50"
        >
          Generate new
        </button>
      </div>
    </div>
  );
}
