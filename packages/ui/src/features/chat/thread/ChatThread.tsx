import { useRef, type ReactNode } from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import { ChatSelectionToolbar } from './ChatSelectionToolbar';
import { ComposerEditProvider } from '../composer/edit/composer-edit-context';
import { SkillsProvider } from '@/features/skills/use-chat-skills';
import { FindBar } from '../find/FindBar';
import { useFindInChatStore } from '../find/find-in-chat-store';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { RootTranscriptScope } from '../messages/compact/transcript-scope';
import { ChatThreadViewport } from './ChatThreadViewport';
import '../tools/register-cards';

export type ChatThreadVariant = 'main' | 'side';
export function ChatThread({
  emptyState,
  variant = 'main',
}: { emptyState?: ReactNode; variant?: ChatThreadVariant } = {}) {
  useShortcutAction('chat.find', () => useFindInChatStore.getState().open());
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <ComposerEditProvider>
      <SkillsProvider>
        <RootTranscriptScope>
          <ThreadPrimitive.Root
            ref={rootRef}
            data-testid="chat-thread"
            className="flex h-full flex-col overflow-hidden bg-background text-foreground"
          >
            <FindBar />
            <ChatThreadViewport emptyState={emptyState} variant={variant} />
            <ChatSelectionToolbar scopeRef={rootRef} />
          </ThreadPrimitive.Root>
        </RootTranscriptScope>
      </SkillsProvider>
    </ComposerEditProvider>
  );
}
