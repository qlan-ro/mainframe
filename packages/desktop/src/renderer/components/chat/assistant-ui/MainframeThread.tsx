import React, { Suspense, useCallback } from 'react';
import { ThreadPrimitive, useThread } from '@assistant-ui/react';
import { Loader2 } from 'lucide-react';
import { useMainframeRuntime } from './MainframeRuntimeProvider';
import { useChatsStore } from '../../../store/chats';
import { ImageLightbox } from '../ImageLightbox';
import { UserMessage, AssistantMessage, SystemMessage } from './messages';
import { ComposerCard } from './composer';
import { QuoteOnSelectionButton } from './QuoteOnSelectionButton';
import { FindBar } from './FindBar';
import { useFindInChatStore } from '../../../store';

const PermissionCard = React.lazy(() => import('../PermissionCard').then((m) => ({ default: m.PermissionCard })));
const AskUserQuestionCard = React.lazy(() =>
  import('../AskUserQuestionCard').then((m) => ({ default: m.AskUserQuestionCard })),
);
const PlanApprovalCard = React.lazy(() => import('../PlanApprovalCard').then((m) => ({ default: m.PlanApprovalCard })));

function EmptyState() {
  return (
    <ThreadPrimitive.Empty>
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-full bg-mf-accent/10 flex items-center justify-center">
          <span className="text-3xl font-bold text-mf-accent">M</span>
        </div>
        <h1 className="text-xl font-semibold text-mf-text-primary">Let's build something</h1>
      </div>
    </ThreadPrimitive.Empty>
  );
}

function LoadingState() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-mf-text-secondary">
      <Loader2 size={24} className="animate-spin motion-reduce:animate-none text-mf-accent" />
      <span className="text-mf-body">Loading messages…</span>
    </div>
  );
}

function GeneratingIndicator() {
  const thread = useThread();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const isCompacting = useChatsStore((s) => (activeChatId ? s.compactingChats.has(activeChatId) : false));
  if (!thread.isRunning) return null;
  return (
    <div className="flex items-center gap-2 py-2 text-mf-text-secondary text-mf-body">
      <Loader2 size={14} className="animate-spin motion-reduce:animate-none text-mf-accent" />
      <span>{isCompacting ? 'Compacting...' : 'Thinking...'}</span>
    </div>
  );
}

function BottomCardInner() {
  const { pendingPermission, respondToPermission } = useMainframeRuntime();

  if (pendingPermission) {
    if (pendingPermission.toolName === 'AskUserQuestion') {
      return <AskUserQuestionCard request={pendingPermission} onRespond={respondToPermission} />;
    }
    if (pendingPermission.toolName === 'ExitPlanMode') {
      return <PlanApprovalCard request={pendingPermission} onRespond={respondToPermission} />;
    }
    return <PermissionCard request={pendingPermission} onRespond={respondToPermission} />;
  }

  return <ComposerCard />;
}

function BottomCard() {
  return (
    <Suspense fallback={<ComposerCard />}>
      <BottomCardInner />
    </Suspense>
  );
}

export function MainframeThread() {
  const { lightbox, closeLightbox, navigateLightbox } = useMainframeRuntime();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const isLoading = useChatsStore((s) => (activeChatId ? s.loadingChats.has(activeChatId) : false));
  const openFindBar = useFindInChatStore((s) => s.open);
  const closeFindBar = useFindInChatStore((s) => s.close);
  const findBarOpen = useFindInChatStore((s) => s.isOpen);

  // Intercept Cmd/Ctrl+F while the chat thread is focused — open find bar
  // instead of the global search palette.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        if (findBarOpen) {
          closeFindBar();
        } else {
          openFindBar();
        }
      }
    },
    [findBarOpen, openFindBar, closeFindBar],
  );

  return (
    // Outer wrapper captures Cmd/Ctrl+F and routes it to the chat-local
    // find bar, preventing the global search palette from opening when the
    // user is focused on the chat thread.
    <div className="h-full flex flex-col" onKeyDown={handleKeyDown}>
      <FindBar />
      <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0">
        <ThreadPrimitive.Viewport autoScroll className="flex-1 overflow-y-auto scrollbar-on-hover">
          {isLoading ? (
            <LoadingState />
          ) : (
            <>
              <EmptyState />
              <div data-mf-chat-thread className="px-6 py-6 space-y-5">
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    AssistantMessage,
                    SystemMessage,
                  }}
                />
                <GeneratingIndicator />
              </div>
            </>
          )}
        </ThreadPrimitive.Viewport>
        <QuoteOnSelectionButton />
        <div className="shrink-0 px-6 pb-5 pt-2">
          <BottomCard />
        </div>
        {lightbox && (
          <ImageLightbox
            images={lightbox.images}
            index={lightbox.index}
            onClose={closeLightbox}
            onNavigate={navigateLightbox}
          />
        )}
      </ThreadPrimitive.Root>
    </div>
  );
}
