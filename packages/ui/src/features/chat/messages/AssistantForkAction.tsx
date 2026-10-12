import { ActionBarPrimitive, useAuiState } from '@assistant-ui/react';
import { Split } from 'lucide-react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { ForkBaseInput } from '@/features/sessions/view-model/fork-availability';
import { useForkChat } from '@/features/sessions/use-fork-chat';
import { useAdaptersStore } from '@/store/adapters';
import { ActionIconButton } from './action-icon-button';
import { assistantForkAvailability, assistantForkPoint } from './assistant-fork-point';
import { useIsNestedTranscript } from './nested-transcript-context';

function forkBaseInput(custom: SessionCustom, adapter?: AdapterInfo): ForkBaseInput {
  return {
    capabilityFork: adapter?.capabilities.fork ?? false,
    capabilityReason: adapter?.forkUnavailableReason,
    adapterName: adapter?.name ?? custom.adapterId,
    temporary: custom.temporary,
    noProject: custom.noProject,
    claudeSessionId: custom.claudeSessionId,
    transcriptMissing: custom.transcriptMissing,
    directoryMissing: custom.directoryMissing ?? false,
  };
}

export function AssistantForkAction() {
  const nested = useIsNestedTranscript();
  const messageId = useAuiState((s) => s.message.id);
  const messageStatus = useAuiState((s) => s.message.status?.type);
  const messages = useAuiState((s) => s.thread.messages);
  const chatId = useAuiState((s) => s.threadListItem.remoteId);
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const adapter = useAdaptersStore((s) => (custom == null ? undefined : s.byId[custom.adapterId]));
  const fork = useForkChat();
  const point = assistantForkPoint(messages, messageId);

  if (nested || chatId == null || custom == null || custom.temporary || custom.noProject || point == null) return null;

  const reason = assistantForkAvailability(messages, messageId, point, forkBaseInput(custom, adapter), {
    isRunning: custom.isRunning ?? false,
    hasPending: custom.hasPending,
  });
  const enabled = reason.enabled && messageStatus === 'complete';
  const tooltip = enabled
    ? 'Fork from here'
    : !reason.enabled
      ? reason.reason
      : messageStatus === 'running'
        ? 'Wait for this turn to finish'
        : "This turn didn't complete";

  return (
    <ActionBarPrimitive.Root autohide="always" className="flex items-center gap-0.5 text-muted-foreground">
      <ActionIconButton
        tooltip={tooltip}
        disabled={!enabled}
        aria-label="Fork from here"
        data-testid="chat-assistant-message-fork"
        onClick={() => void fork(chatId, point.kind === 'before' ? { fromMessageId: point.messageId } : undefined)}
      >
        <Split className="rotate-90" />
      </ActionIconButton>
    </ActionBarPrimitive.Root>
  );
}
