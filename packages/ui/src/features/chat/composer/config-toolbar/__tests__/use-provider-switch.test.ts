// @vitest-environment jsdom
/** Picking another provider's model switches at once (C5); a refusal says why. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Chat } from '@qlan-ro/mainframe-types';

const { api, toast } = vi.hoisted(() => ({ api: { switchChatProvider: vi.fn() }, toast: { error: vi.fn() } }));
vi.mock('@/lib/api/chats', () => api);
vi.mock('@/lib/toast', () => ({ mfToast: toast }));
import { useProviderSwitch } from '../use-provider-switch';

const CHAT = { id: 'chat-1', adapterId: 'claude' } as Chat;

beforeEach(() => {
  vi.clearAllMocks();
  api.switchChatProvider.mockResolvedValue(CHAT);
});

describe('useProviderSwitch', () => {
  it('switches the chat in place, with nothing asked first', () => {
    const { result } = renderHook(() => useProviderSwitch(CHAT, 31415));
    act(() => result.current({ adapterId: 'codex', model: 'gpt' }));

    expect(api.switchChatProvider).toHaveBeenCalledExactlyOnceWith(31415, 'chat-1', {
      adapterId: 'codex',
      model: 'gpt',
    });
  });

  it('a refused switch shows the daemon message in a toast', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.switchChatProvider.mockRejectedValue(new Error('Send or cancel queued messages before switching providers'));
    const { result } = renderHook(() => useProviderSwitch(CHAT, 31415));
    act(() => result.current({ adapterId: 'codex', model: 'gpt' }));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not switch provider', {
        description: 'Send or cancel queued messages before switching providers',
      }),
    );
  });
});
