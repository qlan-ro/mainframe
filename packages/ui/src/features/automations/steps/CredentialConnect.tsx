/**
 * CredentialConnect — "Connect <service>…" once per service, then a
 * connected pill with a disconnect affordance (ts153 wf2-stepconfig.jsx
 * `WfCredentialField`, ported onto the real `useAutomationsStore`
 * credentials list + `AutomationsGateway` routes).
 *
 * Dispatches to the real per-provider connect flow: `GithubCredentialConnect`
 * (a pasted token always, plus device flow once a GitHub App client ID is
 * configured) for `github`, `TokenCredentialField` (a pasted token, real
 * since the 2026-08-19 provider-connections plan — no more
 * `placeholder-token-<service>`) for everything else. `onChange` patches the
 * OWNING step's `credential` field (top-level on `RunActionStep`, not inside
 * `params` — contract §1) with the label, or `undefined` on disconnect.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { mfToast } from '@/lib/toast';
import { useAutomationsStore } from '../data/use-automations-store';
import { GithubCredentialConnect } from './GithubCredentialConnect';
import { providerDisplayName } from './provider-copy';
import { TokenCredentialField } from './TokenCredentialField';

export interface CredentialConnectProps {
  service: string;
  onChange: (label: string | undefined) => void;
  testId: string;
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export function CredentialConnect({ service, onChange, testId }: CredentialConnectProps) {
  const credentials = useAutomationsStore((s) => s.credentials);
  const gateway = useAutomationsStore((s) => s.gateway);
  const removeCredential = useAutomationsStore((s) => s.removeCredential);
  const [busy, setBusy] = useState(false);
  const connected = credentials.includes(service);

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await gateway.deleteCredential(service);
      removeCredential(service);
      onChange(undefined);
    } catch (err) {
      mfToast.error(`Could not disconnect ${providerDisplayName(service)}`, { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (connected) {
    return (
      <span
        data-testid={`${testId}-connected`}
        className="inline-flex h-[28px] items-center gap-1.5 rounded-full border-[0.5px] border-success/40 bg-success/10 pl-2.5 pr-1"
      >
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        <span className="text-xs text-foreground">{providerDisplayName(service)}</span>
        <button
          type="button"
          data-testid={`${testId}-disconnect`}
          onClick={() => void disconnect()}
          disabled={busy}
          aria-label={`Disconnect ${providerDisplayName(service)}`}
          className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X size={10} aria-hidden />
        </button>
      </span>
    );
  }

  if (service === 'github') {
    return <GithubCredentialConnect onChange={onChange} testId={testId} />;
  }
  return <TokenCredentialField service={service} onChange={onChange} testId={testId} />;
}
