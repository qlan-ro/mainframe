import type { SessionMention } from './context.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export type ChatEffort = 'low' | 'medium' | 'high';

export interface Chat {
  id: string;
  adapterId: string;
  projectId: string;
  title?: string;
  claudeSessionId?: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'yolo';
  planMode?: boolean;
  status: 'active' | 'paused' | 'ended' | 'archived';
  createdAt: string;
  updatedAt: string;
  totalCost: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  lastContextTokensInput: number;
  contextFiles?: string[];
  mentions?: SessionMention[];
  modifiedFiles?: string[];
  worktreePath?: string;
  branchName?: string;
  processState?: 'working' | 'idle' | null;
  displayStatus?: 'idle' | 'working' | 'waiting';
  isRunning?: boolean;
  worktreeMissing?: boolean;
  todos?: TodoItem[];
  pinned?: boolean;
  /** Reasoning effort for Claude adapter (gated on model.supportsEffort). Applied as --effort on CLI spawn. */
  effort?: ChatEffort;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  parentProjectId?: string | null;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'permission' | 'system' | 'error';
  content: MessageContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * `parentToolUseId` is set on a content block to indicate it originated from a
 * subagent stream event (CLI emits with `parent_tool_use_id`). The display
 * pipeline groups these blocks under the parent's Agent/Task `tool_use` as
 * `_TaskGroup` children. The field is on every variant — including `image`,
 * `permission_request`, `error` — so the event handlers can spread the tag
 * uniformly (`{...block, parentToolUseId}`) without per-variant filtering.
 * The pipeline only renders the variants that have a Task-card child kind:
 * `text`, `thinking`, `tool_use`, `tool_result`, `skill_loaded`. Other
 * variants carrying the field are tolerated and rendered at root as usual.
 */
export type MessageContent =
  | { type: 'text'; text: string; parentToolUseId?: string }
  | { type: 'image'; mediaType: string; data: string; parentToolUseId?: string }
  | { type: 'thinking'; thinking: string; parentToolUseId?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; parentToolUseId?: string }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError: boolean;
      structuredPatch?: DiffHunk[];
      originalFile?: string;
      modifiedFile?: string;
      parentToolUseId?: string;
    }
  | { type: 'permission_request'; request: import('./adapter.js').ControlRequest; parentToolUseId?: string }
  | { type: 'error'; message: string; parentToolUseId?: string }
  | { type: 'skill_loaded'; skillName: string; path: string; content: string; parentToolUseId?: string }
  | { type: 'compaction'; parentToolUseId?: string };

export type ToolResultMessageContent = Extract<MessageContent, { type: 'tool_result' }>;

/** Tracks a message that was sent to stdin while the CLI was busy. */
export interface QueuedMessageRef {
  /** The display message ID (from MessageCache) */
  messageId: string;
  chatId: string;
  /** UUID sent to the CLI for cancel/tracking */
  uuid: string;
  content: string;
  attachmentIds?: string[];
  timestamp: string;
}
