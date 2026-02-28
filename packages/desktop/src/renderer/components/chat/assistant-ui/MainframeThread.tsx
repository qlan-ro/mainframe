import React from 'react';
import { ThreadPrimitive, useThread } from '@assistant-ui/react';
import { useMainframeRuntime } from './MainframeRuntimeProvider';
import { PermissionCard } from '../PermissionCard';
import { AskUserQuestionCard } from '../AskUserQuestionCard';
import { PlanApprovalCard } from '../PlanApprovalCard';
import { ImageLightbox } from '../ImageLightbox';
import { UserMessage, AssistantMessage, SystemMessage } from './messages';
import { ComposerCard } from './composer';

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

function GeneratingIndicator() {
  const thread = useThread();
  if (!thread.isRunning) return null;
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-mf-text-secondary opacity-60 text-mf-body">
      <span className="w-2 h-2 rounded-full bg-mf-accent animate-pulse" />
      <span>Thinking...</span>
    </div>
  );
}

function BottomCard() {
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

export function MainframeThread() {
  const { lightbox, closeLightbox, navigateLightbox } = useMainframeRuntime();

  return (
    <ThreadPrimitive.Root className="h-full flex flex-col">
      <ThreadPrimitive.Viewport autoScroll className="flex-1 overflow-y-auto scrollbar-none">
        <EmptyState />
        <div className="px-6 py-6 space-y-5">
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
              SystemMessage,
            }}
          />
          <GeneratingIndicator />
        </div>
      </ThreadPrimitive.Viewport>
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
  );
}
