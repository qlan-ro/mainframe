/**
 * WebhookTriggerCard — the webhook trigger's registration surface.
 *
 * The card it replaces invented a `https://hooks.mainframe.app/w/<hookId>`
 * URL, claimed "Signature verified" unconditionally, and promised a sample-
 * capture feature that does not exist. Those three are pinned here BY
 * ABSENCE: the only URL this card may show is the one the daemon returned.
 * TDD: tests written first, implemented after.
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

import type { AutomationSummary, WebhookRegistration, WebhookTrigger } from '../../contract';
import { createFakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsStore } from '../../data/use-automations-store';
import { WebhookTriggerCard } from '../WebhookTriggerCard';

const TRIGGER: WebhookTrigger = { id: 't1', kind: 'webhook', hookId: 'hook-1' };

const REGISTRATION: WebhookRegistration = {
  hookId: 'hook-1',
  url: 'http://127.0.0.1:31415/api/automation-webhooks/hook-1',
  lastDeliveryAt: null,
};

function registered(lastDeliveryAt: string | null = null): WebhookTrigger {
  return { ...TRIGGER, registration: { ...REGISTRATION, lastDeliveryAt } };
}

function savedAutomation(triggers: WebhookTrigger[] = [TRIGGER]): AutomationSummary {
  return {
    id: 'auto-1',
    name: 'My automation',
    scope: 'project',
    projectId: 'proj-1',
    enabled: true,
    definition: { triggers, steps: [] },
    createdAt: 0,
    updatedAt: 0,
  };
}

function seedGateway(registerWebhook: () => Promise<WebhookRegistration>) {
  useAutomationsStore.setState({ gateway: createFakeGateway({ registerWebhook }) });
}

function seedDefinitions(definitions: AutomationSummary[]) {
  useAutomationsStore.setState({ definitions });
}

const SECRET = 'whsec_test';

/** The register route answers with a field the read type has no room for — hence the assertion. */
function registrationWithSecret(): WebhookRegistration {
  return { ...REGISTRATION, secret: SECRET } as WebhookRegistration;
}

/** The real editor is controlled: it feeds `onChange`'s trigger straight back in. */
function ControlledCard({ initial, onChange }: { initial: WebhookTrigger; onChange?: (next: WebhookTrigger) => void }) {
  const [trigger, setTrigger] = useState(initial);
  return (
    <WebhookTriggerCard
      trigger={trigger}
      onChange={(next) => {
        setTrigger(next);
        onChange?.(next);
      }}
      automationId="auto-1"
      testId="trig"
    />
  );
}

beforeEach(() => {
  useAutomationsStore.setState({ gateway: createFakeGateway(), definitions: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('WebhookTriggerCard — no invented facts', () => {
  it('shows no fabricated public URL for an unregistered hook', () => {
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.queryByText(/hooks\.mainframe\.app/)).not.toBeInTheDocument();
  });

  it('never claims the signature is verified', () => {
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.queryByText(/Signature verified/)).not.toBeInTheDocument();
  });

  it('does not promise a sample-capture feature that does not exist', () => {
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.queryByText(/No sample captured yet/)).not.toBeInTheDocument();
  });
});

describe('WebhookTriggerCard — unregistered', () => {
  it('says the daemon has not registered the hook', () => {
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.getByTestId('trig-webhook')).toHaveTextContent(
      'The daemon hasn’t registered this hook yet — there is no URL to call.',
    );
  });

  it('offers no copy button, because there is nothing to copy', () => {
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.queryByTestId('trig-webhook-copy-url')).not.toBeInTheDocument();
  });

  it('disables Register on an unsaved automation and says why', () => {
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} testId="trig" />);
    expect(screen.getByTestId('trig-webhook-register')).toBeDisabled();
    expect(screen.getByTestId('trig-webhook')).toHaveTextContent(
      'Save the automation first — the daemon registers hooks from the saved definition.',
    );
  });

  it('disables Register when the trigger is not in the saved definition and says why', () => {
    seedDefinitions([savedAutomation([])]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.getByTestId('trig-webhook-register')).toBeDisabled();
    expect(screen.getByTestId('trig-webhook')).toHaveTextContent(
      'Save the automation first — the daemon registers hooks from the saved definition.',
    );
  });

  it('never calls the gateway when clicking a disabled Register button', async () => {
    const user = userEvent.setup();
    const registerWebhook = vi.fn().mockResolvedValue(REGISTRATION);
    seedGateway(registerWebhook);
    seedDefinitions([savedAutomation([])]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    expect(registerWebhook).not.toHaveBeenCalled();
  });

  it('registers through the gateway with the automation and trigger ids', async () => {
    const user = userEvent.setup();
    const registerWebhook = vi.fn().mockResolvedValue(REGISTRATION);
    seedGateway(registerWebhook);
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    expect(registerWebhook).toHaveBeenCalledWith('auto-1', 't1');
  });

  it('patches the trigger with the registration the daemon returned', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    seedGateway(vi.fn().mockResolvedValue(REGISTRATION));
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={onChange} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...TRIGGER, registration: REGISTRATION }));
  });

  it('disables the button while the call is in flight', async () => {
    const user = userEvent.setup();
    let release: (value: WebhookRegistration) => void = () => {};
    seedGateway(() => new Promise<WebhookRegistration>((resolve) => (release = resolve)));
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    expect(screen.getByTestId('trig-webhook-register')).toBeDisabled();
    release(REGISTRATION);
    await waitFor(() => expect(screen.getByTestId('trig-webhook-register')).toBeEnabled());
  });

  it('raises a toast and patches nothing when registration fails', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    seedGateway(vi.fn().mockRejectedValue(new Error('automation or webhook trigger not found')));
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={onChange} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not register the webhook', {
        description: 'automation or webhook trigger not found',
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('WebhookTriggerCard — registered', () => {
  it('shows the URL the daemon returned', () => {
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.getByTestId('trig-webhook-url')).toHaveTextContent(REGISTRATION.url);
  });

  it('states the URL is reachable only from this machine', () => {
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.getByText('Local daemon URL — reachable only from this machine.')).toBeInTheDocument();
  });

  it('offers no Register button once the hook is armed', () => {
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.queryByTestId('trig-webhook-register')).not.toBeInTheDocument();
  });

  it('reports no deliveries when lastDeliveryAt is null', () => {
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.getByTestId('trig-webhook-delivery')).toHaveTextContent('No deliveries yet');
  });

  it('reports the last delivery relative to now', () => {
    // Pinned to midday: run a few minutes after real midnight, "5 minutes ago"
    // falls on the previous calendar day and formats as "Yesterday".
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const trigger = registered(new Date(Date.now() - 5 * 60_000).toISOString());
    render(<WebhookTriggerCard trigger={trigger} onChange={vi.fn()} automationId="auto-1" testId="trig" />);
    expect(screen.getByTestId('trig-webhook-delivery')).toHaveTextContent('Last delivery 5m');
  });

  it('shows an unparseable delivery stamp verbatim rather than claiming none', () => {
    render(
      <WebhookTriggerCard trigger={registered('whenever')} onChange={vi.fn()} automationId="auto-1" testId="trig" />,
    );
    expect(screen.getByTestId('trig-webhook-delivery')).toHaveTextContent('Last delivery whenever');
  });

  // fireEvent, not userEvent: `userEvent.setup()` installs its own clipboard
  // stub on `navigator.clipboard`, shadowing this mock (see markdown-text.test).
  it('copies the URL to the clipboard and confirms with a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    fireEvent.click(screen.getByTestId('trig-webhook-copy-url'));

    expect(writeText).toHaveBeenCalledWith(REGISTRATION.url);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Webhook URL copied'));
  });
});

describe('WebhookTriggerCard — signing secret', () => {
  it('shows the secret the register call returned', async () => {
    const user = userEvent.setup();
    seedGateway(vi.fn().mockResolvedValue(registrationWithSecret()));
    seedDefinitions([savedAutomation()]);
    render(<ControlledCard initial={TRIGGER} />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    expect(await screen.findByTestId('trig-webhook-secret')).toHaveTextContent('whsec_test');
  });

  it('keeps the secret out of the trigger it patches', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    seedGateway(vi.fn().mockResolvedValue(registrationWithSecret()));
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={onChange} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [patched] = onChange.mock.calls[0] as [WebhookTrigger];
    expect(patched.registration).toEqual({
      hookId: 'hook-1',
      url: 'http://127.0.0.1:31415/api/automation-webhooks/hook-1',
      lastDeliveryAt: null,
    });
    expect(Object.keys(patched.registration ?? {})).not.toContain('secret');
  });

  it('shows no secret when the register response carries none', async () => {
    const user = userEvent.setup();
    seedGateway(vi.fn().mockResolvedValue(REGISTRATION));
    seedDefinitions([savedAutomation()]);
    render(<ControlledCard initial={TRIGGER} />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    expect(await screen.findByTestId('trig-webhook-url')).toBeInTheDocument();
    expect(screen.queryByTestId('trig-webhook-secret')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trig-webhook-secret-note')).not.toBeInTheDocument();
  });

  it('shows no secret for a stored registration, only the reveal button', () => {
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    expect(screen.queryByTestId('trig-webhook-secret')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trig-webhook-secret-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('trig-webhook-reveal-secret')).toBeEnabled();
  });

  it('disables Reveal when the trigger is not in the saved definition and says why', async () => {
    const user = userEvent.setup();
    seedDefinitions([savedAutomation([])]);
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    const button = screen.getByTestId('trig-webhook-reveal-secret');
    expect(button).toBeDisabled();
    // The hint wraps the button — a disabled button never emits the hover itself.
    await user.hover(button.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Save the automation first');
  });

  it('says the secret is shown once and can be revealed again', async () => {
    const user = userEvent.setup();
    seedGateway(vi.fn().mockResolvedValue(registrationWithSecret()));
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-reveal-secret'));

    expect(await screen.findByTestId('trig-webhook-secret-note')).toHaveTextContent(
      'Signing secret — sign every delivery with it. Shown once here; reveal it again any time, it never changes.',
    );
  });

  // fireEvent, not userEvent: `userEvent.setup()` installs its own clipboard
  // stub on `navigator.clipboard`, shadowing this mock (see markdown-text.test).
  it('copies the secret to the clipboard and confirms with a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    seedGateway(vi.fn().mockResolvedValue(registrationWithSecret()));
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    fireEvent.click(screen.getByTestId('trig-webhook-reveal-secret'));
    fireEvent.click(await screen.findByTestId('trig-webhook-copy-secret'));

    expect(writeText).toHaveBeenCalledWith('whsec_test');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Signing secret copied'));
  });

  it('reveals the same secret again through another register call', async () => {
    const user = userEvent.setup();
    const registerWebhook = vi.fn().mockResolvedValue(registrationWithSecret());
    seedGateway(registerWebhook);
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-reveal-secret'));
    expect(await screen.findByTestId('trig-webhook-secret')).toHaveTextContent('whsec_test');

    await user.click(screen.getByTestId('trig-webhook-reveal-secret'));

    await waitFor(() => expect(registerWebhook).toHaveBeenCalledTimes(2));
    expect(registerWebhook).toHaveBeenLastCalledWith('auto-1', 't1');
    expect(screen.getByTestId('trig-webhook-secret')).toHaveTextContent('whsec_test');
  });

  it('leaks nothing when the reveal call fails', async () => {
    const user = userEvent.setup();
    seedGateway(vi.fn().mockRejectedValue(new Error('automation or webhook trigger not found')));
    seedDefinitions([savedAutomation()]);
    render(<WebhookTriggerCard trigger={registered()} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-reveal-secret'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not register the webhook', {
        description: 'automation or webhook trigger not found',
      }),
    );
    expect(screen.queryByTestId('trig-webhook-secret')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('whsec_');
  });
});
