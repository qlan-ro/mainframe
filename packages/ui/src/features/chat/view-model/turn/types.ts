/**
 * The transcript's turn model. A turn is the agent's response to one user
 * message: its steps (`work`), the events that stay on the spine (`markers`)
 * and its final text (`answer`). Rows render per message, so a long turn stays
 * virtualized and a streamed chunk re-renders only the message it touched.
 */
import type { MessagePartState, ThreadMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';

export type ToolPart = Extract<MessagePartState, { type: 'tool-call' }>;
export type ToolStatus = 'running' | 'success' | 'failed' | 'stopped' | 'declined' | 'awaiting-approval' | 'unknown';
export type DiffStats = { added: number; removed: number };

export interface TurnScope {
  readonly rootThreadId: string;
  readonly ancestors: readonly string[];
  readonly pendingToolIds: ReadonlySet<string>;
  readonly isRunning?: boolean;
}

/** One visible part of one message. */
export interface TurnUnit {
  readonly key: string;
  readonly messageId: string;
  readonly index: number;
  readonly part: MessagePartState;
  readonly presentation?: TranscriptPresentation;
  /** The daemon's transcript item, when the part carries one. */
  readonly itemId?: string;
}

export type TurnEnd = 'done' | 'stopped' | 'error';
export type ChildKind = 'agent' | 'workflow';

export interface TurnChild {
  readonly toolCallId: string;
  readonly kind: ChildKind;
  readonly status: ToolStatus;
  /** A delegated task's own chat, once the call returned. */
  readonly taskChatId?: string;
  /** A workflow run's background task, once the call returned. */
  readonly workflowTaskId?: string;
}

export interface Turn {
  readonly key: string;
  readonly running: boolean;
  readonly end: TurnEnd;
  readonly durationMs?: number;
  /** "read 2 files, searched 1 pattern": the steps, without the agents the header names itself. */
  readonly summary: string;
  readonly hasWork: boolean;
  /** Failed steps no later step made good. */
  readonly failed: readonly string[];
  /** Failed steps a later step of the same tool and target made good. */
  readonly retried: readonly string[];
  readonly children: readonly TurnChild[];
  /** Keys of the work units, for the fold's interaction guard. */
  readonly workKeys: readonly string[];
}

/** What one assistant message contributes to its turn, in display order. */
export interface MessageSlice {
  readonly messageId: string;
  readonly turnKey: string;
  readonly work: readonly TurnUnit[];
  readonly markers: readonly TurnUnit[];
  readonly answer: readonly TurnUnit[];
  /** The message that carries the turn's work row. */
  readonly header: boolean;
  /** The message that carries the turn's footer. */
  readonly footer: boolean;
}

export interface LoadedSkill {
  readonly skillName: string;
  readonly path: string;
  readonly content: string;
}

export interface TurnModel {
  readonly turns: ReadonlyMap<string, Turn>;
  readonly slices: ReadonlyMap<string, MessageSlice>;
  /** Messages another element stands for: a skill's text, a task's result. */
  readonly absorbed: ReadonlySet<string>;
  /** Skill tool call → the text the CLI loaded for it. */
  readonly skills: ReadonlyMap<string, LoadedSkill>;
  /** The turn the transcript ends in, while the thread runs. */
  readonly runningKey?: string;
}

export type TranscriptMessages = readonly ThreadMessage[];
