import { EventEmitter } from 'node:events';
import type {
  AdapterSession,
  AdapterProcess,
  SessionSpawnOptions,
  PermissionResponse,
  ChatMessage,
  ContextFile,
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

export abstract class BaseSession extends EventEmitter implements AdapterSession {
  abstract readonly id: string;
  abstract readonly adapterId: string;
  abstract readonly projectPath: string;

  abstract get isSpawned(): boolean;

  abstract spawn(options?: SessionSpawnOptions): Promise<AdapterProcess>;
  abstract kill(): Promise<void>;
  abstract getProcessInfo(): AdapterProcess | null;

  async sendMessage(_message: string, _images?: { mediaType: string; data: string }[]): Promise<void> {}
  async respondToPermission(_response: PermissionResponse): Promise<void> {}
  async interrupt(): Promise<void> {}
  async setModel(_model: string): Promise<void> {}
  async setPermissionMode(_mode: string): Promise<void> {}
  async sendCommand(_command: string, _args?: string): Promise<void> {}

  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    return { global: [], project: [] };
  }

  async loadHistory(): Promise<ChatMessage[]> {
    return [];
  }

  async extractPlanFiles(): Promise<string[]> {
    return [];
  }

  async extractSkillFiles(): Promise<SkillFileEntry[]> {
    return [];
  }

  getToolCategories(): ToolCategories {
    return { explore: new Set(), hidden: new Set(), progress: new Set(), subagent: new Set() };
  }
}
