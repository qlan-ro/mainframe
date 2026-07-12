/**
 * CredentialConnect — "Connect <service>…" once per service, then a
 * connected pill with a disconnect affordance (ts153 wf2-stepconfig.jsx
 * `WfCredentialField`, ported off `window.WF2_CREDENTIALS` onto the real
 * `useAutomationsStore` credentials list + `AutomationsGateway` routes —
 * self-sufficient like `LibraryRow`, per `AutomationEditor`'s doc comment).
 *
 * This app has no OAuth flow yet (contract §3: credentials are opaque
 * labelled tokens in a flat file) — connecting stores a placeholder token
 * under the service's own name as its label, matching the one-account-per-
 * service model the six fixtures assume. `onChange` patches the OWNING
 * step's `credential` field (top-level on `RunActionStep`, not inside
 * `params` — contract §1) with the label, or `undefined` on disconnect.
 */
import { useState } from 'react';
import { Plug, X } from 'lucide-react';
import { mfToast } from '@/lib/toast';
import { useAutomationsStore } from '../data/use-automations-store';

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
  const addCredential = useAutomationsStore((s) => s.addCredential);
  const removeCredential = useAutomationsStore((s) => s.removeCredential);
  const [busy, setBusy] = useState(false);
  const connected = credentials.includes(service);

  async function connect() {
    if (busy) return;
    setBusy(true);
    try {
      await gateway.putCredential(service, `placeholder-token-${service}`);
      addCredential(service);
      onChange(service);
    } catch (err) {
      mfToast.error(`Could not connect ${service}`, { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await gateway.deleteCredential(service);
      removeCredential(service);
      onChange(undefined);
    } catch (err) {
      mfToast.error(`Could not disconnect ${service}`, { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (connected) {
    return (
      <span
        data-testid={`${testId}-connected`}
        className="inline-flex h-[28px] items-center gap-1.5 rounded-full border-[0.5px] border-mf-success/40 bg-mf-success-tint pl-2.5 pr-1"
      >
        <span className="size-1.5 rounded-full bg-mf-success" aria-hidden />
        <span className="text-caption text-foreground">{service}</span>
        <button
          type="button"
          data-testid={`${testId}-disconnect`}
          onClick={() => void disconnect()}
          disabled={busy}
          aria-label={`Disconnect ${service}`}
          className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X size={10} aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={`${testId}-connect`}
      onClick={() => void connect()}
      disabled={busy}
      className="inline-flex h-[28px] items-center gap-1.5 rounded-md border-[0.5px] border-border bg-card px-2.5 text-caption font-semibold text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
    >
      <Plug size={12} aria-hidden />
      Connect {service}…
    </button>
  );
}
