import type { ExecutionMode, PermissionMode } from './settings.js';

export interface MessageMetadata {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface SessionResult {
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

export interface SessionOptions {
  projectPath: string;
  chatId?: string; // Claude session ID for resume (CLI-side identifier)
  mainframeChatId: string; // Mainframe-side chat identifier — used by tracker/WS/routes
}

export interface SessionSpawnOptions {
  model?: string;
  permissionMode?: ExecutionMode;
  planMode?: boolean;
  executablePath?: string;
  systemPrompt?: string;
  tuning?: import('./chat.js').ResolvedTuning;
}

export interface AdapterProcess {
  id: string;
  adapterId: string;
  chatId: string;
  pid: number;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
  projectPath: string;
  model?: string;
}

export type ControlBehavior = 'allow' | 'deny';

export type ControlDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg';

/** A control rule update to save for future tool uses. */
export type ControlUpdate =
  | {
      type: 'addRules';
      rules: { toolName: string; ruleContent?: string }[];
      behavior: 'allow' | 'deny' | 'ask';
      destination: ControlDestination;
    }
  | {
      type: 'replaceRules';
      rules: { toolName: string; ruleContent?: string }[];
      behavior: 'allow' | 'deny' | 'ask';
      destination: ControlDestination;
    }
  | {
      type: 'removeRules';
      rules: { toolName: string; ruleContent?: string }[];
      behavior: 'allow' | 'deny' | 'ask';
      destination: ControlDestination;
    }
  | { type: 'setMode'; mode: PermissionMode; destination: ControlDestination }
  | { type: 'addDirectories'; directories: string[]; destination: ControlDestination }
  | { type: 'removeDirectories'; directories: string[]; destination: ControlDestination };

export interface ControlRequest {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  suggestions: ControlUpdate[];
  decisionReason?: string;
}

export interface ControlResponse {
  requestId: string;
  toolUseId: string;
  toolName?: string;
  behavior: ControlBehavior;
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: ControlUpdate[];
  message?: string;
  executionMode?: ExecutionMode;
  clearContext?: boolean;
}

export interface ContextUsage {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
}

export interface DetectedPr {
  url: string;
  owner: string;
  repo: string;
  number: number;
  source: 'created' | 'mentioned';
}

export interface SessionSink {
  onInit(sessionId: string): void;
  onMessage(content: import('./chat.js').MessageContent[], metadata?: MessageMetadata): void;
  onToolResult(content: import('./chat.js').MessageContent[]): void;
  onPermission(request: ControlRequest): void;
  onResult(data: SessionResult): void;
  onExit(code: number | null): void;
  onError(error: Error): void;
  onCompact(): void;
  onCompactStart(): void;
  onContextUsage(usage: ContextUsage): void;
  onPlanFile(filePath: string): void;
  onSkillFile(entry: import('./context.js').SkillFileEntry): void;
  onQueuedProcessed(uuid: string): void;
  onTodoUpdate(todos: import('./chat.js').TodoItem[]): void;
  onPrDetected(pr: DetectedPr): void;
  /** CLI-synthesized feedback text (e.g. unknown-command errors) shown as system messages. */
  onCliMessage(text: string): void;
  /** A skill was loaded via slash-command; show a collapsible skill card instead of raw text. */
  onSkillLoaded(entry: { skillName: string; path: string; content: string }): void;
  /**
   * Inline content blocks from a subagent stream event under the parent assistant
   * message that owns the matching Agent/Task tool_use. Caller must have stamped
   * each block's `.parentToolUseId` field with the same value passed as the
   * `parentToolUseId` argument so the display pipeline can group them under the
   * matching Task card. Implementations must no-op silently if `parentToolUseId`
   * does not match any known tool_use block.
   */
  onSubagentChild(parentToolUseId: string, blocks: import('./chat.js').MessageContent[]): void;
  /** Non-fatal: the CLI reported the workspace is untrusted (advisory, run continues). */
  onTrustRequired?(projectPath: string): void;
}

export interface AdapterSession {
  readonly id: string;
  readonly adapterId: string;
  readonly projectPath: string;
  readonly isSpawned: boolean;
  /**
   * True when the adapter's protocol echoes a per-message replay ack that
   * Mainframe can use to drive `sink.onQueuedProcessed(uuid)` — e.g. the
   * Claude CLI's `isReplay` user event over stream-json. Adapters whose
   * `sendMessage` consumes the message synchronously (Codex `turn/start`,
   * Claude SDK `streamFollowUp`) leave this `false` (or undefined). The
   * chat-manager only enrolls a message in `queuedRefs` when this is true,
   * so chats on non-acknowledging adapters never get stuck in
   * `processState='working'` waiting for an ack that will never arrive.
   */
  readonly supportsReplayAck?: boolean;

  /**
   * Epoch ms of last protocol activity (stdin write or stdout event). Optional
   * — adapters that don't track activity may omit it, in which case the
   * idle-eviction scanner treats the session as always-active.
   */
  readonly lastActivityAt?: number;

  spawn(options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess>;
  kill(): Promise<void>;
  getProcessInfo(): AdapterProcess | null;

  sendMessage(message: string, images?: { mediaType: string; data: string }[], uuid?: string): Promise<void>;
  respondToPermission(response: ControlResponse): Promise<void>;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: ExecutionMode): Promise<void>;
  setPlanMode(on: boolean): Promise<void>;
  sendCommand(command: string, args?: string): Promise<void>;
  cancelQueuedMessage(uuid: string): Promise<boolean>;
  getContextFiles(): { global: import('./context.js').ContextFile[]; project: import('./context.js').ContextFile[] };
  loadHistory(): Promise<import('./chat.js').ChatMessage[]>;
  extractPlanFiles(): Promise<string[]>;
  extractSkillFiles(): Promise<import('./context.js').SkillFileEntry[]>;

  /** Stop a running background task by id. Adapters that don't support bg tasks may resolve `{ok: false, error: 'unsupported'}`. */
  stopBackgroundTask(taskId: string): Promise<{ ok: boolean; error?: string }>;

  /** Apply a fully-resolved tuning to a live session. */
  applyTuning?(tuning: import('./chat.js').ResolvedTuning): Promise<void>;
}

export interface AdapterInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  models: AdapterModel[];
  /** Monotonic per-adapter counter, bumped on every models change. Absent on legacy/mobile payloads. */
  modelsRevision?: number;
  /** Provenance of `models`: 'probed' = live CLI catalog, 'fallback' = static list. Absent on legacy payloads. */
  catalogSource?: 'probed' | 'fallback';
  capabilities: {
    planMode: boolean;
  };
}

/**
 * Full union across both CLIs. Codex ReasoningEffort = none/minimal/low/medium/high/xhigh;
 * Claude adds 'max'. The per-model `supportedEfforts` array is the runtime gate.
 */
export type EffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AdapterModel {
  id: string;
  label: string;
  description?: string;
  contextWindow?: number;
  isDefault?: boolean;
  /** Dynamic, per-model. Empty/absent → model has no effort control. */
  supportedEfforts?: EffortLevel[];
  defaultEffort?: EffortLevel;
  supportsFast?: boolean;
  supportsUltracode?: boolean;
  supportsAdaptiveThinking?: boolean;
  supportsPersonality?: boolean;
}

/**
 * Single source of truth for the boolean tuning features. Resolver clamp, Claude
 * flag-settings mapping, and renderer gating all iterate this — no per-feature branches.
 */
export const TUNABLE_FEATURES = [
  { key: 'fast', capability: 'supportsFast', claudeSetting: 'fastMode', providerDefault: 'defaultFast' },
  {
    key: 'ultracode',
    capability: 'supportsUltracode',
    claudeSetting: 'ultracode',
    providerDefault: 'defaultUltracode',
  },
  {
    key: 'adaptiveThinking',
    capability: 'supportsAdaptiveThinking',
    claudeSetting: 'alwaysThinkingEnabled',
    providerDefault: 'defaultAdaptiveThinking',
  },
] as const;

export type FeatureKey = (typeof TUNABLE_FEATURES)[number]['key'];

const EFFORT_RANK: Record<EffortLevel, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

/**
 * Clamp a requested effort to what a model supports — the single source of truth used
 * by BOTH the core resolver (at spawn/apply) and the renderer (for display), so the
 * composer chip can never disagree with what the server resolves.
 *
 *   requested ∈ supported            → requested
 *   else defaultEffort ∈ supported   → defaultEffort
 *   else highest supported ≤ requested (then lowest supported)
 *   supported empty (no effort)      → null
 */
export function clampEffortToSupported(
  requested: EffortLevel,
  supported: readonly EffortLevel[],
  defaultEffort?: EffortLevel,
): EffortLevel | null {
  if (supported.length === 0) return null;
  if (supported.includes(requested)) return requested;
  if (defaultEffort && supported.includes(defaultEffort)) return defaultEffort;
  const below = supported
    .filter((e) => EFFORT_RANK[e] <= EFFORT_RANK[requested])
    .sort((a, b) => EFFORT_RANK[b] - EFFORT_RANK[a]);
  return below[0] ?? [...supported].sort((a, b) => EFFORT_RANK[a] - EFFORT_RANK[b])[0] ?? null;
}

export interface ExternalSession {
  sessionId: string; // CLI's native session UUID
  adapterId: string; // Which adapter discovered this session
  projectPath: string; // Project root the session was attributed to (Mainframe-side)
  cwd?: string; // Working directory the session actually ran in (worktree, subdir, or root)
  firstPrompt?: string; // First user message (truncated)
  title?: string; // Resolved display title (customTitle > aiTitle > summary > firstPrompt > synthetic)
  summary?: string; // AI-generated summary if available
  messageCount?: number;
  createdAt: string; // ISO-8601
  modifiedAt: string;
  gitBranch?: string;
  model?: string;
}

/**
 * A page of importable external sessions.
 * `total` is the candidate (stat-only) count; `nextOffset` is the offset to
 * request next, or null when the candidate list is exhausted.
 */
export interface ExternalSessionPage {
  sessions: ExternalSession[];
  total: number;
  nextOffset: number | null;
}

export interface Adapter {
  id: string;
  name: string;
  readonly capabilities: {
    planMode: boolean;
  };

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  listModels(): Promise<AdapterModel[]>;
  probeModels?(executablePath?: string): Promise<AdapterModel[] | null>;
  /** Synchronous static fallback catalog for instant, spawn-free startup seeding. */
  getFallbackModels?(): AdapterModel[];

  createSession(options: SessionOptions): AdapterSession;
  killAll(): void;
  getToolCategories?(): import('./display.js').ToolCategories;

  getContextFiles?(projectPath: string): {
    global: import('./context.js').ContextFile[];
    project: import('./context.js').ContextFile[];
  };

  listSkills?(projectPath: string): Promise<import('./skill.js').Skill[]>;
  listAgents?(projectPath: string): Promise<import('./skill.js').AgentConfig[]>;
  listCommands?(): import('./command.js').CustomCommand[];
  createSkill?(projectPath: string, input: import('./skill.js').CreateSkillInput): Promise<import('./skill.js').Skill>;
  updateSkill?(skillId: string, projectPath: string, content: string): Promise<import('./skill.js').Skill>;
  deleteSkill?(skillId: string, projectPath: string): Promise<void>;
  createAgent?(
    projectPath: string,
    input: import('./skill.js').CreateAgentInput,
  ): Promise<import('./skill.js').AgentConfig>;
  updateAgent?(agentId: string, projectPath: string, content: string): Promise<import('./skill.js').AgentConfig>;
  deleteAgent?(agentId: string, projectPath: string): Promise<void>;
  listExternalSessions?(
    projectPath: string,
    excludeSessionIds: string[],
    opts?: { offset?: number; limit?: number },
  ): Promise<ExternalSessionPage>;

  /**
   * Whether the CLI's transcript for `sessionId` still exists on disk.
   * Returns `null` when presence cannot be determined (e.g. the adapter's own
   * registry is unreadable) — callers must treat `null` as "don't flag".
   */
  isTranscriptPresent?(
    sessionId: string,
    projectPath: string,
    sessionFilePath?: string | null,
  ): Promise<boolean | null>;

  /**
   * Factory for an adapter-specific plan-mode action handler.
   *
   * Returns `unknown` here to avoid a core→types dependency cycle — core casts
   * the result to `PlanModeActionHandler` (defined in
   * `packages/core/src/chat/plan-mode-actions.ts`).
   */
  createPlanModeHandler?(): unknown;
}
