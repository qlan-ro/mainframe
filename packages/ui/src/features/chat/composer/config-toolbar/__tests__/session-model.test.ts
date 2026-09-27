// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import { useComposerTuning } from '../use-composer-tuning';
import { mfToast } from '@/lib/toast';
import { setChatConfig } from '@/lib/api/chats';
import { getEffectiveModel } from '@/lib/api/adapters';
import { useChatExtras } from '../../../runtime/chat-extras';

vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn() } }));
vi.mock('@/lib/api/chats', () => ({ setChatConfig: vi.fn() }));
vi.mock('@assistant-ui/react', () => ({ useAuiState: () => false }));
vi.mock('../../../runtime/chat-extras', () => ({ useChatExtras: vi.fn() }));
vi.mock('@/lib/api/adapters', () => ({ getEffectiveModel: vi.fn() }));
vi.mock('../use-provider-defaults', () => ({ useProviderDefaults: () => ({ defaultModel: 'other' }) }));

const adapters = [
  {
    id: 'codex',
    name: 'Codex',
    models: [
      { id: 'gpt-selected', label: 'Selected GPT', isDefault: true },
      { id: 'gpt-current', label: 'Current GPT' },
    ],
  },
] as AdapterInfo[];
let chat: Chat;
let runState = 'idle';
beforeEach(() => {
  chat = { id: 'chat', projectId: 'project', adapterId: 'codex', model: 'gpt-selected' } as Chat;
  runState = 'idle';
  vi.mocked(getEffectiveModel).mockReset().mockResolvedValue('gpt-current');
  vi.mocked(useChatExtras).mockImplementation(
    () =>
      ({
        port: 31415,
        state: { chatId: 'chat', chatConfig: chat, runState: { type: runState }, loadState: { type: 'ready' } },
      }) as ReturnType<typeof useChatExtras>,
  );
});

it('keeps the saved choice separate from the observed model for explicit Codex chats', async () => {
  const { result } = renderHook(() => useComposerTuning(adapters));
  await waitFor(() => expect(result.current.runningModel?.id).toBe('gpt-current'));
  expect(result.current.model?.id).toBe('gpt-selected');
  expect(result.current.chat?.model).toBe('gpt-selected');
  expect(getEffectiveModel).toHaveBeenCalledWith(31415, 'codex', 'project', 'chat');
});

it('queries again after a model switch and resume', async () => {
  const { result, rerender } = renderHook(() => useComposerTuning(adapters));
  await waitFor(() => expect(result.current.runningModel?.id).toBe('gpt-current'));
  chat = { ...chat, model: 'private-model' };
  vi.mocked(getEffectiveModel).mockResolvedValue(null);
  rerender();
  await waitFor(() => expect(result.current.runningModel).toBeNull());
  expect(result.current.model?.id).toBe('private-model');
  vi.mocked(getEffectiveModel).mockResolvedValue('private-model');
  runState = 'running';
  rerender();
  await waitFor(() => expect(result.current.runningModel?.id).toBe('private-model'));
});

it('reports a rejected switch without changing the saved model', async () => {
  vi.mocked(setChatConfig).mockRejectedValue(new Error('Model is not available'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = renderHook(() => useComposerTuning(adapters));
  act(() => result.current.setModel('private-model'));
  await waitFor(() =>
    expect(mfToast.error).toHaveBeenCalledWith('Could not switch model', {
      description: 'Model is not available',
    }),
  );
  expect(result.current.chat?.model).toBe('gpt-selected');
  warn.mockRestore();
});
