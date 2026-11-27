/**
 * A sub-agent tab's own tool call, fetched by itself (todo #460).
 *
 * A call below the parent transcript's history floor is read with
 * `_mainframe.dev/history_around` (`before: 0, after: 0`): one item plus its
 * ancestors, held in this tab's state and never merged into the parent's
 * window, so neither opening nor restoring a tab pages the parent.
 *
 * A window is a snapshot: the connection's stream drops changes below its
 * floor. So while the call is held here, it is re-fetched on exactly the
 * events that can change it without the stream saying so:
 *   - the turn ends (a foreground agent has finished by then),
 *   - compaction ends, or a resync/clear/reset reloads the transcript,
 *   - the daemon's task for this call changes (a background agent's progress
 *     and completion arrive on that side-band, not on the paged stream),
 *   - the tab is brought to the front.
 * Nothing polls, and nothing re-fetches while the call is in the live window,
 * where the stream keeps it current.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { AcpItemAccumulator } from '@/features/chat/view-model/acp-item-accumulator';
import { TranscriptConverter } from '@/features/chat/view-model/convert-acp-item';
import { normalizeNativeMessage } from '@/features/chat/view-model/normalize-native-messages';
import { sessionRuns } from './agent-status';
import { findSubagentCall, type SubagentCall } from './find-subagent-call';

export type OwnCall =
  | { kind: 'pending' }
  /** The daemon cannot answer `history_around`: the caller pages the parent as it always did. */
  | { kind: 'unsupported' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'call'; call: SubagentCall; messages: readonly ThreadMessage[] };

/** Counts the events that leave a held snapshot behind. */
function useRefetchVersion(
  controller: AcpChatController,
  state: ChatThreadState,
  taskKey: string,
  active: boolean,
): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const running = sessionRuns(state);
  const generation = controller.historyGeneration;
  const seen = useRef({ running, compacting: state.compacting, generation, taskKey, active });
  useEffect(() => {
    const before = seen.current;
    seen.current = { running, compacting: state.compacting, generation, taskKey, active };
    const turnEnded = before.running && !running;
    const compacted = before.compacting && !state.compacting;
    const reloaded = before.generation !== generation;
    const taskMoved = before.taskKey !== taskKey;
    const shown = !before.active && active;
    if (turnEnded || compacted || reloaded || taskMoved || shown) bump();
  }, [running, state.compacting, generation, taskKey, active]);
  return version;
}

export function useOwnSubagentCall(options: {
  controller: AcpChatController;
  state: ChatThreadState;
  toolCallId: string;
  /** False while the call is read some other way (a saved nested call, or the live window). */
  enabled: boolean;
  /** The daemon's tasks for this call, as one comparable string. */
  taskKey: string;
  active: boolean;
}): OwnCall {
  const { controller, state, toolCallId, enabled, taskKey, active } = options;
  const [held, setHeld] = useState<OwnCall>({ kind: 'pending' });
  const version = useRefetchVersion(controller, state, taskKey, active);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    controller.subagentHistory.around(toolCallId).then(
      (result) => {
        if (cancelled) return;
        if (result === null) return setHeld({ kind: 'unsupported' });
        const accumulator = new AcpItemAccumulator();
        accumulator.prepend(result.updates ?? []);
        const messages = new TranscriptConverter()
          .convert(accumulator.itemsInOrder, () => new Date(0))
          .map(normalizeNativeMessage);
        const call = result.stale ? null : findSubagentCall(messages, toolCallId);
        setHeld(call ? { kind: 'call', call, messages } : { kind: 'missing' });
      },
      (cause: unknown) => {
        if (cancelled) return;
        // A failed refresh keeps the call already shown.
        setHeld((current) =>
          current.kind === 'call'
            ? current
            : { kind: 'error', message: cause instanceof Error ? cause.message : 'Could not load the sub-agent' },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [controller, toolCallId, enabled, version]);

  return held;
}
