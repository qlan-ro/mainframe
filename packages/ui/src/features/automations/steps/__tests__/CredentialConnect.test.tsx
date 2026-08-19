/**
 * CredentialConnect — connected pill ↔ dispatch to the real per-provider
 * connect flow (device flow for `github`, a pasted token for everything
 * else). Flow-specific behavior (device polling states, the token paste
 * form) is covered in `GithubDeviceConnect.test.tsx` and
 * `TokenCredentialField.test.tsx`; this file covers only the pill and the
 * dispatch itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAutomationsStore } from '../../data/use-automations-store';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { CredentialConnect } from '../CredentialConnect';

describe('CredentialConnect', () => {
  beforeEach(() => {
    useAutomationsStore.setState({ credentials: [], gateway: fakeGateway() });
  });

  it('renders a connected pill with the provider display name when already connected', () => {
    useAutomationsStore.setState({ credentials: ['notion'] });
    render(<CredentialConnect service="notion" onChange={vi.fn()} testId="automations-credential-a" />);
    expect(screen.getByTestId('automations-credential-a-connected')).toHaveTextContent('Notion');
    expect(screen.queryByTestId('automations-credential-a-connect')).not.toBeInTheDocument();
  });

  it('falls back to the raw label for a provider with no display-name mapping', () => {
    useAutomationsStore.setState({ credentials: ['some-service'] });
    render(<CredentialConnect service="some-service" onChange={vi.fn()} testId="automations-credential-a" />);
    expect(screen.getByTestId('automations-credential-a-connected')).toHaveTextContent('some-service');
  });

  it('disconnecting calls the gateway, updates the store, and calls onChange(undefined)', async () => {
    const user = userEvent.setup();
    const deleteCredential = vi.fn(async () => {});
    useAutomationsStore.setState({ credentials: ['notion'], gateway: fakeGateway({ deleteCredential }) });
    const onChange = vi.fn();
    render(<CredentialConnect service="notion" onChange={onChange} testId="automations-credential-a" />);

    await user.click(screen.getByTestId('automations-credential-a-disconnect'));

    expect(deleteCredential).toHaveBeenCalledWith('notion');
    expect(useAutomationsStore.getState().credentials).not.toContain('notion');
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('dispatches a token-auth service (e.g. notion) to the paste-a-token flow', () => {
    render(<CredentialConnect service="notion" onChange={vi.fn()} testId="automations-credential-a" />);
    expect(screen.getByTestId('automations-credential-a-connect')).toHaveTextContent('Connect Notion…');
  });

  it('dispatches the github service to the always-available token field', async () => {
    render(<CredentialConnect service="github" onChange={vi.fn()} testId="automations-credential-a" />);
    expect(await screen.findByTestId('automations-credential-a-connect')).toHaveTextContent('Connect GitHub…');
  });
});
