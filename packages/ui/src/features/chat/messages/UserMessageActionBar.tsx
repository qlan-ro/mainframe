'use client';

/**
 * UserMessageActionBar — the hover bar under a sent user message, holding
 * "Fork from here" (`docs/specs/2026-10-06-fork-from-message.md`).
 *
 * Native `ActionBarPrimitive.Root autohide="always"` (it shows while the
 * message is hovered), inside a `min-h-6` footer so the hover never shifts the
 * transcript — the assistant bar's own footer recipe.
 *
 * Not rendered at all where no message could ever fork — a queued message, a
 * draft, a temporary (or side) chat, a no-project chat, and a nested subagent
 * transcript — because a disabled button on every message would be noise.
 * Everywhere else the button is enabled, or disabled with the first failing
 * reason as its tooltip. A turn in flight does not disable it.
 */
import type { FC } from 'react';
import { ActionBarPrimitive, useAuiState } from '@assistant-ui/react';
import { GitFork } from 'lucide-react';
import { MessageFooter } from '@/components/ui/message';
import { useAdaptersStore } from '@/store/adapters';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { forkFromMessageAvailability } from '@/features/sessions/view-model/fork-from-message-availability';
import { useForkChat } from '@/features/sessions/use-fork-chat';
import { useMainframeMeta } from '../view-model/message-meta';
import { useIsNestedTranscript } from './nested-transcript-context';
import { ActionIconButton } from './action-icon-button';

interface UserMessageActionBarProps {
  /** The message's visible text, placed unsent in the fork's composer. */
  prefill: string;
}

export const UserMessageActionBar: FC<UserMessageActionBarProps> = ({ prefill }) => {
  const nested = useIsNestedTranscript();
  const queued = useMainframeMeta().queued === true;
  // A nested subagent transcript has no thread-list scope to read, so the
  // chat-level hooks below must not even run there.
  if (nested || queued) return null;
  return <ForkFromHereBar prefill={prefill} />;
};

const ForkFromHereBar: FC<UserMessageActionBarProps> = ({ prefill }) => {
  const meta = useMainframeMeta();
  const messageId = useAuiState((s) => s.message.id);
  // A primitive selection, so no fresh array ever reaches getSnapshot.
  const firstUserMessageId = useAuiState((s) => s.thread.messages.find((m) => m.role === 'user')?.id);
  const chatId = useAuiState((s) => s.threadListItem.remoteId);
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const adapter = useAdaptersStore((s) => (custom == null ? undefined : s.byId[custom.adapterId]));
  const fork = useForkChat();

  if (chatId == null || custom == null || custom.temporary || custom.noProject) return null;

  const availability = forkFromMessageAvailability({
    capabilityFork: adapter?.capabilities.fork ?? false,
    capabilityReason: adapter?.forkUnavailableReason,
    adapterName: adapter?.name ?? custom.adapterId,
    temporary: custom.temporary,
    noProject: custom.noProject,
    claudeSessionId: custom.claudeSessionId,
    transcriptMissing: custom.transcriptMissing,
    directoryMissing: custom.directoryMissing ?? false,
    messageUnsent: meta.pending === true || meta.error != null,
    isFirstUserMessage: firstUserMessageId === messageId,
  });

  return (
    <MessageFooter className="min-h-6 px-0">
      <ActionBarPrimitive.Root autohide="always" className="flex items-center gap-0.5 text-muted-foreground">
        <ActionIconButton
          tooltip={availability.enabled ? 'Fork from here' : availability.reason}
          disabled={!availability.enabled}
          aria-label="Fork from here"
          data-testid="chat-user-message-fork"
          onClick={() => void fork(chatId, { fromMessageId: messageId, prefill })}
        >
          <GitFork />
        </ActionIconButton>
      </ActionBarPrimitive.Root>
    </MessageFooter>
  );
};
