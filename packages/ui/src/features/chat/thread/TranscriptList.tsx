import type { ComponentProps } from 'react';
import type { ThreadPrimitive } from '@assistant-ui/react';
import { PlainMessages } from './PlainMessages';
import { useTranscriptScroll } from './transcript-scroll-context';
import { VirtualMessages } from './VirtualMessages';

/** The transcript's list: plain rows under the scroll owner, or today's virtualized list (the setting). */
export function TranscriptList({
  components,
}: {
  components: ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components'];
}) {
  const owned = useTranscriptScroll()?.owned === true;
  return owned ? <PlainMessages components={components} /> : <VirtualMessages components={components} />;
}
