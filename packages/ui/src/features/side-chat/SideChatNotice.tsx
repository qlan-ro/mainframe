/**
 * SideChatNotice — the panel's compact context notices, keyed by the PARENT
 * chat id (todo #344, approved design direction): the panel never renders the
 * full-size, side-chat-keyed Alert, so parent-keyed compact ids never collide
 * with it. Both calls read the side chat's own runtime state through
 * `useChatExtras` (bound to the panel's nested `AuiProvider`) — only the
 * data-testid key differs from the default (chat-id-keyed) usage in
 * `ChatThread`. The two states are mutually exclusive by construction (see
 * `ContextNotPreservedNotice`).
 */
import { ContextNotPreservedNotice } from '@/features/chat/thread/ContextNotPreservedNotice';

export function SideChatNotice({ parentChatId }: { parentChatId: string }) {
  return (
    <>
      <ContextNotPreservedNotice compact kind="not-preserved" testIdKey={parentChatId} />
      <ContextNotPreservedNotice compact kind="provider-transcript" testIdKey={parentChatId} />
    </>
  );
}
