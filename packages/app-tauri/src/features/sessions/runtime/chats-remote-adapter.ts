/**
 * RemoteThreadListAdapter backed by the daemon chats REST API (D1/D5/D10).
 *
 * - list/fetch project each daemon Chat → RemoteThreadMetadata via the pure
 *   chat-to-thread-custom mapper (all list signals ride in `custom`).
 * - archive AND delete both map to POST /archive (no hard-delete route, D5);
 *   both read hasWorktree from the chat, await the worktree-delete confirm
 *   bridge (D10), and a 'cancel' THROWS so aui rolls back its optimistic
 *   archive (S5).
 * - generateTitle is a no-op empty stream — the daemon auto-titles; enqueuing
 *   would race it (invariant 4).
 * - initialize creates the daemon chat for a __LOCALID_* thread via the
 *   new-thread coordinator and returns its id (no id-flip — aui stamps remoteId
 *   on the same entry).
 *
 * Imports ONLY RemoteThreadListAdapter and derives the rest — no other named
 * export exists at @assistant-ui/react@0.14.14.
 */
import type { AssistantStreamChunk } from 'assistant-stream';
import type { RemoteThreadListAdapter } from '@assistant-ui/react';
import { listChats, getChat, renameChat, archiveChat, unarchiveChat } from '../../../lib/api/chats';
import { chatToThreadCustom } from '../view-model/chat-to-thread-custom';
import { requestWorktreeArchiveChoice } from './archive-confirm-bridge';
import { createForLocal } from './new-thread-coordinator';

type RemoteThreadMetadata = Awaited<ReturnType<RemoteThreadListAdapter['fetch']>>;
type RemoteThreadListResponse = Awaited<ReturnType<RemoteThreadListAdapter['list']>>;
type RemoteThreadInitializeResponse = Awaited<ReturnType<RemoteThreadListAdapter['initialize']>>;

type RemoteCustom = RemoteThreadMetadata['custom'];

function toMetadata(chat: Parameters<typeof chatToThreadCustom>[0]): RemoteThreadMetadata {
  const result = chatToThreadCustom(chat);
  // SessionCustom is a closed interface (no index signature), so it does not
  // structurally satisfy aui's `Record<string, unknown>` custom slot. The
  // canonical mapper stays aui-free by contract; widen the field here at the
  // single seam where the metadata leaves our domain. Spreading into an
  // annotated literal widens without an `as unknown` double-cast.
  const custom: RemoteCustom = { ...result.custom };
  return { ...result, custom };
}

async function archiveWithConfirm(port: number, remoteId: string): Promise<void> {
  const chat = await getChat(port, remoteId);
  const choice = await requestWorktreeArchiveChoice(remoteId, {
    hasWorktree: !!chat.worktreePath,
  });
  if (choice === 'cancel') {
    // Throw so aui rolls back its optimistic `archived` update (S5).
    throw new Error('archive cancelled');
  }
  await archiveChat(port, remoteId, choice.deleteWorktree);
}

export function makeChatsRemoteAdapter(port: number): RemoteThreadListAdapter {
  return {
    async list(): Promise<RemoteThreadListResponse> {
      const chats = await listChats(port);
      return { threads: chats.map(toMetadata) };
    },
    async fetch(threadId: string): Promise<RemoteThreadMetadata> {
      const chat = await getChat(port, threadId);
      return toMetadata(chat);
    },
    async rename(remoteId: string, newTitle: string): Promise<void> {
      await renameChat(port, remoteId, newTitle);
    },
    async archive(remoteId: string): Promise<void> {
      await archiveWithConfirm(port, remoteId);
    },
    async delete(remoteId: string): Promise<void> {
      await archiveWithConfirm(port, remoteId);
    },
    async unarchive(remoteId: string): Promise<void> {
      await unarchiveChat(port, remoteId);
    },
    async initialize(threadId: string): Promise<RemoteThreadInitializeResponse> {
      const { remoteId } = await createForLocal(threadId, port);
      return { remoteId, externalId: undefined };
    },
    generateTitle(): Promise<ReadableStream<AssistantStreamChunk>> {
      // Never enqueue — the daemon auto-titles; an empty stream satisfies aui.
      return Promise.resolve(new ReadableStream<AssistantStreamChunk>());
    },
  };
}
