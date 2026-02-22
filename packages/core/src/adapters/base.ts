import { EventEmitter } from 'node:events';
import type {
  Adapter,
  AdapterModel,
  AdapterProcess,
  SpawnOptions,
  PermissionResponse,
  PermissionRequest,
  PermissionMode,
  MessageContent,
  ChatMessage,
  ContextFile,
  Skill,
  AgentConfig,
  CreateSkillInput,
  CreateAgentInput,
  SkillFileEntry,
} from '@mainframe/types';
import type { ToolCategories } from '../messages/tool-categorization.js';

export interface MessageMetadata {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface AdapterEvents {
  init: (processId: string, claudeSessionId: string, model: string, tools: string[]) => void;
  message: (processId: string, content: MessageContent[], metadata?: MessageMetadata) => void;
  tool_result: (processId: string, content: MessageContent[]) => void;
  permission: (processId: string, request: PermissionRequest) => void;
  result: (
    processId: string,
    data: {
      cost: number;
      tokensInput: number;
      tokensOutput: number;
      subtype?: string;
      isError?: boolean;
      durationMs?: number;
    },
  ) => void;
  compact: (processId: string) => void;
  plan_file: (processId: string, filePath: string) => void;
  skill_file: (processId: string, filePath: string) => void;
  error: (processId: string, error: Error) => void;
  exit: (processId: string, code: number | null) => void;
}

export abstract class BaseAdapter extends EventEmitter implements Adapter {
  abstract id: string;
  abstract name: string;

  abstract isInstalled(): Promise<boolean>;
  abstract getVersion(): Promise<string | null>;
  async listModels(): Promise<AdapterModel[]> {
    return [];
  }
  abstract spawn(options: SpawnOptions): Promise<AdapterProcess>;
  abstract kill(process: AdapterProcess): Promise<void>;
  async interrupt(_process: AdapterProcess): Promise<void> {}
  async setPermissionMode(_process: AdapterProcess, _mode: PermissionMode): Promise<void> {}
  async setModel(_process: AdapterProcess, _model: string): Promise<void> {}
  async sendCommand(_process: AdapterProcess, _command: string, _args?: string): Promise<void> {}
  abstract sendMessage(
    process: AdapterProcess,
    message: string,
    images?: { mediaType: string; data: string }[],
  ): Promise<void>;
  abstract respondToPermission(process: AdapterProcess, response: PermissionResponse): Promise<void>;

  getToolCategories(): ToolCategories {
    return { explore: new Set(), hidden: new Set(), progress: new Set(), subagent: new Set() };
  }

  getContextFiles(_projectPath: string): { global: ContextFile[]; project: ContextFile[] } {
    return { global: [], project: [] };
  }

  async loadHistory(_sessionId: string, _projectPath: string): Promise<ChatMessage[]> {
    return [];
  }

  async extractPlanFiles(_sessionId: string, _projectPath: string): Promise<string[]> {
    return [];
  }

  async extractSkillFiles(_sessionId: string, _projectPath: string): Promise<SkillFileEntry[]> {
    return [];
  }

  async listSkills(_projectPath: string): Promise<Skill[]> {
    return [];
  }

  async listAgents(_projectPath: string): Promise<AgentConfig[]> {
    return [];
  }

  async createSkill(_projectPath: string, _input: CreateSkillInput): Promise<Skill> {
    throw new Error('Not implemented');
  }

  async updateSkill(_skillId: string, _projectPath: string, _content: string): Promise<Skill> {
    throw new Error('Not implemented');
  }

  async deleteSkill(_skillId: string, _projectPath: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async createAgent(_projectPath: string, _input: CreateAgentInput): Promise<AgentConfig> {
    throw new Error('Not implemented');
  }

  async updateAgent(_agentId: string, _projectPath: string, _content: string): Promise<AgentConfig> {
    throw new Error('Not implemented');
  }

  async deleteAgent(_agentId: string, _projectPath: string): Promise<void> {
    throw new Error('Not implemented');
  }

  override emit<K extends keyof AdapterEvents>(event: K, ...args: Parameters<AdapterEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof AdapterEvents>(event: K, listener: AdapterEvents[K]): this {
    return super.on(event, listener);
  }
}
