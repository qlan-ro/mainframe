/**
 * working-label — what the status line above the composer says while a turn runs.
 *
 * Mirrors the live activity group's wording (the same tool labels), so the pinned
 * line and the transcript name the same step. Permission and stop/compaction
 * states outrank the step because they are what the user needs to act on.
 */
import type { MessagePartState, ThreadMessage } from '@assistant-ui/react';
import { toMessagePartStatus } from '@assistant-ui/core/internal';
import { toolKind } from '../view-model/compact/tool-kind';
import { toolLabel } from '../view-model/compact/tool-label';
import { resolveToolStatus } from '../view-model/compact/tool-status';
import type { CompactToolPart } from '../view-model/compact/types';

export type WorkingTone = 'working' | 'attention';
export interface WorkingLabel {
  readonly text: string;
  readonly tone: WorkingTone;
}
export interface WorkingInputs {
  readonly stopping: boolean;
  readonly compacting: boolean;
  readonly awaitingInput: boolean;
}

const WORKING: WorkingLabel = { text: 'Working', tone: 'working' };

/** The newest running step of the latest assistant message: a running tool's label, or Thinking. */
export function currentStep(messages: readonly ThreadMessage[], pendingToolIds: ReadonlySet<string>): string | null {
  const message = messages[messages.length - 1];
  if (message?.role !== 'assistant') return null;
  for (let index = message.content.length - 1; index >= 0; index--) {
    const original = message.content[index]!;
    if (original.type !== 'tool-call' && original.type !== 'reasoning') continue;
    const part = { ...original, status: toMessagePartStatus(message, index, original) } as MessagePartState;
    if (part.type === 'reasoning') {
      if (part.status.type === 'running') return 'Thinking';
      continue;
    }
    const tool = part as CompactToolPart;
    if (resolveToolStatus(tool, pendingToolIds) !== 'running') continue;
    return toolLabel([tool], toolKind(tool.toolName), 'running') || null;
  }
  return null;
}

export function workingLabel(inputs: WorkingInputs, step: string | null): WorkingLabel {
  if (inputs.stopping) return { text: 'Stopping', tone: 'working' };
  if (inputs.awaitingInput) return { text: 'Needs your input', tone: 'attention' };
  if (inputs.compacting) return { text: 'Compacting', tone: 'working' };
  return step ? { text: step, tone: 'working' } : WORKING;
}

/** "1 running task" / "3 running tasks". */
export function runningTasksLabel(count: number): string {
  return `${count} running task${count === 1 ? '' : 's'}`;
}
