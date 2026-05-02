// packages/core/src/plugins/builtin/codex/types.ts

// --- JSON-RPC 2.0 framing ---

export type RequestId = string | number;

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: RequestId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  id: RequestId;
  error: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcServerRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcResponse | JsonRpcErrorResponse | JsonRpcNotification | JsonRpcServerRequest;

export function isJsonRpcResponse(msg: object): msg is JsonRpcResponse {
  return 'id' in msg && 'result' in msg;
}

export function isJsonRpcError(msg: object): msg is JsonRpcErrorResponse {
  return 'id' in msg && 'error' in msg;
}

export function isJsonRpcNotification(msg: object): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

export function isJsonRpcServerRequest(msg: object): msg is JsonRpcServerRequest {
  return 'method' in msg && 'id' in msg;
}

// --- Initialize ---

export interface InitializeParams {
  clientInfo: { name: string; title: string; version: string };
  capabilities?: { experimentalApi?: boolean };
}

export interface InitializeResult {
  userAgent: string;
  codexHome: string;
}

// --- Thread ---

export interface ThreadStartParams {
  model?: string;
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  sandbox?: SandboxMode;
  experimentalRawEvents?: boolean;
  persistExtendedHistory?: boolean;
}

export interface ThreadStartResult {
  thread: { id: string };
}

export interface ThreadResumeParams {
  threadId: string;
  model?: string;
  cwd?: string;
  persistExtendedHistory?: boolean;
}

export interface ThreadResumeResult {
  thread: { id: string };
}

export interface ThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export interface ThreadReadResult {
  thread: {
    id: string;
    turns?: Array<{ id: string; status: TurnStatus; items: ThreadItem[] }>;
  };
}

export interface ThreadListParams {
  cwd?: string;
  archived?: boolean;
}

export interface ThreadSummary {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  modelProvider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadListResult {
  data: ThreadSummary[];
}

// --- Turn ---

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  approvalPolicy?: ApprovalPolicy;
  sandboxPolicy?: SandboxPolicy;
  collaborationMode?: CollaborationMode;
  model?: string;
}

export interface TurnStartResult {
  turn: { id: string; status: TurnStatus };
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type TurnStatus = 'inProgress' | 'completed' | 'interrupted' | 'failed';

// --- Items ---

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

// --- Approvals ---

export interface CommandExecutionApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  command?: string;
  cwd?: string;
  reason?: string;
}

export interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string;
}

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

// --- Event notification params ---

export interface ThreadStartedParams {
  thread: { id: string };
}

export interface ItemStartedParams {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface ItemCompletedParams {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface AgentMessageDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface TurnStartedParams {
  threadId: string;
  turn: { id: string };
}

export interface TurnCompletedParams {
  threadId: string;
  turn: {
    id: string;
    status: TurnStatus;
    items: ThreadItem[];
    error: { message: string } | null;
  };
}

export interface TokenUsageUpdatedParams {
  threadId: string;
  usage: Usage;
}

export interface TurnFailedParams {
  threadId: string;
  turn: { id: string; error: { message: string } };
}

// --- Config ---

export type ApprovalPolicy = 'never' | 'on-request' | 'untrusted';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type SandboxPolicy = { type: 'readOnly' } | { type: 'workspaceWrite' } | { type: 'dangerFullAccess' };

export interface CollaborationMode {
  mode: 'plan' | 'default';
  settings: CollaborationModeSettings;
}

export interface CollaborationModeSettings {
  model: string;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

export interface ModelInfo {
  id: string;
  displayName?: string;
}

export interface ModelListResult {
  data: ModelInfo[];
}

// --- User input ---

export type UserInput = TextInput | LocalImageInput;

export interface TextInput {
  type: 'text';
  text: string;
  text_elements?: never[];
}

export interface LocalImageInput {
  type: 'localImage';
  path: string;
}

// --- Usage ---

export interface Usage {
  input_tokens: number;
  cached_input_tokens?: number;
  output_tokens: number;
}
