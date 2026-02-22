import type { PermissionMode } from './settings.js';

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
  chatId?: string; // Claude session ID for resume
}

export interface SessionSpawnOptions {
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo';
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
  executionMode?: 'default' | 'acceptEdits' | 'yolo';
  clearContext?: boolean;
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
  onPlanFile(filePath: string): void;
  onSkillFile(entry: import('./context.js').SkillFileEntry): void;
}

export interface AdapterSession {
  readonly id: string;
  readonly adapterId: string;
  readonly projectPath: string;
  readonly isSpawned: boolean;

  spawn(options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess>;
  kill(): Promise<void>;
  getProcessInfo(): AdapterProcess | null;

  sendMessage(message: string, images?: { mediaType: string; data: string }[]): Promise<void>;
  respondToPermission(response: ControlResponse): Promise<void>;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  sendCommand(command: string, args?: string): Promise<void>;

  getContextFiles(): { global: import('./context.js').ContextFile[]; project: import('./context.js').ContextFile[] };
  loadHistory(): Promise<import('./chat.js').ChatMessage[]>;
  extractPlanFiles(): Promise<string[]>;
  extractSkillFiles(): Promise<import('./context.js').SkillFileEntry[]>;
}

export interface AdapterInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  models: AdapterModel[];
}

export interface AdapterModel {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface Adapter {
  id: string;
  name: string;

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  listModels(): Promise<AdapterModel[]>;

  createSession(options: SessionOptions): AdapterSession;
  killAll(): void;

  getContextFiles?(projectPath: string): {
    global: import('./context.js').ContextFile[];
    project: import('./context.js').ContextFile[];
  };

  listSkills?(projectPath: string): Promise<import('./skill.js').Skill[]>;
  listAgents?(projectPath: string): Promise<import('./skill.js').AgentConfig[]>;
  createSkill?(projectPath: string, input: import('./skill.js').CreateSkillInput): Promise<import('./skill.js').Skill>;
  updateSkill?(skillId: string, projectPath: string, content: string): Promise<import('./skill.js').Skill>;
  deleteSkill?(skillId: string, projectPath: string): Promise<void>;
  createAgent?(
    projectPath: string,
    input: import('./skill.js').CreateAgentInput,
  ): Promise<import('./skill.js').AgentConfig>;
  updateAgent?(agentId: string, projectPath: string, content: string): Promise<import('./skill.js').AgentConfig>;
  deleteAgent?(agentId: string, projectPath: string): Promise<void>;
}
