/**
 * Stands in for `thread/VirtualMessages` inside the real `TurnTranscript` (the
 * rig's Vite plugin redirects that one import), so every variant renders the
 * same production rows and only the list around them changes.
 */
import { VirtualMessages as Virtualized } from '@/features/chat/thread/VirtualMessages';
import { DisclosureStateProvider } from '@/components/ui/disclosure-state';
import { params } from '../params';
import { useProgressiveRows } from './progressive';
import { MessageRow, useRows, type MessageComponents } from './row';
import { ScrollerRows } from './scroller-rows';
import { LegendRows } from './legend-rows';

function PlainRows({ components }: { components: MessageComponents }) {
  const { rows: all, anchorId } = useRows();
  const rows = useProgressiveRows(all);
  return (
    <DisclosureStateProvider>
      <div data-testid="chat-message-list" data-loaded-count={rows.length}>
        {rows.map(({ id, index }) => (
          <MessageRow key={id} index={index} anchor={id === anchorId} components={components} />
        ))}
      </div>
    </DisclosureStateProvider>
  );
}

export function VirtualMessages({ components }: { components: MessageComponents }) {
  switch (params.variant) {
    case 'v0':
      return <Virtualized components={components} />;
    case 'v1':
      return <PlainRows components={components} />;
    case 'v1s':
    case 'v1s-patched':
      return <ScrollerRows components={components} />;
    case 'v2':
      return <LegendRows components={components} />;
  }
}
