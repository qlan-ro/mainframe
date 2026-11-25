import { DaemonFind } from '../find/DaemonFind';
import { useRef, type ReactNode } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { ChatSelectionToolbar } from './ChatSelectionToolbar';
import { ComposerEditProvider } from '../composer/edit/composer-edit-context';
import { ThreadComposerProvider } from '../composer/thread-composer';
import { SkillsProvider } from '@/features/skills/use-chat-skills';
import { FindBar } from '../find/FindBar';
import { useFindInChatStore } from '../find/find-in-chat-store';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { RootTranscriptScope } from '../messages/turn/transcript-scope';
import { ChatThreadViewport } from './ChatThreadViewport';
import { useActiveThreadId } from '../runtime/use-active-thread-id';
import '../transcript.css';

export type ChatThreadVariant = 'main' | 'side';
export function ChatThread({
  emptyState,
  variant = 'main',
}: { emptyState?: ReactNode; variant?: ChatThreadVariant } = {}) {
  const focused = useAuiState((s) => s.threads?.mainThreadId === s.threadListItem?.id);
  const scope = useActiveThreadId();
  const findOwner = focused && variant === 'main';
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <ThreadComposerProvider>
      <ComposerEditProvider scope={scope}>
        <SkillsProvider>
          <RootTranscriptScope>
            <ThreadPrimitive.Root
              ref={rootRef}
              data-testid="chat-thread"
              className="flex h-full flex-col overflow-hidden bg-background text-foreground"
            >
              {findOwner && <ThreadFind />}
              <ChatThreadViewport emptyState={emptyState} variant={variant} />
              <ChatSelectionToolbar scopeRef={rootRef} />
            </ThreadPrimitive.Root>
          </RootTranscriptScope>
        </SkillsProvider>
      </ComposerEditProvider>
    </ThreadComposerProvider>
  );
}

function ThreadFind() {
  useShortcutAction('chat.find', () => useFindInChatStore.getState().open());
  return (
    <>
      <FindBar />
      <DaemonFind />
    </>
  );
}
