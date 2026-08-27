/**
 * GithubCredentialConnect — the token field is always present; the
 * device-flow button is additive, gated on the daemon reporting a
 * configured GitHub App client ID. When both render, their labels must
 * differ: shipping two buttons that both read "Connect GitHub…" left the
 * user with no way to choose between them.
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

  it('gives each path its own label when both render, so neither reads as the other', async () => {
    useAutomationsStore.setState({
      credentials: [],
      gateway: fakeGateway({ githubDeviceFlowStatus: async () => ({ configured: true }) }),
    });
    render(<GithubCredentialConnect onChange={vi.fn()} testId="automations-credential-a" />);

    expect(await screen.findByTestId('automations-credential-a-device-connect')).toHaveTextContent(
      'Sign in with GitHub',
    );
    expect(screen.getByTestId('automations-credential-a-connect')).toHaveTextContent('Use a personal access token…');
    expect(screen.queryAllByText('Connect GitHub…')).toHaveLength(0);
  });

  it('leads with sign-in, keeping the token path as the secondary choice below it', async () => {
    useAutomationsStore.setState({
      credentials: [],
      gateway: fakeGateway({ githubDeviceFlowStatus: async () => ({ configured: true }) }),
    });
    render(<GithubCredentialConnect onChange={vi.fn()} testId="automations-credential-a" />);

    const device = await screen.findByTestId('automations-credential-a-device-connect');
    const token = screen.getByTestId('automations-credential-a-connect');
    expect(device.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
