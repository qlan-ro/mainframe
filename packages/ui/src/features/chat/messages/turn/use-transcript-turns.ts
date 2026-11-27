/**
 * The turn model the transcript draws, kept per chat across switches for the chat column
 * (`transcript-view-models.ts`). Other views (a workspace tab, a side chat) build their own, as before:
 * they can show the same chat at once from another projection, and one shared entry would thrash.
 */
import { useContext, useEffect, useMemo } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { PanelColumnContext } from '@/features/session-panel/panel-control-store';
import { useUiPrefs } from '@/store/ui-prefs';
import type { AcpChatController } from '../../controller/acp-chat-controller';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import { buildTurns } from '../../view-model/turn/build-turns';
import { TurnCache } from '../../view-model/turn/turn-cache';
import { TranscriptViewModels } from '../../view-model/turn/transcript-view-models';
import type { TurnModel, TurnScope } from '../../view-model/turn/types';

type Prefs = ReturnType<typeof useUiPrefs.getState>;

/** The display settings a cached transcript was drawn with. */
const presentationOf = (prefs: Prefs) => `${prefs.finishedWork}|${prefs.plainTranscript}|${prefs.historyTurns}`;

/** What the window is: an older page lowers its floor, a trim raises it, a jump window replaces it. */
function windowOf(state: ChatThreadState): readonly unknown[] {
  return [state.historyWindow.floorItemId, state.windowMessages];
}

export const transcriptViewModels = new TranscriptViewModels({
  watch: (owner, changed) => {
    const controller = owner as AcpChatController;
    let last = windowOf(controller.getState());
    return controller.subscribeState(() => {
      const next = windowOf(controller.getState());
      if (next.every((part, index) => Object.is(part, last[index]))) return;
      last = next;
      changed();
    });
  },
});

useUiPrefs.subscribe((prefs, previous) => {
  if (presentationOf(prefs) !== presentationOf(previous)) transcriptViewModels.invalidateAll();
});

/** The controller was disposed: its cached models go with it (`chat-controller-registry.ts`). */
export function releaseTranscriptViewModels(controller: AcpChatController): void {
  transcriptViewModels.release(controller);
}

/** `controllerOf` is asked only in the chat column: other views never touch the registry. */
export function useTranscriptTurns(
  messages: readonly ThreadMessage[],
  scope: TurnScope,
  controllerOf: () => AcpChatController | undefined,
): TurnModel {
  const column = useContext(PanelColumnContext) === 'main';
  const owner = column ? controllerOf() : undefined;
  const view = scope.rootThreadId;
  const presentation = useUiPrefs(presentationOf);
  const local = useMemo(() => new TurnCache(), []);
  useEffect(() => (owner ? transcriptViewModels.hold(owner, view) : undefined), [owner, view]);
  return useMemo(
    () =>
      owner
        ? transcriptViewModels.model(owner, view, { messages, scope, presentation })
        : buildTurns(messages, scope, local),
    [owner, view, messages, scope, presentation, local],
  );
}
