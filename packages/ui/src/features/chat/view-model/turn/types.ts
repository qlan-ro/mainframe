/**
 * The transcript's turn model. A turn is the agent's response to one user
 * message: its steps (`work`), the events that stay on the spine (`markers`)
 * and its final text (`answer`). Rows render per message, so a long turn stays
 * virtualized and a streamed chunk re-renders only the message it touched.
 */
import type { MessagePartState, ThreadMessage } from '@assistant-ui/react';
import type { TaskStatus, TranscriptPresentation } from '@qlan-ro/mainframe-types';
import type { RunRecord } from '../../controller/run-records';

export type ToolPart = Extract<MessagePartState, { type: 'tool-call' }>;
export type ToolStatus = 'running' | 'success' | 'failed' | 'stopped' | 'declined' | 'awaiting-approval' | 'unknown';
export type DiffStats = { added: number; removed: number };

export interface TurnScope {
  readonly rootThreadId: string;
  readonly ancestors: readonly string[];
  readonly pendingToolIds: ReadonlySet<string>;
  readonly isRunning?: boolean;
  /** The runs the controller saw; without any, only the last message sent bounds the run in progress. */
  readonly runs?: readonly RunRecord[];
  /** Whether these messages' work can still be going. Left out: yes. */
  readonly live?: boolean;
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

/** How a part of a turn stands. `neutral`: nothing says how it ended. */
export type PartState = 'needs-you' | 'going' | 'error' | 'stopped' | 'finished' | 'neutral';

/** What a part's state is read from (`partState`). */
export interface PartEvidence {
  /** A pending request belongs to it. */
  readonly needsYou: boolean;
  /**
   * The run it belongs to: the one in progress; maybe that one, since where the
   * run began isn't known; or none that goes, also because the session is idle.
   */
  readonly run: 'current' | 'unknown' | 'over';
  /** A step of it has no outcome. */
  readonly unsettled: boolean;
  /** How the turn itself ended, when the provider, the daemon or an error said. */
  readonly ended?: 'error' | 'cancelled' | 'completed';
}

export type ChildKind = 'agent' | 'workflow';

export interface TurnChild {
  readonly toolCallId: string;
  readonly kind: ChildKind;
  readonly status: ToolStatus;
  /** A delegated task's own chat, once the call returned. */
  readonly taskChatId?: string;
  readonly taskId?: string;
  /** How the task stood when its call returned: final for a call that waited. */
  readonly taskStatus?: TaskStatus;
  /** Its call returned once the agent had started in the background. */
  readonly launched?: boolean;
  /** A workflow run's background task, once the call returned. */
  readonly workflowTaskId?: string;
}

export interface Turn {
  readonly key: string;
  /** The agent writes in it, or waits on the viewer in it. */
  readonly running: boolean;
  /** A step of it can still be going: it belongs, or may belong, to the run in progress. */
  readonly live: boolean;
  readonly evidence: PartEvidence;
  /** A step's outcome is unknown. While its turn claims no end, it doesn't fold by itself. */
  readonly unclear: boolean;
  readonly durationMs?: number;
  readonly costUsd?: number;
  /** Where the turn ends, whichever message carries its footer. */
  readonly lastMessageId: string;
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
  /** Absorbed message → the calls whose rows or markers show it, in its own order. */
  readonly absorbedBy: ReadonlyMap<string, readonly string[]>;
  /** Delegated task → the status its latest delivered result carries. */
  readonly taskResults: ReadonlyMap<string, TaskStatus>;
  /** Skill tool call → the text the CLI loaded for it. */
  readonly skills: ReadonlyMap<string, LoadedSkill>;
  /** The turn the transcript ends in, while the thread runs. */
  readonly runningKey?: string;
}

export type TranscriptMessages = readonly ThreadMessage[];
