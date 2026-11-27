import type { ReactNode } from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import { TranscriptScrollProvider } from '@/features/chat/thread/transcript-scroll-context';
import { useScrollOwner } from '@/features/chat/thread/use-scroll-owner';

const SCROLLER =
  'flex min-h-0 flex-1 flex-col overflow-y-auto px-[22px] pt-3 pb-4 outline-none focus-visible:focus-line-inset [&_.mf-tr-mono]:translate-y-0';

interface Props {
  label: string;
  children: ReactNode;
}

/**
 * The sub-agent tab's scroll area. On the plain transcript list it has the transcript's scroll owner
 * (`use-scroll-owner.ts`), opened at the top: older pages of the agent's steps land without moving
 * the reader, at offset 0 as well, where the browser does not anchor.
 */
export function SubagentScroller({ label, children }: Props) {
  const plain = useUiPrefs((s) => s.plainTranscript);
  if (plain) return <OwnedScroller label={label}>{children}</OwnedScroller>;
  return (
    <div data-conversation-scroller role="region" aria-label={label} tabIndex={-1} className={SCROLLER}>
      {children}
    </div>
  );
}

function OwnedScroller({ label, children }: Props) {
  const owner = useScrollOwner(null, undefined, { openAt: 'top' });
  return (
    <TranscriptScrollProvider value={owner.controller}>
      <div
        ref={owner.setViewport}
        data-conversation-scroller
        role="region"
        aria-label={label}
        tabIndex={-1}
        className={SCROLLER}
      >
        <div ref={owner.setContent} className="flex min-w-0 flex-col">
          {children}
        </div>
      </div>
    </TranscriptScrollProvider>
  );
}
