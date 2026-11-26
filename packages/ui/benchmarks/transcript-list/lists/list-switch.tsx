/**
 * Stands in for `thread/VirtualMessages` inside the real `TurnTranscript` (the
 * rig's Vite plugin redirects that one import), so every variant renders the
 * same production rows and only the list around them changes.
 */
import { useEffect, useState } from 'react';
import { VirtualMessages as Virtualized } from '@/features/chat/thread/VirtualMessages';
import { DisclosureStateProvider } from '@/components/ui/disclosure-state';
import { params } from '../params';
import { MessageRow, useRows, type MessageComponents } from './row';
import { ScrollerRows } from './scroller-rows';
import { LegendRows } from './legend-rows';

const FIRST_ROWS = 6;
const STEP_ROWS = 12;

/**
 * `?progressive=1`: mount only the newest rows, then prepend the rest of the loaded
 * window a slice per task. The browser anchors each slice like a page landing, so
 * the reader stays put; the first frame shows the tail at a fraction of the cost.
 */
function useProgressiveStart(count: number) {
  const [hidden, setHidden] = useState(() => (params.progressive ? Math.max(0, count - FIRST_ROWS) : 0));
  useEffect(() => {
    if (hidden <= 0) return;
    const timer = setTimeout(() => requestAnimationFrame(() => setHidden((h) => Math.max(0, h - STEP_ROWS))), 0);
    return () => clearTimeout(timer);
  }, [hidden]);
  return hidden;
}

function PlainRows({ components }: { components: MessageComponents }) {
  const { rows: all, anchorId } = useRows();
  const hidden = useProgressiveStart(all.length);
  const rows = hidden ? all.slice(hidden) : all;
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
      return <ScrollerRows components={components} />;
    case 'v2':
      return <LegendRows components={components} />;
  }
}
