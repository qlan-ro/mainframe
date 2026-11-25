/** The Codex turns behind a sub-agent's call, as the transcript's parts name them. */
import type { ThreadMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import type { MainframeMessageMeta } from '@/features/chat/view-model/message-meta';
import type { SubagentCall } from './find-subagent-call';

type TurnState = TranscriptPresentation['state'];

function turnsOf(message: ThreadMessage): TranscriptPresentation[] {
  const meta = message.metadata?.custom?.mainframe as MainframeMessageMeta | undefined;
  return Object.values(meta?.partSources ?? {}).flatMap((sources) => sources.map((source) => source.presentation));
}

/** A Codex turn id is its thread's id and its own, in JSON. */
function threadOf(turnId: string): string {
  try {
    const parsed: unknown = JSON.parse(turnId);
    return Array.isArray(parsed) ? String(parsed[0]) : turnId;
  } catch {
    return turnId;
  }
}

/** The state of each agent's last turn, for those whose steps name one. Several agents can share a call. */
export function agentTurns({ part }: SubagentCall): TurnState[] {
  const last = new Map<string, TurnState>();
  for (const message of part.messages ?? [])
    for (const turn of turnsOf(message))
      if (turn.parentToolUseId === part.toolCallId) last.set(threadOf(turn.turnId), turn.state);
  return [...last.values()];
}

const isCut = (state: TurnState) => state === 'cancelled' || state === 'failed';

/**
 * Whether the parent's turn that made the call was interrupted or failed. The
 * call's own part says so, or failing that its neighbours: those between the
 * user message before it and the one after.
 */
export function startedInCutTurn(call: SubagentCall, messages: readonly ThreadMessage[]): boolean {
  const at = messages.findIndex((message) => message.id === call.messageId);
  if (at < 0) return false;
  const message = messages[at]!;
  const meta = message.metadata?.custom?.mainframe as MainframeMessageMeta | undefined;
  const index = message.content.findIndex(
    (part) => part.type === 'tool-call' && part.toolCallId === call.part.toolCallId,
  );
  const own = meta?.partSources?.[index]?.[0]?.presentation;
  if (own) return isCut(own.state);
  const isUser = (candidate: ThreadMessage) => candidate.role === 'user';
  const start = messages.slice(0, at).map(isUser).lastIndexOf(true);
  const next = messages.findIndex((candidate, i) => i > at && isUser(candidate));
  const around = messages.slice(start + 1, next < 0 ? undefined : next);
  return around.flatMap(turnsOf).some((turn) => turn.parentToolUseId === undefined && isCut(turn.state));
}

export function completedChildAnswer({ part }: SubagentCall): string {
  for (const message of [...(part.messages ?? [])].reverse()) {
    const meta = message.metadata?.custom?.mainframe as MainframeMessageMeta | undefined;
    for (let index = message.content.length - 1; index >= 0; index--) {
      const content = message.content[index];
      if (content?.type !== 'text') continue;
      if (
        meta?.partSources?.[index]?.some(
          ({ presentation }) =>
            presentation.parentToolUseId === part.toolCallId &&
            presentation.state === 'completed' &&
            presentation.phase === 'final_answer',
        )
      )
        return content.text.trim();
    }
  }
  return '';
}
