/**
 * Canonical type definitions for the sessions sidebar view-model, plus the
 * pure Chat → RemoteThreadMetadata projection.
 *
 * SessionItem and SessionCustom are defined ONCE here. All other phases import
 * from this file. No other file re-declares them.
 *
 * unread is NOT a field of SessionCustom. It is client-only store state
 * injected at call sites (e.g. deriveSessionStatus, attentionCount). This
 * keeps the mapper side-effect-free.
 *
 * The return type satisfies RemoteThreadMetadata (from @assistant-ui/react)
 * at the call site; we do not import it here to keep this module aui-free.
 */
import type { Chat } from '@qlan-ro/mainframe-types';

export interface SessionCustom {
  projectId: string;
  adapterId: string;
  tags: string[];
  pinned: boolean;
  status: Chat['status'];
  /** Always present — defaults to 'idle'. NonNullable<Chat['displayStatus']>. */
  displayStatus: NonNullable<Chat['displayStatus']>;
  /** True only when displayStatus === 'waiting'. List-level pending badge (D8). */
  hasPending: boolean;
  detectedPrs: NonNullable<Chat['detectedPrs']>;
  worktreePath?: string;
  worktreeMissing: boolean;
  updatedAt: number;
}

export interface SessionItem {
  id: string;
  remoteId?: string;
  title?: string;
  /** 'regular' for all non-archived chats; 'archived' for archived ones. */
  status: 'regular' | 'archived';
  custom: SessionCustom;
}

export interface ThreadCustomResult {
  status: 'regular' | 'archived';
  remoteId: string;
  externalId: undefined;
  title?: string;
  custom: SessionCustom;
}

export function chatToThreadCustom(chat: Chat): ThreadCustomResult {
  const displayStatus: NonNullable<Chat['displayStatus']> = chat.displayStatus ?? 'idle';
  const custom: SessionCustom = {
    projectId: chat.projectId,
    adapterId: chat.adapterId,
    tags: chat.tags ?? [],
    pinned: chat.pinned ?? false,
    status: chat.status,
    displayStatus,
    hasPending: displayStatus === 'waiting',
    detectedPrs: chat.detectedPrs ?? [],
    worktreePath: chat.worktreePath,
    worktreeMissing: chat.worktreeMissing ?? false,
    updatedAt: new Date(chat.updatedAt).getTime(),
  };
  return {
    status: chat.status === 'archived' ? 'archived' : 'regular',
    remoteId: chat.id,
    externalId: undefined,
    title: chat.title,
    custom,
  };
}
