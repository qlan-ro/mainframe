/**
 * ProviderSwitchConfirm + useProviderSwitch: both dialog bodies (new provider
 * vs. returning to an earlier session), the "Don't ask again" preference, and
 * the failure toast. Only the API client and the toast are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdapterInfo, Chat, ChatSegment } from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';
import { ProviderSwitchConfirm } from '../ProviderSwitchConfirm';
import { useProviderSwitch } from '../use-provider-switch';

const { api, toast } = vi.hoisted(() => ({
  api: { getChatSegments: vi.fn(), switchChatProvider: vi.fn() },
  toast: { error: vi.fn() },
}));

vi.mock('@/lib/api/chats', () => api);
vi.mock('@/lib/toast', () => ({ mfToast: toast }));

const ADAPTERS = [
  { id: 'claude', name: 'Claude', installed: true, models: [] },
  { id: 'codex', name: 'Codex', installed: true, models: [] },
] as unknown as AdapterInfo[];

const CHAT = { id: 'chat-1', adapterId: 'claude' } as Chat;

function segment(adapterId: string, nativeSessionId: string | null): ChatSegment {
  return {
    id: `seg-${adapterId}`,
    ordinal: 0,
    kind: 'initial',
    adapterId,
    model: null,
    borrowed: false,
    nativeSessionId,
    turnCount: 1,
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    createdAt: '',
    closedAt: null,
    handoff: null,
  };
}

function Harness() {
  const hook = useProviderSwitch(CHAT, 31415, ADAPTERS);
  return (
    <>
      <button
        type="button"
        data-testid="harness-switch"
        onClick={() => hook.request({ adapterId: 'codex', model: 'codex-pro' })}
      />
      <ProviderSwitchConfirm hook={hook} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiPrefs.setState({ dontConfirmProviderSwitch: false });
  api.switchChatProvider.mockResolvedValue(CHAT);
});

describe('ProviderSwitchConfirm', () => {
  it('asks to continue in a provider with no earlier session, then switches on confirm', async () => {
    api.getChatSegments.mockResolvedValue([segment('claude', 'c-1')]);
    render(<Harness />);
    await userEvent.click(screen.getByTestId('harness-switch'));
    expect(await screen.findByText('Continue this chat in Codex?')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Claude's session stops here. Your next message goes to Codex, along with up to ~16k tokens of this chat's history, so it can pick up where Claude left off.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Codex' }));
    expect(api.switchChatProvider).toHaveBeenCalledWith(31415, 'chat-1', { adapterId: 'codex', model: 'codex-pro' });
  });

  it('says "Go back" when the provider already ran here, and cancel switches nothing', async () => {
    api.getChatSegments.mockResolvedValue([segment('claude', 'c-1'), segment('codex', 'x-1')]);
    render(<Harness />);
    await userEvent.click(screen.getByTestId('harness-switch'));
    expect(await screen.findByText('Go back to Codex?')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('composer-provider-switch-confirm-cancel'));
    expect(api.switchChatProvider).not.toHaveBeenCalled();
  });

  it('"Don\'t ask again" persists on confirm, and later switches skip the dialog', async () => {
    api.getChatSegments.mockResolvedValue([]);
    render(<Harness />);
    await userEvent.click(screen.getByTestId('harness-switch'));
    await screen.findByText('Continue this chat in Codex?');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Codex' }));
    expect(useUiPrefs.getState().dontConfirmProviderSwitch).toBe(true);

    api.switchChatProvider.mockClear();
    await userEvent.click(screen.getByTestId('harness-switch'));
    expect(api.switchChatProvider).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Continue this chat in Codex?')).toBeNull();
  });

  it('a refused switch shows the daemon message in a toast', async () => {
    useUiPrefs.setState({ dontConfirmProviderSwitch: true });
    api.switchChatProvider.mockRejectedValue(new Error('Send or cancel queued messages before switching providers'));
    render(<Harness />);
    await userEvent.click(screen.getByTestId('harness-switch'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not switch provider', {
        description: 'Send or cancel queued messages before switching providers',
      }),
    );
  });
});
