/**
 * GithubCredentialConnect — the token field is always present; the
 * device-flow button is additive, gated on the daemon reporting a
 * configured GitHub App client ID.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAutomationsStore } from '../../data/use-automations-store';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { GithubCredentialConnect } from '../GithubCredentialConnect';

describe('GithubCredentialConnect', () => {
  it('renders only the token field when no GitHub App client ID is configured', async () => {
    useAutomationsStore.setState({
      credentials: [],
      gateway: fakeGateway({ githubDeviceFlowStatus: async () => ({ configured: false }) }),
    });
    render(<GithubCredentialConnect onChange={vi.fn()} testId="automations-credential-a" />);

    expect(await screen.findByTestId('automations-credential-a-connect')).toHaveTextContent('Connect GitHub…');
    expect(screen.queryByTestId('automations-credential-a-device-connect')).not.toBeInTheDocument();
  });

  it('renders both the token field and the device-flow button when a client ID is configured', async () => {
    useAutomationsStore.setState({
      credentials: [],
      gateway: fakeGateway({ githubDeviceFlowStatus: async () => ({ configured: true }) }),
    });
    render(<GithubCredentialConnect onChange={vi.fn()} testId="automations-credential-a" />);

    expect(screen.getByTestId('automations-credential-a-connect')).toHaveTextContent('Connect GitHub…');
    expect(await screen.findByTestId('automations-credential-a-device-connect')).toHaveTextContent('Connect GitHub…');
  });
});
