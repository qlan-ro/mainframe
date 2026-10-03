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

export interface ActivityMember extends IndexedPart {
  readonly messageId: string;
  readonly rootThreadId: string;
  readonly ancestors: readonly string[];
  readonly sourceMessageId?: string;
  readonly sourceBlockIndex?: number;
  readonly presentation?: import('@qlan-ro/mainframe-types').TranscriptPresentation;
  readonly boundary?: boolean;
}
export interface ActivityGroup {
  readonly type: 'activity';
  readonly members: readonly ActivityMember[];
  readonly active: boolean;
}
export type ActivityEntry = ActivityGroup | { readonly type: 'standalone'; readonly member: ActivityMember };
export interface ActivityLabel {
  readonly identity: string;
  readonly text: string;
}
