/** Pin/unpin/tags/archive/fork actions for one session row — extracted from `SessionRow.tsx`. */
import { useAui } from '@assistant-ui/react';
import { pinChat } from '@/lib/api/chats';
import { useAdaptersStore } from '@/store/adapters';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { forkAvailability, type ForkAvailability } from '../view-model/fork-availability';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useTagPopoverTarget } from '../tags/use-tag-popover-target';
import { useArchiveSession } from './use-archive-session';
import { useForkChat } from '../use-fork-chat';

export interface RowActions {
  onPin: () => void;
  onUnpin: () => void;
  onTags: (anchorRect?: DOMRect | null) => void;
  onArchive: () => void;
  onFork: () => void;
  forkAvailability: ForkAvailability;
}

export function useRowActions(item: SessionItem): RowActions {
  const port = useDaemonPort();
  const aui = useAui();
  const onArchive = useArchiveSession(item.remoteId ?? item.id, item.custom.worktreePath != null);
  const fork = useForkChat();
  const adapter = useAdaptersStore((s) => s.byId[item.custom.adapterId]);

  const setPinned = (pinned: boolean) => {
    void pinChat(port, item.id, pinned)
      .then(() => aui.threads.reload())
      .catch((e: unknown) => {
        console.warn('[SessionRow] pinChat failed', e);
      });
  };

  return {
    onPin: () => setPinned(true),
    onUnpin: () => setPinned(false),
    onTags: (anchorRect = null) => {
      useTagPopoverTarget.getState().open(item.remoteId ?? item.id, item.custom.tags ?? [], anchorRect);
    },
    onArchive,
    onFork: () => void fork(item.remoteId ?? item.id),
    forkAvailability: forkAvailability({
      capabilityFork: adapter?.capabilities.fork ?? false,
      adapterName: adapter?.name ?? item.custom.adapterId,
      claudeSessionId: item.custom.claudeSessionId,
      transcriptMissing: item.custom.transcriptMissing,
      directoryMissing: item.custom.directoryMissing ?? false,
      isRunning: item.custom.isRunning ?? false,
      hasPending: item.custom.hasPending,
    }),
  };
}
