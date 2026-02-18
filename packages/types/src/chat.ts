import type { SessionMention } from './context.js';

export interface Chat {
  id: string;
  adapterId: string;
  projectId: string;
  title?: string;
  claudeSessionId?: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo';
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
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
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
  | { type: 'permission_request'; request: import('./adapter.js').PermissionRequest }
  | { type: 'error'; message: string };
