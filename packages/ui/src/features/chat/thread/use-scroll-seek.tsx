import { useMemo } from 'react';
import { useFindInChatStore } from '../find/find-in-chat-store';
import type { ScrollSeekPlaceholderProps } from 'react-virtuoso';
import type { TranscriptScrollController } from './transcript-scroll-context';

function SeekingMessage({ height }: ScrollSeekPlaceholderProps) {
  return (
    <div data-virtual-placeholder aria-hidden="true" style={{ height }} className="overflow-hidden px-6 py-4">
      <div className="mb-3 h-3 w-3/4 rounded bg-muted" />
      <div className="h-3 w-1/2 rounded bg-muted" />
    </div>
  );
}

export const seekingComponents = { ScrollSeekPlaceholder: SeekingMessage };

export function useScrollSeek(scroll: TranscriptScrollController | null, viewport: HTMLElement | null) {
  return useMemo(() => {
    const protectedContent = () => {
      const selection = document.getSelection();
      const find = useFindInChatStore.getState();
      return (
        (find.isOpen && !find.daemon) ||
        scroll?.isFollowing() ||
        scroll?.isInteracting?.() ||
        Boolean(selection && !selection.isCollapsed && viewport?.contains(selection.anchorNode))
      );
    };
    return {
      enter: (velocity: number) => !protectedContent() && Math.abs(velocity) > 2000,
      exit: (velocity: number) => Boolean(protectedContent()) || Math.abs(velocity) < 400,
    };
  }, [scroll, viewport]);
}
