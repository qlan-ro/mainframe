/** v1s rows: each message is a Message Scroller item; a user prompt anchors its turn. */
import { MessageScroller } from './scroller-lib';
import { DisclosureStateProvider } from '@/components/ui/disclosure-state';
import { useProgressiveRows } from './progressive';
import { MessageRow, useRows, type MessageComponents } from './row';

export function ScrollerRows({ components }: { components: MessageComponents }) {
  const { rows: all, anchorId } = useRows();
  const rows = useProgressiveRows(all);
  return (
    <DisclosureStateProvider>
      <MessageScroller.Content
        data-testid="chat-message-list"
        data-loaded-count={rows.length}
        className="flex flex-col pb-4"
      >
        {rows.map(({ id, index, user }) => (
          <MessageScroller.Item key={id} messageId={id} scrollAnchor={user}>
            <MessageRow index={index} anchor={id === anchorId} components={components} />
          </MessageScroller.Item>
        ))}
      </MessageScroller.Content>
    </DisclosureStateProvider>
  );
}
