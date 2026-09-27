'use client';

/**
 * useActiveThreadId — the aui thread-list item id of the active thread. It is
 * the key every per-thread store uses, and it stays `__LOCALID_*` for a
 * draft's whole life.
 *
 * The selector is deliberately un-annotated: `useAuiState` infers
 * `AssistantState`, so an upstream rename of `threadListItem` breaks the build
 * here. Hand-annotating the parameter with a structural literal (the pattern
 * this hook replaces) would instead compile and silently yield `undefined`.
 *
 * Inside a `SideChatScope` (the side-chat panel's composer) the scope's own
 * `sideChatId` wins over the bound item id — the panel's `AuiProvider`
 * deliberately leaves `threadListItem` unbound (todo #344, UI rule 5).
 */
import { useAuiState } from '@assistant-ui/react';
import { useSideChatScope } from '@/features/side-chat/side-chat-scope';

export function useActiveThreadId(): string | undefined {
  const bound = useAuiState((s) => s.threadListItem?.id);
  const scope = useSideChatScope();
  return scope?.sideChatId ?? bound;
}
