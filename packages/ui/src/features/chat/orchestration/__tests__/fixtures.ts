/**
 * A fake aui state for the orchestration surfaces: the active thread item and
 * the session list they look other chats up in. Each test mocks
 * `@assistant-ui/react` over `auiState` and the `aui.threads` spy.
 */
import { vi } from 'vitest';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';

export interface FakeEntry {
  id: string;
  remoteId?: string;
  title?: string;
  status: string;
  custom: Record<string, unknown>;
}

export function entry(id: string, custom: Partial<SessionCustom> = {}, title = `Chat ${id}`): FakeEntry {
  const full: SessionCustom = {
    projectId: 'p',
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    transcriptMissing: false,
    temporary: false,
    noProject: false,
    updatedAt: 1,
    ...custom,
  };
  return { id, remoteId: id, title, status: 'regular', custom: full as unknown as Record<string, unknown> };
}

export const switchToThread = vi.fn();

export const auiState: { threadListItem: FakeEntry | undefined; threads: { threadItems: FakeEntry[] } } = {
  threadListItem: undefined,
  threads: { threadItems: [] },
};

export function setSessions(active: FakeEntry, others: FakeEntry[] = []): void {
  auiState.threadListItem = active;
  auiState.threads = { threadItems: [active, ...others] };
}
