import type { DiffHunk } from './chat.js';

export interface ToolCallResult {
  content: string;
  isError: boolean;
  structuredPatch?: DiffHunk[];
  originalFile?: string;
  modifiedFile?: string;
}

export interface ToolCategories {
  explore: Set<string>;
  hidden: Set<string>;
  progress: Set<string>;
  subagent: Set<string>;
}

export type DisplayContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; mediaType: string; data: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      input: Record<string, unknown>;
      category: 'default' | 'explore' | 'hidden' | 'progress' | 'subagent';
      result?: ToolCallResult;
    }
  | { type: 'tool_group'; calls: DisplayContent[] }
  | { type: 'task_group'; agentId: string; calls: DisplayContent[] }
  | { type: 'permission_request'; request: unknown }
  | { type: 'error'; message: string };

export interface DisplayMessage {
  id: string;
  chatId: string;
  type: 'user' | 'assistant' | 'system' | 'error' | 'permission';
  content: DisplayContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}
