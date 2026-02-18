import type { PermissionMode } from './settings.js';

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

export interface SpawnOptions {
  projectPath: string;
  chatId?: string;
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

export type PermissionBehavior = 'allow' | 'deny';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  suggestions: string[];
  decisionReason?: string;
}

export interface PermissionResponse {
  requestId: string;
  toolUseId: string;
  toolName?: string;
  behavior: PermissionBehavior;
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: string[];
  message?: string;
  executionMode?: 'default' | 'acceptEdits' | 'yolo';
  clearContext?: boolean;
}

export interface Adapter {
  id: string;
  name: string;

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  listModels(): Promise<AdapterModel[]>;
  spawn(options: SpawnOptions): Promise<AdapterProcess>;
  kill(process: AdapterProcess): Promise<void>;
  interrupt?(process: AdapterProcess): Promise<void>;
  setPermissionMode?(process: AdapterProcess, mode: PermissionMode): Promise<void>;
  setModel?(process: AdapterProcess, model: string): Promise<void>;
  sendCommand?(process: AdapterProcess, command: string, args?: string): Promise<void>;
  sendMessage(process: AdapterProcess, message: string, images?: { mediaType: string; data: string }[]): Promise<void>;
  respondToPermission(process: AdapterProcess, response: PermissionResponse): Promise<void>;
  loadHistory?(sessionId: string, projectPath: string): Promise<import('./chat.js').ChatMessage[]>;

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
