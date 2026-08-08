/**
 * WebhookTriggerCard — a webhook trigger's registration state.
 *
 * The card this replaces printed a `https://hooks.mainframe.app/w/<hookId>`
 * URL that nothing serves, an unconditional "Signature verified", and a
 * sample-capture promise with no implementation. Everything here is either
 * returned by the daemon (`registration.url`, `lastDeliveryAt`) or states
 * what is not yet true. The URL is a **local** ingest endpoint — the daemon
 * has no public tunnel — so the card says so instead of implying reach.
 *
 * `registration` only arrives from `GET /api/automations/:id`, which the
 * editor never calls (it seeds from the list route), so a saved automation's
 * armed hook reads as unregistered here until Register is pressed. That is
 * safe: `arm_webhook` is idempotent and returns the existing registration.
 *
 * Register needs the trigger to be **saved**, not just the automation: the
 * daemon resolves the hook id from the stored definition, so registering a
 * trigger added since the last save 404s. The card gates on the store's copy
 * of the definition rather than surfacing that not-found.
 *
 * The HMAC signing secret is **register-response-only** — reads serialize the
 * bare `WebhookRegistration`, which has no field for it. So it lives in
 * component state, never in the trigger handed to `onChange`, and the only
 * way back to it is another register call (idempotent, non-rotating), which
 * is why the armed card keeps a reveal button.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Globe, KeyRound } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { mfToast } from '@/lib/toast';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';
import type { WebhookRegistration, WebhookTrigger } from '../contract';
import { useAutomationsStore } from '../data/use-automations-store';

const SAVE_FIRST = 'Save the automation first';

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function deliveryLine(lastDeliveryAt: string | null): string {
  if (!lastDeliveryAt) return 'No deliveries yet';
  const ts = Date.parse(lastDeliveryAt);
  // An unreadable stamp is still a delivery — showing it verbatim beats claiming none.
  return Number.isNaN(ts) ? `Last delivery ${lastDeliveryAt}` : `Last delivery ${formatRelativeTime(ts, Date.now())}`;
}

/** Register alone answers with the secret; read it structurally rather than widen a type this file doesn't own. */
function revealedSecret(registration: WebhookRegistration): string | null {
  const value = (registration as { secret?: unknown }).secret;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Rebuilt field by field, not spread: whatever reaches `onChange` gets saved, broadcast, and logged. */
function withoutSecret(registration: WebhookRegistration): WebhookRegistration {
  return { hookId: registration.hookId, url: registration.url, lastDeliveryAt: registration.lastDeliveryAt };
}

async function copyWebhookUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    mfToast.success('Webhook URL copied');
  } catch (err) {
    mfToast.error('Could not copy the webhook URL', { description: errorMessage(err) });
  }
}

async function copySigningSecret(secret: string) {
  try {
    await navigator.clipboard.writeText(secret);
    mfToast.success('Signing secret copied');
  } catch {
    // No description: a clipboard rejection says nothing useful, and the secret must reach no message.
    mfToast.error('Could not copy the signing secret');
  }
}

interface CopyRowProps {
  icon: ReactNode;
  value: string;
  valueTestId: string;
  copyTestId: string;
  copyLabel: string;
  onCopy: () => void;
}

function CopyRow({ icon, value, valueTestId, copyTestId, copyLabel, onCopy }: CopyRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <code data-testid={valueTestId} className="min-w-0 flex-1 truncate select-all font-mono text-xs text-foreground">
        {value}
      </code>
      <Hint label={copyLabel}>
        <button
          type="button"
          data-testid={copyTestId}
          onClick={onCopy}
          aria-label={copyLabel}
          className="flex size-[20px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
        >
          <Copy size={11} aria-hidden />
        </button>
      </Hint>
    </div>
  );
}

interface UnregisteredWebhookProps {
  testId: string;
  persisted: boolean;
  registering: boolean;
  onRegister: () => void;
}

function UnregisteredWebhook({ testId, persisted, registering, onRegister }: UnregisteredWebhookProps) {
  return (
    <div
      data-testid={`${testId}-webhook`}
      className="mt-1.5 flex flex-col items-start gap-1.5 rounded-md border-[0.5px] border-dashed border-border bg-card/60 p-2"
    >
      <div className="text-xs text-muted-foreground">
        {persisted
          ? 'The daemon hasn’t registered this hook yet — there is no URL to call.'
          : 'Save the automation first — the daemon registers hooks from the saved definition.'}
      </div>
      <button
        type="button"
        data-testid={`${testId}-webhook-register`}
        onClick={onRegister}
        disabled={!persisted || registering}
        title={persisted ? undefined : SAVE_FIRST}
        className="h-[24px] rounded-sm border-[0.5px] border-border px-2 text-xs font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        {registering ? 'Registering…' : 'Register'}
      </button>
    </div>
  );
}

interface RegisteredWebhookProps {
  testId: string;
  registration: WebhookRegistration;
  /** Only ever a value the register call just returned — never read back from a stored registration. */
  secret: string | null;
  persisted: boolean;
  registering: boolean;
  onReveal: () => void;
}

function RegisteredWebhook({ testId, registration, secret, persisted, registering, onReveal }: RegisteredWebhookProps) {
  return (
    <div
      data-testid={`${testId}-webhook`}
      className="mt-1.5 flex flex-col gap-1.5 rounded-md border-[0.5px] border-border bg-card p-2"
    >
      <CopyRow
        icon={<Globe size={11} className="shrink-0 text-muted-foreground" aria-hidden />}
        value={registration.url}
        valueTestId={`${testId}-webhook-url`}
        copyTestId={`${testId}-webhook-copy-url`}
        copyLabel="Copy webhook URL"
        onCopy={() => void copyWebhookUrl(registration.url)}
      />
      <div className="text-xs text-muted-foreground">Local daemon URL — reachable only from this machine.</div>
      {secret ? (
        <>
          <CopyRow
            icon={<KeyRound size={11} className="shrink-0 text-muted-foreground" aria-hidden />}
            value={secret}
            valueTestId={`${testId}-webhook-secret`}
            copyTestId={`${testId}-webhook-copy-secret`}
            copyLabel="Copy signing secret"
            onCopy={() => void copySigningSecret(secret)}
          />
          <div data-testid={`${testId}-webhook-secret-note`} className="text-xs text-muted-foreground">
            Signing secret — sign every delivery with it. Shown once here; reveal it again any time, it never changes.
          </div>
        </>
      ) : null}
      <button
        type="button"
        data-testid={`${testId}-webhook-reveal-secret`}
        onClick={onReveal}
        disabled={!persisted || registering}
        title={persisted ? undefined : SAVE_FIRST}
        className="h-[24px] self-start rounded-sm border-[0.5px] border-border px-2 text-xs font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        {registering ? 'Revealing…' : secret ? 'Reveal again' : 'Reveal signing secret'}
      </button>
      <div data-testid={`${testId}-webhook-delivery`} className="text-xs text-muted-foreground">
        {deliveryLine(registration.lastDeliveryAt)}
      </div>
    </div>
  );
}

export interface WebhookTriggerCardProps {
  trigger: WebhookTrigger;
  onChange: (next: WebhookTrigger) => void;
  /** Absent until the automation is saved — the register route is keyed by it. */
  automationId?: string;
  testId: string;
}

export function WebhookTriggerCard({ trigger, onChange, automationId, testId }: WebhookTriggerCardProps) {
  const gateway = useAutomationsStore((s) => s.gateway);
  const saved = useAutomationsStore((s) =>
    automationId ? s.definitions.find((d) => d.id === automationId) : undefined,
  );
  const [registering, setRegistering] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const registration = trigger.registration;
  const persisted = saved?.definition.triggers.some((t) => t.id === trigger.id) ?? false;

  async function handleRegister() {
    if (!automationId || !persisted || registering) return;
    setRegistering(true);
    try {
      const next = await gateway.registerWebhook(automationId, trigger.id);
      setSecret(revealedSecret(next));
      onChange({ ...trigger, registration: withoutSecret(next) });
    } catch (err) {
      mfToast.error('Could not register the webhook', { description: errorMessage(err) });
    } finally {
      setRegistering(false);
    }
  }

  if (!registration) {
    return (
      <UnregisteredWebhook
        testId={testId}
        persisted={persisted}
        registering={registering}
        onRegister={() => void handleRegister()}
      />
    );
  }

  return (
    <RegisteredWebhook
      testId={testId}
      registration={registration}
      secret={secret}
      persisted={persisted}
      registering={registering}
      onReveal={() => void handleRegister()}
    />
  );
}
