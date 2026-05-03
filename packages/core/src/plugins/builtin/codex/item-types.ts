// packages/core/src/plugins/builtin/codex/item-types.ts
// ThreadItem union and all item-specific interfaces for the Codex protocol.

export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | ImageGenerationItem
  | UserMessageItem;

export interface AgentMessageItem {
  id: string;
  type: 'agentMessage';
  text: string;
  phase: string | null;
}

export interface ReasoningItem {
  id: string;
  type: 'reasoning';
  summary: string[];
  content: string[];
}

export interface CommandExecutionItem {
  id: string;
  type: 'commandExecution';
  command: string;
  aggregatedOutput: string;
  exitCode?: number;
  status: 'in_progress' | 'completed' | 'failed';
}

// Matches PatchChangeKind from v2 schema (tagged union with optional move_path)
export type PatchChangeKind = { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null };

// Matches PatchApplyStatus from v2 schema
export type PatchApplyStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export interface FileChangeItem {
  id: string;
  type: 'fileChange';
  changes: Array<{ path: string; kind: PatchChangeKind; diff: string }>;
  status: PatchApplyStatus;
}

export interface McpToolCallItem {
  id: string;
  type: 'mcpToolCall';
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: { content: unknown[]; structuredContent: unknown | null; _meta: unknown | null } | null;
  error: { message: string } | null;
  status: 'inProgress' | 'completed' | 'failed';
  mcpAppResourceUri?: string;
  durationMs?: number | null;
}

export interface WebSearchItem {
  id: string;
  type: 'webSearch';
  query: string;
}

export interface ImageGenerationItem {
  id: string;
  type: 'imageGeneration';
  /** Base64-encoded image bytes (PNG). Always present in completed events. */
  result?: string;
  /** Filesystem path where Codex saved the generated image — may be empty during 'generating'. */
  savedPath?: string;
  /** The model's revised version of the user's prompt, if available */
  revisedPrompt?: string;
  status: 'generating' | 'completed' | 'failed';
}

export interface TodoListItem {
  id: string;
  type: 'todoList';
  items: Array<{ text: string; completed: boolean }>;
}

export interface UserMessageItem {
  id: string;
  type: 'userMessage';
  text: string;
}
