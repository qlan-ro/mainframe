/**
 * agent (#463): a long finished sub-agent's steps, paged by the app's own code. The real
 * `HistoricalAgentSteps` (its paging gestures, the bounded page window in
 * `subagent-history-store.ts`, the hand-off to the scroll owner) loads pages from `agent-pager.ts`.
 *
 * - Default: the sub-agent tab as `SubagentTabBody` lays it out, in the real `SubagentScroller` (on
 *   the plain list: the scroll owner, opened at the top).
 * - `inline=1`: the steps in the chat's own list, after the parent's turns, with the plain list's
 *   owner opened at the tail as `OwnedChatThreadViewport` mounts it. In the app they sit inside the
 *   agent's row in a turn; here they follow the turns, in the same scroller and under the same owner.
 *
 * `plain=0` is the other list (Settings › Chat off), for a comparison.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { HistoricalAgentSteps } from '@/features/chat/messages/turn/HistoricalAgentSteps';
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { TranscriptScrollProvider } from '@/features/chat/thread/transcript-scroll-context';
import { useScrollOwner } from '@/features/chat/thread/use-scroll-owner';
import { SubagentScroller } from '@/features/workspace-chat/SubagentScroller';
import { ProseBlock } from '@/features/workspace-chat/SubagentTextBlocks';
import { useUiPrefs } from '@/store/ui-prefs';
import { controls } from '../controls';
import { params } from '../params';
import { CHAT_ID } from '../store';
import { ComposerStub } from './ComposerStub';

useUiPrefs.setState({ plainTranscript: params.plain });

const BRIEF = 'Read every module under `src/`, run the tests after each change and report what fails.';
const RESULT = 'All modules read; the tests pass after the last change.';
/** A port nothing listens on: the registry is redirected (`lists/agent-registry.ts`), so nothing connects. */
const NO_DAEMON = 9;

function Steps({ bare }: { bare: boolean }) {
  return (
    <HistoricalAgentSteps
      chatId={CHAT_ID}
      toolCallId="rig-agent"
      nativeAgentId="rig-agent"
      messageId="rig-host"
      messages={[]}
      outcome="done"
      bare={bare}
      prompt={bare ? undefined : BRIEF}
      result={bare ? undefined : RESULT}
    />
  );
}

function Tab() {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = root.current?.querySelector<HTMLElement>('[data-conversation-scroller]') ?? null;
    scroller?.setAttribute('data-rig-viewport', '');
    controls.viewport = scroller;
  }, []);
  return (
    <div ref={root} className="mx-auto flex h-full min-h-0 w-full max-w-(--mf-transcript-width) flex-1 flex-col">
      <SubagentScroller label="Sub-agent">
        <ProseBlock label="Brief" testId="workspace-agent-brief-rig-agent" source={BRIEF} />
        <Steps bare />
        <ProseBlock label="Result" testId="workspace-agent-result-rig-agent" source={RESULT} />
      </SubagentScroller>
    </div>
  );
}

function Inline() {
  const owner = useScrollOwner(CHAT_ID, CHAT_ID);
  const { viewport } = owner.controller;
  useEffect(() => {
    controls.viewport = viewport ?? null;
    controls.jump = owner.pinToBottom;
  }, [viewport, owner.pinToBottom]);
  return (
    <TranscriptScrollProvider value={owner.controller}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={owner.setViewport}
          data-mf-chat-thread
          data-mf-chat-id={CHAT_ID}
          data-rig-viewport
          data-scrollbar="none"
          tabIndex={-1}
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          <div
            ref={owner.setContent}
            className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 py-4"
          >
            <TurnTranscript key={CHAT_ID} />
            <div data-testid="rig-agent-row" className="ml-6">
              <Steps bare={false} />
            </div>
          </div>
        </div>
        <ComposerStub />
      </div>
    </TranscriptScrollProvider>
  );
}

export function AgentShell() {
  return <DaemonPortProvider port={NO_DAEMON}>{params.inline ? <Inline /> : <Tab />}</DaemonPortProvider>;
}
