import { useChatExtrasSelector } from '../runtime/chat-extras';
import { useAuiState } from '@assistant-ui/react';
import { Split } from 'lucide-react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { ForkBaseInput } from '@/features/sessions/view-model/fork-availability';
import { useForkChat } from '@/features/sessions/use-fork-chat';
import { useAdaptersStore } from '@/store/adapters';
import { ActionIconButton } from './action-icon-button';
import { assistantForkAvailability, assistantForkPoint, type AssistantForkPoint } from './assistant-fork-point';
import { useTurnSelector } from './turn/turn-context';
import { useIsNestedTranscript } from './nested-transcript-context';

function forkBaseInput(custom: SessionCustom, adapter?: AdapterInfo): ForkBaseInput {
  return {
    capabilityFork: adapter?.capabilities.fork ?? false,
    capabilityReason: adapter?.forkUnavailableReason,
    adapterName: adapter?.name ?? custom.adapterId,
    temporary: custom.temporary,
    noProject: custom.noProject,
    vendorSessionId: custom.vendorSessionId,
    transcriptMissing: custom.transcriptMissing,
    directoryMissing: custom.directoryMissing ?? false,
  };
}

function ForkButton({
  chatId,
  point,
  tooltip,
  disabled,
}: {
  chatId: string;
  point: NonNullable<AssistantForkPoint>;
  tooltip: string;
  disabled: boolean;
}) {
  const fork = useForkChat();
  return (
    <ActionIconButton
      tooltip={tooltip}
      disabled={disabled}
      aria-label="Fork from here"
      data-testid="chat-assistant-message-fork"
      onClick={() => void fork(chatId, point.kind === 'before' ? { fromMessageId: point.messageId } : undefined)}
    >
      <Split className="rotate-90" />
    </ActionIconButton>
  );
}

export function AssistantForkAction() {
  const nested = useIsNestedTranscript();
  const ownId = useAuiState((s) => s.message.id);
  // The footer can sit on an earlier message of the turn than its last: the fork keeps the whole turn.
  const messageId = useTurnSelector(({ model }) => {
    const key = model.slices.get(ownId)?.turnKey;
    return (key === undefined ? undefined : model.turns.get(key)?.lastMessageId) ?? ownId;
  }, ownId);
  const messageStatus = useAuiState((s) => {
    const end = messageId === s.message.id ? s.message : s.thread.messages.find(({ id }) => id === messageId);
    return end?.status?.type;
  });
  const hasMoreHistory = useChatExtrasSelector((extras) => extras?.state.historyWindow?.hasMore);
  const messages = useAuiState((s) => s.thread.messages);
  const threadRunning = useAuiState((s) => s.thread.isRunning);
  const chatId = useAuiState((s) => s.threadListItem.remoteId);
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const adapter = useAdaptersStore((s) => (custom == null ? undefined : s.byId[custom.adapterId]));
  const point = assistantForkPoint(messages, messageId);

  if (
    nested ||
    messageStatus !== 'complete' ||
    chatId == null ||
    custom == null ||
    custom.temporary ||
    custom.noProject ||
    point == null ||
    (point.kind === 'current' && (threadRunning || custom.isRunning))
  )
    return null;

  const reason = assistantForkAvailability(messages, messageId, point, forkBaseInput(custom, adapter), {
    isRunning: custom.isRunning ?? false,
    hasPending: custom.hasPending,
    hasMoreHistory,
  });
  const tooltip = reason.enabled ? 'Fork from here' : reason.reason;

  return <ForkButton chatId={chatId} point={point} tooltip={tooltip} disabled={!reason.enabled} />;
}
