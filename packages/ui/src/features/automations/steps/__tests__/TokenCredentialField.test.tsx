/**
 * TokenCredentialField — the paste-a-token connect flow (Notion, Azure
 * DevOps, and any label with no `PROVIDER_COPY` entry). Replaces the old
 * `placeholder-token-<service>` write: the token typed here is exactly what
 * reaches `putCredential`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAutomationsStore } from '../../data/use-automations-store';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { TokenCredentialField } from '../TokenCredentialField';

describe('TokenCredentialField', () => {
  beforeEach(() => {
    useAutomationsStore.setState({ credentials: [], gateway: fakeGateway() });
  });

  it('renders a "Connect <displayName>…" button, then a token field on click', async () => {
    const user = userEvent.setup();
    render(<TokenCredentialField service="notion" onChange={vi.fn()} testId="automations-credential-a" />);
    expect(screen.getByTestId('automations-credential-a-connect')).toHaveTextContent('Connect Notion…');

    await user.click(screen.getByTestId('automations-credential-a-connect'));

    expect(screen.getByTestId('automations-credential-a-token')).toBeInTheDocument();
    expect(screen.getByText(/server-side secret/i)).toBeInTheDocument();
  });

  it("ado's copy names the org-scoped requirement and the PAT deprecation dates", async () => {
    const user = userEvent.setup();
    render(<TokenCredentialField service="ado" onChange={vi.fn()} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    const copy = screen.getByText(/organization-scoped/i);
    expect(copy).toHaveTextContent('2026-03-15');
    expect(copy).toHaveTextContent('2026-12-01');
  });

  it('a label with no provider copy renders the field with no explanatory paragraph', async () => {
    const user = userEvent.setup();
    render(<TokenCredentialField service="some-service" onChange={vi.fn()} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    expect(screen.getByTestId('automations-credential-a-token')).toBeInTheDocument();
    expect(screen.queryByText(/server-side secret|organization-scoped/i)).not.toBeInTheDocument();
  });

  it('saving calls the gateway with the pasted token, updates the store, and calls onChange', async () => {
    const user = userEvent.setup();
    const putCredential = vi.fn(async () => {});
    useAutomationsStore.setState({ gateway: fakeGateway({ putCredential }) });
    const onChange = vi.fn();
    render(<TokenCredentialField service="notion" onChange={onChange} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    await user.type(screen.getByTestId('automations-credential-a-token'), 'secret_1234');
    await user.click(screen.getByTestId('automations-credential-a-save'));

    expect(putCredential).toHaveBeenCalledWith('notion', 'secret_1234');
    expect(useAutomationsStore.getState().credentials).toContain('notion');
    expect(onChange).toHaveBeenCalledWith('notion');
  });

  it('the save button is disabled until a token is entered', async () => {
    const user = userEvent.setup();
    render(<TokenCredentialField service="notion" onChange={vi.fn()} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    expect(screen.getByTestId('automations-credential-a-save')).toBeDisabled();
    await user.type(screen.getByTestId('automations-credential-a-token'), 'x');
    expect(screen.getByTestId('automations-credential-a-save')).toBeEnabled();
  });
});
