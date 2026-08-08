import { useState, useEffect, useCallback, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import { generatePairingCode } from '../../../../lib/api/remote-access';
import { CopyButton } from './CopyButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

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
    <div data-testid="settings-remote-access-pairing-section" className="flex flex-col gap-3">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Mobile Pairing</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Generate a code to pair a mobile device.</p>
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
        <Button size="sm" data-testid="pairing-generate-code" onClick={handleGenerate} disabled={generating}>
          {generating ? (
            <span className="flex items-center gap-1.5">
              <RotateCw className="animate-spin" />
              Generating...
            </span>
          ) : (
            'Generate Pairing Code'
          )}
        </Button>
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-center gap-3 p-4 bg-card border border-border rounded-md">
        <span className="text-2xl font-mono font-bold text-foreground" style={{ letterSpacing: '0.3em' }}>
          {code}
        </span>
        <CopyButton text={code} testId="pairing-code-copy" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Expires in {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
        <Button
          variant="link"
          size="sm"
          data-testid="pairing-regenerate-code"
          onClick={onGenerate}
          disabled={generating}
          className="h-auto p-0 text-xs"
        >
          Generate new
        </Button>
      </div>
    </div>
  );
}
