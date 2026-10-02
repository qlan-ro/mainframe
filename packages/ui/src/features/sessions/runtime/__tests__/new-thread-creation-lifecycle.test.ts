import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { createChat, setChatTuning, archiveChat, discardChat } from '../../../../lib/api/chats';
import { setDraftConfig, getDraftConfig } from '../draft-config';
import { createForLocal, isCreatePending, isCreateInFlight, subscribeCreateLifecycle } from '../new-thread-coordinator';
import { resetNewThreadDraft } from '../../new-thread/reset-new-thread-draft';
import { useDraftReturnTarget } from '../../new-thread/use-draft-return-target';

vi.mock('../../../../lib/api/chats', () => ({
  createChat: vi.fn(),
  setChatTuning: vi.fn(),
  setChatConfig: vi.fn().mockResolvedValue(undefined),
  archiveChat: vi.fn().mockResolvedValue(undefined),
  discardChat: vi.fn().mockResolvedValue(undefined),
}));

const localId = '__LOCALID_lifecycle';
function configure(projectId = 'project') {
  setDraftConfig(localId, {
    projectId,
    adapterId: 'claude',
    model: 'default',
    permissionMode: 'default',
    planMode: false,
    effort: null,
    fast: false,
    ultracode: false,
    adaptiveThinking: false,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  configure();
  vi.mocked(createChat).mockResolvedValue({ id: 'chat-created' } as Chat);
  vi.mocked(setChatTuning).mockResolvedValue(undefined as unknown as Chat);
});
afterEach(() => {
  resetNewThreadDraft(localId);
  useDraftReturnTarget.getState().clear();
});

it('publishes pending and settled attempts while preserving retained-workflow boot protection', async () => {
  const observed: boolean[] = [];
  const unsubscribe = subscribeCreateLifecycle(() => {
    observed.push(isCreatePending(localId));
  });
  try {
    vi.mocked(setChatTuning).mockRejectedValueOnce(new Error('tuning failed'));
    const pending = createForLocal(localId, 31415);
    expect(isCreatePending(localId)).toBe(true);
    await expect(pending).rejects.toThrow('tuning failed');
    expect(isCreatePending(localId)).toBe(false);
    expect(isCreateInFlight(localId)).toBe(true);
    await expect(createForLocal(localId, 31415)).resolves.toEqual({ remoteId: 'chat-created' });
    expect(observed).toEqual([true, false, true, false]);
    expect(isCreateInFlight(localId)).toBe(false);
    expect(createChat).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});

it('settles a rejected create and permits a fresh retry', async () => {
  vi.mocked(createChat).mockRejectedValueOnce(new Error('create failed'));
  await expect(createForLocal(localId, 31415)).rejects.toThrow('create failed');
  expect(isCreatePending(localId)).toBe(false);
  expect(isCreateInFlight(localId)).toBe(false);
  expect(getDraftConfig(localId)).toBeDefined();
  await expect(createForLocal(localId, 31415)).resolves.toEqual({ remoteId: 'chat-created' });
  expect(createChat).toHaveBeenCalledTimes(2);
});

it('an abandoned attempt cannot settle or clear a replacement using the same local id', async () => {
  const firstResponse = deferred<Chat>();
  const secondResponse = deferred<Chat>();
  vi.mocked(createChat).mockReturnValueOnce(firstResponse.promise).mockReturnValueOnce(secondResponse.promise);
  const first = createForLocal(localId, 31415).catch((error: unknown) => error);
  resetNewThreadDraft(localId);
  configure('replacement');
  useDraftReturnTarget.getState().setReturnTarget('replacement-return');
  const second = createForLocal(localId, 31415);
  firstResponse.resolve({ id: 'chat-abandoned' } as Chat);
  expect(await first).toBeInstanceOf(Error);
  expect(getDraftConfig(localId)?.projectId).toBe('replacement');
  expect(useDraftReturnTarget.getState().returnThreadId).toBe('replacement-return');
  expect(isCreatePending(localId)).toBe(true);
  expect(archiveChat).toHaveBeenCalledExactlyOnceWith(31415, 'chat-abandoned', true);
  expect(discardChat).not.toHaveBeenCalled();
  secondResponse.resolve({ id: 'chat-replacement' } as Chat);
  await expect(second).resolves.toEqual({ remoteId: 'chat-replacement' });
  expect(archiveChat).toHaveBeenCalledTimes(1);
  expect(getDraftConfig(localId)).toBeUndefined();
});
