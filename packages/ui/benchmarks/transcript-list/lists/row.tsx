/**
 * One message row, as `VirtualMessages`' private `VirtualMessage` draws it, but
 * with its index and the status-row anchor computed once by the list. Today's
 * row runs `findIndex` and `statusAnchorId` over the whole thread in every row
 * on every update; with every row mounted that made a streamed chunk cost
 * O(rows x messages), 200+ ms at 400 groups in Chromium.
 */
import { memo, type ComponentProps } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { TimeMarker } from '@/features/chat/thread/TimeMarker';
import { TurnStatusRow } from '@/features/chat/thread/TurnStatusRow';
import { statusAnchorId } from '@/features/chat/thread/turn-phase';

export type MessageComponents = ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components'];
export interface Row {
  id: string;
  index: number;
  user: boolean;
}

export const MessageRow = memo(function MessageRow({
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

/** Ids, roles and the status anchor, re-read only when the list of rows changes. */
export function useRows(): { rows: Row[]; anchorId: string | null } {
  const serialized = useAuiState((s) =>
    s.thread.messages.map((m) => `${m.role === 'user' ? 'u' : 'x'}${m.id}`).join('\0'),
  );
  const anchorId = useAuiState((s) => statusAnchorId(s.thread.messages));
  const rows = serialized
    ? serialized.split('\0').map((row, index) => ({ id: row.slice(1), index, user: row[0] === 'u' }))
    : [];
  return { rows, anchorId };
}
