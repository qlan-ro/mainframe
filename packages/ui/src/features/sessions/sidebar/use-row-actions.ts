/** Pin/unpin/tags/archive actions for one session row — extracted from `SessionRow.tsx`. */
import { useAui } from '@assistant-ui/react';
import { pinChat } from '@/lib/api/chats';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useTagPopoverTarget } from '../tags/use-tag-popover-target';
import { useArchiveSession } from './use-archive-session';

export interface RowActions {
  onPin: () => void;
  onUnpin: () => void;
  onTags: (anchorRect?: DOMRect | null) => void;
  onArchive: () => void;
}

export function useRowActions(item: SessionItem): RowActions {
  const port = useDaemonPort();
  const aui = useAui();
  const onArchive = useArchiveSession(item.remoteId ?? item.id, item.custom.worktreePath != null);

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
  };
}
