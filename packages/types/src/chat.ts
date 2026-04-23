import type { SessionMention } from './context.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

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

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError: boolean;
      structuredPatch?: DiffHunk[];
      originalFile?: string;
      modifiedFile?: string;
    }
  | { type: 'permission_request'; request: import('./adapter.js').ControlRequest }
  | { type: 'error'; message: string }
  | { type: 'skill_loaded'; skillName: string; path: string; content: string };

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
