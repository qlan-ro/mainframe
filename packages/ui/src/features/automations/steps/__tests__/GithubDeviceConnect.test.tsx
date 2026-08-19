/**
 * GithubDeviceConnect — device-flow states: idle → starting → waiting
 * (shows the user code, polls at the daemon's interval) → connected/
 * expired/denied/error, plus the defensive `unavailable` fallback if the
 * daemon still reports no GitHub App client ID configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAutomationsStore } from '../../data/use-automations-store';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { ApiRequestError } from '@/lib/api/http';
import { GithubDeviceConnect } from '../GithubDeviceConnect';
import { openExternal } from '@/lib/tauri/bridge';

vi.mock('@/lib/tauri/bridge', () => ({ openExternal: vi.fn(async () => {}) }));

const START = {
  deviceCode: 'dc-1',
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  interval: 5,
  expiresIn: 900,
};

describe('GithubDeviceConnect', () => {
  beforeEach(() => {
    useAutomationsStore.setState({ credentials: [], gateway: fakeGateway() });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starting shows the user code and the approve-on-GitHub action', async () => {
    const user = userEvent.setup({ delay: null });
    const startGithubDeviceFlow = vi.fn(async () => START);
    const pollGithubDeviceFlow = vi.fn(async () => ({ status: 'pending' as const }));
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow, pollGithubDeviceFlow }) });
    render(<GithubDeviceConnect onChange={vi.fn()} testId="automations-credential-a" />);

    await user.click(screen.getByTestId('automations-credential-a-connect'));

    expect(await screen.findByTestId('automations-credential-a-code')).toHaveTextContent('WDJB-MJHT');
    expect(screen.getByTestId('automations-credential-a-open')).toBeInTheDocument();
  });

  it('a pending poll keeps polling at the given interval', async () => {
    const user = userEvent.setup({ delay: null });
    const startGithubDeviceFlow = vi.fn(async () => START);
    const pollGithubDeviceFlow = vi.fn(async () => ({ status: 'pending' as const }));
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow, pollGithubDeviceFlow }) });
    render(<GithubDeviceConnect onChange={vi.fn()} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollGithubDeviceFlow).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollGithubDeviceFlow).toHaveBeenCalledTimes(2);
  });

  it('slow_down adopts the new interval instead of the original one', async () => {
    const user = userEvent.setup({ delay: null });
    const startGithubDeviceFlow = vi.fn(async () => START);
    const pollGithubDeviceFlow = vi
      .fn()
      .mockResolvedValueOnce({ status: 'slow_down' as const, interval: 20 })
      .mockResolvedValue({ status: 'pending' as const });
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow, pollGithubDeviceFlow }) });
    render(<GithubDeviceConnect onChange={vi.fn()} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollGithubDeviceFlow).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollGithubDeviceFlow).toHaveBeenCalledTimes(1); // not yet — the new interval is 20s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(pollGithubDeviceFlow).toHaveBeenCalledTimes(2);
  });

  it('connected adds the credential and calls onChange', async () => {
    const user = userEvent.setup({ delay: null });
    const startGithubDeviceFlow = vi.fn(async () => START);
    const pollGithubDeviceFlow = vi.fn(async () => ({ status: 'connected' as const }));
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow, pollGithubDeviceFlow }) });
    const onChange = vi.fn();
    render(<GithubDeviceConnect onChange={onChange} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(useAutomationsStore.getState().credentials).toContain('github');
    expect(onChange).toHaveBeenCalledWith('github');
  });

  it.each([
    ['expired', 'expired before it was entered'],
    ['denied', 'cancelled'],
  ] as const)('%s renders a distinct message with a retry button', async (status, messageFragment) => {
    const user = userEvent.setup({ delay: null });
    const startGithubDeviceFlow = vi.fn(async () => START);
    const pollGithubDeviceFlow = vi.fn(async () => ({ status }));
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow, pollGithubDeviceFlow }) });
    render(<GithubDeviceConnect onChange={vi.fn()} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByTestId('automations-credential-a-status')).toHaveTextContent(new RegExp(messageFragment, 'i'));
    expect(screen.getByTestId('automations-credential-a-retry')).toBeInTheDocument();
  });

  it('an error status from a poll shows the daemon message', async () => {
    const user = userEvent.setup({ delay: null });
    const startGithubDeviceFlow = vi.fn(async () => START);
    const pollGithubDeviceFlow = vi.fn(async () => ({ status: 'error' as const, message: 'incorrect_device_code' }));
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow, pollGithubDeviceFlow }) });
    render(<GithubDeviceConnect onChange={vi.fn()} testId="automations-credential-a" />);
    await user.click(screen.getByTestId('automations-credential-a-connect'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByTestId('automations-credential-a-status')).toHaveTextContent('incorrect_device_code');
  });

  it('reports unavailable when no GitHub App client ID is configured, without a generic error or an administrator dead end', async () => {
    const user = userEvent.setup({ delay: null });
    const startGithubDeviceFlow = vi.fn(async () => {
      throw new ApiRequestError('not configured', [], 501);
    });
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow }) });
    render(<GithubDeviceConnect onChange={vi.fn()} testId="automations-credential-a" />);

    await user.click(screen.getByTestId('automations-credential-a-connect'));

    const unavailable = await screen.findByTestId('automations-credential-a-unavailable');
    expect(unavailable).toHaveTextContent("GitHub connection isn't available yet");
    expect(unavailable).not.toHaveTextContent(/administrator/i);
  });

  it('copies the code and opens GitHub in the system browser from one click', async () => {
    const user = userEvent.setup({ delay: null });
    // jsdom exposes navigator.clipboard as a getter, and userEvent.setup()
    // installs its own stub — so redefine after setup, not before.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const startGithubDeviceFlow = vi.fn(async () => START);
    const pollGithubDeviceFlow = vi.fn(async () => ({ status: 'pending' as const }));
    useAutomationsStore.setState({ gateway: fakeGateway({ startGithubDeviceFlow, pollGithubDeviceFlow }) });
    render(<GithubDeviceConnect onChange={vi.fn()} testId="automations-credential-a" />);

    await user.click(screen.getByTestId('automations-credential-a-connect'));
    await user.click(await screen.findByTestId('automations-credential-a-open'));

    // One action has to do both, because GitHub has no verification_uri_complete
    // to carry the code — and it must use the app's opener, not an anchor, or
    // the user types GitHub credentials inside our webview.
    expect(writeText).toHaveBeenCalledWith('WDJB-MJHT');
    expect(vi.mocked(openExternal)).toHaveBeenCalledWith('https://github.com/login/device');
  });
});
