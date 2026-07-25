/**
 * WebhookTriggerCard — the webhook trigger's registration surface.
 *
 * The card it replaces invented a `https://hooks.mainframe.app/w/<hookId>`
 * URL, claimed "Signature verified" unconditionally, and promised a sample-
 * capture feature that does not exist. Those three are pinned here BY
 * ABSENCE: the only URL this card may show is the one the daemon returned.
 * TDD: tests written first, implemented after.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

import type { WebhookRegistration, WebhookTrigger } from '../../contract';
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

function seedGateway(registerWebhook: () => Promise<WebhookRegistration>) {
  useAutomationsStore.setState({ gateway: createFakeGateway({ registerWebhook }) });
}

beforeEach(() => {
  useAutomationsStore.setState({ gateway: createFakeGateway() });
});

afterEach(() => {
  vi.clearAllMocks();
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
    const button = screen.getByTestId('trig-webhook-register');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Save the automation first');
  });

  it('registers through the gateway with the automation and trigger ids', async () => {
    const user = userEvent.setup();
    const registerWebhook = vi.fn().mockResolvedValue(REGISTRATION);
    seedGateway(registerWebhook);
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={vi.fn()} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    expect(registerWebhook).toHaveBeenCalledWith('auto-1', 't1');
  });

  it('patches the trigger with the registration the daemon returned', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    seedGateway(vi.fn().mockResolvedValue(REGISTRATION));
    render(<WebhookTriggerCard trigger={TRIGGER} onChange={onChange} automationId="auto-1" testId="trig" />);

    await user.click(screen.getByTestId('trig-webhook-register'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...TRIGGER, registration: REGISTRATION }));
  });

  it('disables the button while the call is in flight', async () => {
    const user = userEvent.setup();
    let release: (value: WebhookRegistration) => void = () => {};
    seedGateway(() => new Promise<WebhookRegistration>((resolve) => (release = resolve)));
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
