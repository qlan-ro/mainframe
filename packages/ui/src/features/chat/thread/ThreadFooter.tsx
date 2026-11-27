import type { RefCallback } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { useDraftConfigStore } from '@/features/sessions/runtime/draft-config';
import { Composer } from '../composer/Composer';
import { BottomStrip } from '../composer/strips/BottomStrip';
import { DraftStrip } from '../composer/strips/DraftStrip';
import { WorktreeSwitchBanner } from '../composer/WorktreeSwitchBanner';
import { AgentOutboxChip } from '../orchestration/AgentOutboxChip';
import { ChatGateMount } from '../gates/ChatGateMount';
import { useChatExtras } from '../runtime/chat-extras';
import { DegradedChatCard } from './DegradedChatCard';
import type { ChatThreadVariant } from './ChatThread';

const useDirectoryMissing = (): boolean => useChatExtras()?.state.chatConfig?.directoryMissing ?? false;
function ThreadFooterInput({ variant }: { variant: ChatThreadVariant }) {
  const directoryMissing = useDirectoryMissing();
  const itemId = useSideAwareThreadId();
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const hasDraftCfg = useDraftConfigStore((s) => (itemId ? s.drafts.has(itemId) : false));
  const projectlessDraft = itemId?.startsWith('__LOCALID_') === true && itemStatus === 'new' && !hasDraftCfg;
  return (
    <>
      <DegradedChatCard />
      {projectlessDraft ? <DraftStrip standalone /> : !directoryMissing && <Composer variant={variant} />}
    </>
  );
}
export function ThreadFooter({
  variant,
  readOnly,
  footerRef,
  sticky = true,
}: {
  variant: ChatThreadVariant;
  readOnly: boolean;
  footerRef: RefCallback<HTMLDivElement>;
  /** Inside the scroller (today's list) the footer sticks to its bottom; the plain list puts it below the scroller. */
  sticky?: boolean;
}) {
  const directoryMissing = useDirectoryMissing();
  // A plain div, not `ThreadPrimitive.ViewportFooter`: from 0.15.38 aui counts a
  // registered footer's height as "at bottom", which hid the scroll-to-bottom
  // button until the reader was a whole composer-height up.
  return (
    <div
      ref={footerRef}
      className={`flex max-h-[calc(100cqh-2rem)] shrink-0 flex-col bg-background${sticky ? ' sticky bottom-0 mt-auto' : ''}`}
    >
      <div
        data-testid="chat-thread-footer"
        data-chat-footer
        className="mx-auto flex w-[calc(100%-0.5rem)] min-h-0 max-w-(--mf-transcript-width) flex-col px-5 pb-4"
      >
        <ChatGateMount />
        <div className="flex min-h-0 flex-col">
          {readOnly ? (
            <p data-testid="chat-read-only-note" className="py-2 text-center text-xs text-muted-foreground">
              Delegated task transcript · read-only
            </p>
          ) : (
            <>
              {variant !== 'side' && <WorktreeSwitchBanner />}
              {variant !== 'side' && <AgentOutboxChip />}
              <ThreadFooterInput variant={variant} />
            </>
          )}
          {variant === 'main' && <BottomStrip fixed={readOnly || directoryMissing} />}
        </div>
      </div>
    </div>
  );
}
