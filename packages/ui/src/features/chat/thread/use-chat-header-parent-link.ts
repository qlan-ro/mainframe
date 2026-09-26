/**
 * The active chat's fork-parent link for `ChatCardHeader` (todo #343). The
 * `threads.threadItems` store scope carries BOTH regular and archived threads
 * (see chat-to-thread-custom.ts's own note on `threadItemsToSessionItems`),
 * so a parent found there resolves directly — 'linked' or 'archived' by its
 * own `status`. A parent absent from that list entirely is asked for directly
 * via `useParentChat` (archived-but-unloaded is unreachable here since the
 * full thread map already includes archived chats; only 'deleted' actually
 * surfaces from that path).
 */
import { useCallback } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useParentChat } from '@/features/sessions/use-parent-chat';
import {
  parentLineageInteractive,
  parentLineageText,
  type ParentLineageState,
} from '@/features/sessions/view-model/fork-lineage';

export interface ChatHeaderParentLink {
  text: string;
  onActivate?: () => void;
}

export function useChatHeaderParentLink(): ChatHeaderParentLink | null {
  const aui = useAui();
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const parentChatId = custom?.parentChatId ?? null;

  const localParent = parentChatId == null ? undefined : threadItems.find((t) => t.remoteId === parentChatId);
  const external = useParentChat(localParent == null ? parentChatId : null);

  const activateParent = useCallback(() => {
    if (parentChatId != null) aui.threads.switchToThread(parentChatId);
  }, [aui, parentChatId]);

  if (parentChatId == null) return null;

  let state: ParentLineageState | undefined;
  if (localParent != null) {
    const title = localParent.title ?? 'Untitled session';
    state = localParent.status === 'archived' ? { kind: 'archived', title } : { kind: 'linked', title };
  } else if (external?.kind === 'archived') {
    state = { kind: 'archived', title: external.title ?? 'Untitled session' };
  } else if (external?.kind === 'deleted') {
    state = { kind: 'deleted' };
  }

  if (state == null) return null; // still resolving
  return { text: parentLineageText(state), onActivate: parentLineageInteractive(state) ? activateParent : undefined };
}
