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
 */
import { useAuiState } from '@assistant-ui/react';

export function useActiveThreadId(): string | undefined {
  return useAuiState((s) => s.threadListItem?.id);
}
