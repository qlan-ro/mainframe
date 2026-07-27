'use client';

/**
 * Render gate for the in-chat smart-action chips (#278, #279).
 *
 * `markdownComponents` is shared with `UserMessage`, `ReviewCommentCard` and
 * `PlanBubble` — and `PlanBubble` renders *inside* assistant messages, so a
 * message-role check would leak chips into it. The gate is instead "rendered by
 * `MarkdownText`": only that component mounts this provider, and every override
 * asks {@link useSmartActionsEnabled} before chipping anything.
 */
import { createContext, useContext, type ReactNode } from 'react';

const SmartActionsContext = createContext(false);

export function SmartActionsProvider({ children }: { children: ReactNode }) {
  return <SmartActionsContext.Provider value={true}>{children}</SmartActionsContext.Provider>;
}

export function useSmartActionsEnabled(): boolean {
  return useContext(SmartActionsContext);
}
