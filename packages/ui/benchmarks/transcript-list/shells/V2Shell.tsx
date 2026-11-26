/** v2: LegendList owns the scroller (rows in `lists/legend-rows.tsx`); the composer sits below it. */
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { CHAT_ID } from '../store';
import { ComposerStub } from './ComposerStub';

export function V2Shell() {
  return (
    <>
      <div data-rig-v2 className="relative flex min-h-0 flex-1 flex-col">
        <TurnTranscript key={CHAT_ID} />
      </div>
      <ComposerStub />
    </>
  );
}
