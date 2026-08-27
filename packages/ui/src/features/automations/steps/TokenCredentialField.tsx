/**
 * TokenCredentialField — the paste-a-token half of `CredentialConnect`
 * (Notion, Azure DevOps, and any future token-auth connector with no OAuth
 * story). Replaces the old placeholder-token write: the token the user
 * pastes here is exactly what `PUT /api/automation-credentials/:label`
 * stores, and it is never read back — connected state comes only from the
 * store's `credentials` label list.
 */
import { useState } from 'react';
import { ExternalLink, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mfToast } from '@/lib/toast';
import { useAutomationsStore } from '../data/use-automations-store';
import { PROVIDER_COPY, providerDisplayName } from './provider-copy';

export interface TokenCredentialFieldProps {
  service: string;
  onChange: (label: string | undefined) => void;
  testId: string;
  /** Overrides the collapsed trigger's `Connect {name}…`, for a provider that offers a second connect path this one has to be distinguishable from. */
  connectLabel?: string;
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export function TokenCredentialField({ service, onChange, testId, connectLabel }: TokenCredentialFieldProps) {
  const gateway = useAutomationsStore((s) => s.gateway);
  const addCredential = useAutomationsStore((s) => s.addCredential);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = PROVIDER_COPY[service];
  const displayName = providerDisplayName(service);

  async function connect() {
    const trimmed = token.trim();
    if (busy || !trimmed) return;
    setBusy(true);
    try {
      await gateway.putCredential(service, trimmed);
      addCredential(service);
      onChange(service);
      setToken('');
      setOpen(false);
    } catch (err) {
      mfToast.error(`Could not connect ${displayName}`, { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        data-testid={`${testId}-connect`}
        onClick={() => setOpen(true)}
        className="gap-1.5 border-[0.5px] bg-card font-semibold text-primary"
      >
        <Plug size={12} aria-hidden />
        {connectLabel ?? `Connect ${displayName}…`}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border-[0.5px] border-border bg-card p-2.5">
      {copy?.description && (
        <p className="text-xs text-muted-foreground">
          {copy.description}
          {copy.linkHref && (
            <>
              {' '}
              <a
                href={copy.linkHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary underline"
              >
                {copy.linkLabel}
                <ExternalLink size={10} aria-hidden />
              </a>
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          data-testid={`${testId}-token`}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste token"
          className="h-8"
        />
        <Button
          size="sm"
          data-testid={`${testId}-save`}
          disabled={busy || !token.trim()}
          onClick={() => void connect()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
