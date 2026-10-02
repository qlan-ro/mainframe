import type { MessagePartState, ToolCallTiming } from '@assistant-ui/react';

export type CompactToolPart = Extract<MessagePartState, { type: 'tool-call' }>;
export type IndexedPart = { readonly index: number; readonly part: MessagePartState };
export type ToolKind =
  | 'read'
  | 'edit'
  | 'write'
  | 'glob'
  | 'grep'
  | 'list'
  | 'web-search'
  | 'fetch'
  | 'shell'
  | 'subagent'
  | 'mcp'
  | 'unknown';
export type ToolStatus = 'running' | 'success' | 'failed' | 'stopped' | 'declined' | 'awaiting-approval' | 'unknown';
export type DiffStats = { added: number; removed: number };

export interface CompactToolRow {
  type: 'tool';
  indices: number[];
  toolCallIds: string[];
  kind: ToolKind;
  status: ToolStatus;
  label: string;
  diff?: DiffStats;
  timing?: ToolCallTiming;
  reportedDurationMs?: number;
}
export type CompactRow =
  | CompactToolRow
  | { type: 'reasoning'; indices: number[]; running: boolean; label: 'Thinking' | 'Thought' }
  | { type: 'passthrough'; indices: number[] };
