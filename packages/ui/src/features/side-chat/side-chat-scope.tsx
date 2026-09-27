'use client';

/**
 * SideChatScope — the side chat's identity, provided by `SideChatPanel` and
 * read by the parts of `ChatThread`/the composer that would otherwise key off
 * `s.threadListItem?.id` (todo #344, UI rule 5).
 *
 * The panel's nested `AuiProvider` deliberately leaves `threadListItem`
 * unbound: a side chat is never in the aui thread list, so a `threadListItem`
 * bound to its id resolves with no state (`getThreadListItemState` returns
 * `SKIP_UPDATE` — `@assistant-ui/core@0.3.12`,
 * `dist/runtime/api/thread-list-runtime.js`). Binding it anyway (mirroring
 * `ChatZone`) would also collide item-keyed state (draft config, bottom pin,
 * composer identity) with the parent, since both would resolve through the
 * SAME extended root's `threads` scope keyed by the SAME parent id otherwise
 * in view. This context is the explicit substitute: `ChatThread`'s own
 * `threadId`, `ThreadFooterInput`, and `useActiveThreadId` (the composer's
 * identity) all prefer the scope's `sideChatId` over the bound item id.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';

export interface SideChatScopeValue {
  parentChatId: string;
  sideChatId: string;
}

const SideChatScopeContext = createContext<SideChatScopeValue | null>(null);

export function SideChatScopeProvider({ value, children }: { value: SideChatScopeValue; children: ReactNode }) {
  return <SideChatScopeContext.Provider value={value}>{children}</SideChatScopeContext.Provider>;
}

/** `null` outside a `SideChatPanel` — every consumer falls back to the normal
 *  bound thread-list-item id in that case. */
export function useSideChatScope(): SideChatScopeValue | null {
  return useContext(SideChatScopeContext);
}

/**
 * The thread-list-item id `ChatThread`/`ThreadFooterInput`/the composer
 * should key on: inside a `SideChatScope`, its `sideChatId` — otherwise the
 * normal bound item id read from `s.threadListItem?.id`.
 */
export function useSideAwareThreadId(): string | null {
  const bound = useAuiState((s) => s.threadListItem?.id ?? null);
  const scope = useSideChatScope();
  return scope?.sideChatId ?? bound;
}
