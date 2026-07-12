/**
 * CredentialConnect — "Connect <service>…" ↔ connected pill (ts153
 * wf2-stepconfig.jsx `WfCredentialField`, ported onto the real
 * `useAutomationsStore` credentials list + gateway routes instead of a local
 * `window.WF2_CREDENTIALS` mock). TDD: test written first, implemented
 * after.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAutomationsStore } from '../../data/use-automations-store';
import type { AutomationsGateway } from '../../data/gateway';
import { CredentialConnect } from '../CredentialConnect';

function fakeGateway(overrides: Partial<AutomationsGateway> = {}): AutomationsGateway {
  return {
    listAutomations: async () => [],
    createAutomation: async () => {
      throw new Error('not implemented');
    },
    getAutomation: async () => {
      throw new Error('not implemented');
    },
    updateAutomation: async () => {
      throw new Error('not implemented');
    },
    deleteAutomation: async () => {},
    setEnabled: async () => {
      throw new Error('not implemented');
    },
    startRun: async () => {
      throw new Error('not implemented');
    },
    listRuns: async () => [],
    getRun: async () => {
      throw new Error('not implemented');
    },
    cancelRun: async () => {},
    listInteractions: async () => [],
    respondInteraction: async () => {},
    listActions: async () => [],
    listCredentialLabels: async () => [],
    putCredential: async () => {},
    deleteCredential: async () => {},
    ...overrides,
  };
}

describe('CredentialConnect', () => {
  beforeEach(() => {
    useAutomationsStore.setState({ credentials: [], gateway: fakeGateway() });
  });

  it('renders a "Connect <service>…" button when not connected', () => {
    render(<CredentialConnect service="GitHub" onChange={vi.fn()} testId="automations-credential-a" />);
    expect(screen.getByTestId('automations-credential-a-connect')).toHaveTextContent('Connect GitHub…');
  });

  it('renders a connected pill with the credential label when already connected', () => {
    useAutomationsStore.setState({ credentials: ['GitHub'] });
    render(<CredentialConnect service="GitHub" onChange={vi.fn()} testId="automations-credential-a" />);
    expect(screen.getByTestId('automations-credential-a-connected')).toHaveTextContent('GitHub');
    expect(screen.queryByTestId('automations-credential-a-connect')).not.toBeInTheDocument();
  });

  it('connecting calls the gateway, updates the store, and calls onChange with the label', async () => {
    const user = userEvent.setup();
    const putCredential = vi.fn(async () => {});
    useAutomationsStore.setState({ gateway: fakeGateway({ putCredential }) });
    const onChange = vi.fn();
    render(<CredentialConnect service="GitHub" onChange={onChange} testId="automations-credential-a" />);

    await user.click(screen.getByTestId('automations-credential-a-connect'));

    expect(putCredential).toHaveBeenCalledWith('GitHub', expect.any(String));
    expect(useAutomationsStore.getState().credentials).toContain('GitHub');
    expect(onChange).toHaveBeenCalledWith('GitHub');
  });

  it('disconnecting calls the gateway, updates the store, and calls onChange(undefined)', async () => {
    const user = userEvent.setup();
    const deleteCredential = vi.fn(async () => {});
    useAutomationsStore.setState({ credentials: ['GitHub'], gateway: fakeGateway({ deleteCredential }) });
    const onChange = vi.fn();
    render(<CredentialConnect service="GitHub" onChange={onChange} testId="automations-credential-a" />);

    await user.click(screen.getByTestId('automations-credential-a-disconnect'));

    expect(deleteCredential).toHaveBeenCalledWith('GitHub');
    expect(useAutomationsStore.getState().credentials).not.toContain('GitHub');
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
