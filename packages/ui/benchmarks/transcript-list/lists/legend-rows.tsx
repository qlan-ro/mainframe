/**
 * v2 rows: LegendList owns the scroller and virtualizes. The fixture already
 * cuts a turn into several assistant messages of one or two parts, so a row is
 * close to the "one row per visible entry" the fallback plan calls for.
 */
import { useEffect, useRef } from 'react';
import { LegendList, type LegendListRef } from '@legendapp/list/react';
import { DisclosureStateProvider } from '@/components/ui/disclosure-state';
import { EarlierMessages } from '@/features/chat/thread/EarlierMessages';
import { controls } from '../controls';
import { MessageRow, useRows, type MessageComponents } from './row';

export function LegendRows({ components }: { components: MessageComponents }) {
  const { rows, anchorId } = useRows();
  const list = useRef<LegendListRef>(null);
  useEffect(() => {
    controls.viewport = list.current?.getScrollableNode() ?? null;
    controls.viewport?.setAttribute('data-rig-viewport', '');
    controls.jump = () => void list.current?.scrollToEnd({ animated: false });
  }, []);
  return (
    <DisclosureStateProvider>
      <LegendList
        ref={list}
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <div className="mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) px-5">
            <MessageRow index={item.index} anchor={item.id === anchorId} components={components} />
          </div>
        )}
        ListHeaderComponent={<EarlierMessages />}
        estimatedItemSize={160}
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
        recycleItems={false}
        data-testid="chat-message-list"
        style={{ height: '100%' }}
      />
    </DisclosureStateProvider>
  );
}
