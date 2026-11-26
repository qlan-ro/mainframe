/**
 * Messages → drafts of turns, by structure alone, so it holds for every adapter
 * and for history: the assistant messages between two user messages, also split
 * where the provider started another turn on its own (a task result came back).
 * Where a draft ends says nothing about whether the agent's work in it did.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { isPlaceholder } from '../placeholder';
import { SkillMatcher } from './skill-matcher';
import type { TurnCache } from './turn-cache';
import { messageMeta } from './turn-units';
import type { TurnScope, TurnUnit } from './types';

export interface Draft {
  readonly key: string;
  readonly messages: ThreadMessage[];
  readonly units: (readonly TurnUnit[])[];
  providerTurn?: string;
  turnGroup?: string;
  /** Where its last message is, and the last one that says anything. */
  index: number;
  said: number;
  lastVisible?: ThreadMessage;
  /** Where the last error message inside it is. */
  error: number;
}

export interface Drafts {
  readonly drafts: readonly Draft[];
  /** The draft the transcript ends in; none under a message that was sent and has no answer yet. */
  readonly last: Draft | undefined;
  readonly skills: SkillMatcher;
}

function providerTurnOf(units: readonly TurnUnit[]): string | undefined {
  for (const { presentation } of units) if (presentation) return `${presentation.provider}:${presentation.turnId}`;
  return undefined;
}

/** A queued prompt and one the daemon has not confirmed, which may have failed, are not in the transcript. */
function sent(message: ThreadMessage): boolean {
  const meta = messageMeta(message);
  return meta?.queued !== true && meta?.pending !== true;
}

export function draftTurns(messages: readonly ThreadMessage[], scope: TurnScope, cache: TurnCache): Drafts {
  const drafts: Draft[] = [];
  const skills = new SkillMatcher();
  let open: Draft | undefined;
  for (const [index, message] of messages.entries()) {
    if (isPlaceholder(message)) continue;
    if (message.role === 'user') {
      if (!sent(message) || messageMeta(message)?.steered) continue;
      open = undefined;
      continue;
    }
    if (message.role === 'system') {
      const meta = messageMeta(message);
      if (meta?.providerSwitch) open = undefined;
      else if (meta?.skillLoaded) skills.claim(message.id, meta.skillLoaded, open?.units.flat() ?? []);
      continue;
    }
    if (messageMeta(message)?.errorText !== undefined) {
      if (open) open.error = index; // drawn on its own, as the error it is
      continue;
    }
    const units = cache.units(message, scope);
    const providerTurn = providerTurnOf(units);
    const group = messageMeta(message)?.turnGroup;
    if (
      open?.turnGroup && group
        ? open.turnGroup !== group
        : open?.providerTurn && providerTurn && open.providerTurn !== providerTurn
    )
      open = undefined;
    if (!open) {
      const key = JSON.stringify([scope.rootThreadId, scope.ancestors, message.id]);
      open = { key, messages: [], units: [], index, said: -1, error: -1 };
      drafts.push(open);
    }
    open.providerTurn ??= providerTurn;
    open.turnGroup ??= group;
    open.messages.push(message);
    open.units.push(units);
    open.index = index;
    if (units.length) {
      open.said = index;
      open.lastVisible = message;
    }
  }
  return { drafts, last: open, skills };
}
