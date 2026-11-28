import { memo, useEffect, useMemo, type ComponentProps } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { DisclosureStateProvider } from '@/components/ui/disclosure-state';
import { markFirstTranscriptShown } from '@/lib/after-first-paint';
import { useAwayFromTail } from '../runtime/use-away-from-tail';
import { TimeMarker } from './TimeMarker';
import { TurnStatusRow } from './TurnStatusRow';
import { statusAnchorId } from './turn-phase';
import { useTranscriptScroll } from './transcript-scroll-context';
import { useFoldedAwayRows } from './use-folded-away-rows';
import { useTailFirstRows } from './use-tail-first-rows';

type MessageComponents = ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components'];

interface Row {
  id: string;
  index: number;
  user: boolean;
}

/** One message. Its index and the status-row anchor come from the list, once, not from a search per row. */
const MessageRow = memo(function MessageRow({
  index,
  anchor,
  components,
}: {
  index: number;
  anchor: boolean;
  components: MessageComponents;
}) {
  return (
    <>
      <TimeMarker index={index} />
      <ThreadPrimitive.MessageByIndex index={index} components={components} />
      {anchor && <TurnStatusRow />}
    </>
  );
});

/** Ids and roles, re-read only when the rows themselves change; the status anchor is the newest sent message. */
function useRows(): { rows: Row[]; anchorId: string | null } {
  const serialized = useAuiState((s) =>
    s.thread.messages.map((message) => `${message.role === 'user' ? 'u' : 'x'}${message.id}`).join('\0'),
  );
  const anchorId = useAuiState((s) => statusAnchorId(s.thread.messages));
  const rows = useMemo(
    () =>
      serialized ? serialized.split('\0').map((row, index) => ({ id: row.slice(1), index, user: row[0] === 'u' })) : [],
    [serialized],
  );
  return { rows, anchorId };
}

/**
 * The transcript's messages as plain rows: every loaded row is in the DOM, the scroll owner
 * (`use-scroll-owner.ts`) holds the position and the browser anchors what changes above the reader.
 * The newest rows mount first and the rest follows in slices (`use-tail-first-rows.ts`). A folded
 * turn's messages that draw nothing get no row (`use-folded-away-rows.ts`).
 */
export function PlainMessages({ components }: { components: MessageComponents }) {
  const { rows: loaded, anchorId: newest } = useRows();
  const foldedAway = useFoldedAwayRows();
  const all = useMemo(
    () => (foldedAway.size ? loaded.filter((row) => !foldedAway.has(row.id)) : loaded),
    [loaded, foldedAway],
  );
  // The run's status sits under the newest message: a window around a jump target does not hold it.
  const anchorId = useAwayFromTail() ? null : newest;
  const scroll = useTranscriptScroll();
  const rows = useTailFirstRows(all, scroll);
  const userCount = loaded.filter((row) => row.user).length;
  const shown = rows.length > 0;
  useEffect(() => {
    if (shown) markFirstTranscriptShown();
  }, [shown]);
  return (
    <DisclosureStateProvider>
      <div
        data-testid="chat-message-list"
        data-loaded-count={loaded.length}
        data-loaded-user-count={userCount}
        data-virtualized={false}
        data-rows-pending={rows.length < all.length ? '' : undefined}
      >
        {rows.map(({ id, index }) => (
          <MessageRow key={id} index={index} anchor={id === anchorId} components={components} />
        ))}
      </div>
    </DisclosureStateProvider>
  );
}
