import type { DiffHunk } from './chat.js';
import type { ControlRequest } from './adapter.js';
import type { LeafContent } from './content.js';

export interface AskUserQuestionAnswer {
  question: string;
  answer: string[];
  preview?: string;
  notes?: string;
}

export interface ToolCallResult {
  content: string;
  isError: boolean;
  structuredPatch?: DiffHunk[];
  originalFile?: string;
  modifiedFile?: string;
  truncated?: boolean;
  fullBytes?: number;
  askUserQuestion?: AskUserQuestionAnswer[];
}

export interface ToolCategories {
  explore: Set<string>;
  hidden: Set<string>;
  progress: Set<string>;
  subagent: Set<string>;
}

export type DisplayContent =
  | LeafContent
  | {
      type: 'tool_call';
      id: string;
      name: string;
      input: Record<string, unknown>;
      category: 'default' | 'explore' | 'hidden' | 'progress' | 'subagent';
      result?: ToolCallResult;
      parentToolUseId?: string;
    }
  | { type: 'tool_group'; calls: DisplayContent[] }
  | {
      type: 'task_group';
      agentId: string;
      taskArgs: Record<string, unknown>;
      calls: DisplayContent[];
      result?: ToolCallResult;
    }
  | {
      type: 'task_progress';
      items: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
        category: 'progress';
        result?: ToolCallResult;
      }>;
    }
  | { type: 'permission_request'; request: ControlRequest; parentToolUseId?: string }
  | { type: 'error'; message: string }
  | { type: 'compaction'; parentToolUseId?: string };

export interface DisplayMessage {
  id: string;
  chatId: string;
  type: 'user' | 'assistant' | 'system' | 'error' | 'permission';
  content: DisplayContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}
