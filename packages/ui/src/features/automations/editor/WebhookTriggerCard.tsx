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
 */
import { useState } from 'react';
import { Copy, Globe } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { mfToast } from '@/lib/toast';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';
import type { WebhookTrigger } from '../contract';
import { useAutomationsStore } from '../data/use-automations-store';

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function deliveryLine(lastDeliveryAt: string | null): string {
  if (!lastDeliveryAt) return 'No deliveries yet';
  const ts = Date.parse(lastDeliveryAt);
  // An unreadable stamp is still a delivery — showing it verbatim beats claiming none.
  return Number.isNaN(ts) ? `Last delivery ${lastDeliveryAt}` : `Last delivery ${formatRelativeTime(ts, Date.now())}`;
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
  const [registering, setRegistering] = useState(false);
  const registration = trigger.registration;

  async function handleRegister() {
    if (!automationId || registering) return;
    setRegistering(true);
    try {
      const next = await gateway.registerWebhook(automationId, trigger.id);
      onChange({ ...trigger, registration: next });
    } catch (err) {
      mfToast.error('Could not register the webhook', { description: errorMessage(err) });
    } finally {
      setRegistering(false);
    }
  }

  async function handleCopy() {
    try {
      if (!registration) return;
      await navigator.clipboard.writeText(registration.url);
      mfToast.success('Webhook URL copied');
    } catch (err) {
      mfToast.error('Could not copy the webhook URL', { description: errorMessage(err) });
    }
  }

  if (!registration) {
    return (
      <div
        data-testid={`${testId}-webhook`}
        className="mt-1.5 flex flex-col items-start gap-1.5 rounded-md border-[0.5px] border-dashed border-border bg-card/60 p-2"
      >
        <div className="text-caption text-muted-foreground">
          The daemon hasn’t registered this hook yet — there is no URL to call.
        </div>
        <button
          type="button"
          data-testid={`${testId}-webhook-register`}
          onClick={() => void handleRegister()}
          disabled={!automationId || registering}
          title={automationId ? undefined : 'Save the automation first'}
          className="h-[24px] rounded-sm border-[0.5px] border-border px-2 text-caption font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          {registering ? 'Registering…' : 'Register'}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid={`${testId}-webhook`}
      className="mt-1.5 flex flex-col gap-1.5 rounded-md border-[0.5px] border-border bg-card p-2"
    >
      <div className="flex items-center gap-1.5">
        <Globe size={11} className="shrink-0 text-muted-foreground" aria-hidden />
        <code
          data-testid={`${testId}-webhook-url`}
          className="min-w-0 flex-1 truncate select-all font-mono text-caption text-foreground"
        >
          {registration.url}
        </code>
        <Hint label="Copy URL">
          <button
            type="button"
            data-testid={`${testId}-webhook-copy-url`}
            onClick={() => void handleCopy()}
            aria-label="Copy webhook URL"
            className="flex size-[20px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
          >
            <Copy size={11} aria-hidden />
          </button>
        </Hint>
      </div>
      <div className="text-caption text-muted-foreground">Local daemon URL — reachable only from this machine.</div>
      <div data-testid={`${testId}-webhook-delivery`} className="text-caption text-muted-foreground">
        {deliveryLine(registration.lastDeliveryAt)}
      </div>
    </div>
  );
}
