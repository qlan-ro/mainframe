import '../../src/features/chat/tools/register-cards';
import { useUiPrefs } from '../../src/store/ui-prefs';
useUiPrefs.getState().setTranscriptMode('compact');
import { complexText, complexTools } from './complex-content';
import { DaemonPortProvider } from '../../src/features/sessions/runtime/daemon-port-context';
import { useMemo, type ReactNode } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import { CompactTranscript } from '../../src/features/chat/messages/compact/CompactTranscript';
import { TranscriptScopeProvider } from '../../src/features/chat/messages/compact/transcript-scope';
import {
  TranscriptScrollProvider,
  type TranscriptScrollController,
} from '../../src/features/chat/thread/transcript-scroll-context';

function source(i: number, id: string, text: string) {
  const final = i % 2 === 1;
  const presentation = {
    version: 1,
    provider: 'codex',
    turnId: `turn-${Math.floor(i / 2)}`,
    phase: final ? 'final_answer' : 'work',
    state: 'completed',
    finalEligible: final,
  };
  return {
    sourceMessageId: id,
    sourceBlockIndex: 0,
    startUtf16: 0,
    endUtf16: text.length,
    streaming: false,
    presentation,
  };
}

export function compactMessages(count: number): ThreadMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `compact-${i}`;
    const final = i % 2 === 1;
    const text =
      location.search.includes('complex') && final
        ? complexText(i)
        : `${id}: ${'Content for completed turn. '.repeat(final ? 8 : 20)}`;
    return {
      id,
      role: 'assistant',
      createdAt: new Date(0),
      content: [{ type: 'text', text }, ...(!final && location.search.includes('complex') ? complexTools(i) : [])],
      status: { type: 'complete', reason: 'stop' },
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {
          mainframe: {
            partSources: {
              0: [source(i, id, text)],
            },
          },
        },
      },
    };
  });
}

export function CompactWindow({
  pin,
  thread,
  children,
}: {
  pin: TranscriptScrollController;
  thread: string;
  children?: ReactNode;
}) {
  const scope = useMemo(
    () => ({ rootThreadId: thread, chatId: thread, ancestors: [], pendingToolIds: new Set<string>() }),
    [thread],
  );
  return (
    <DaemonPortProvider port={0}>
      <TooltipProvider>
        <TranscriptScopeProvider value={scope}>
          <TranscriptScrollProvider value={pin}>{children ?? <CompactTranscript />}</TranscriptScrollProvider>
        </TranscriptScopeProvider>
      </TooltipProvider>
    </DaemonPortProvider>
  );
}
