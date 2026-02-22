import type {
  Adapter,
  AdapterModel,
  AdapterSession,
  SessionOptions,
  Skill,
  AgentConfig,
  CreateSkillInput,
  CreateAgentInput,
} from '@mainframe/types';
import type { ToolCategories } from '../messages/tool-categorization.js';

export abstract class BaseAdapter implements Adapter {
  abstract id: string;
  abstract name: string;

  abstract isInstalled(): Promise<boolean>;
  abstract getVersion(): Promise<string | null>;

  async listModels(): Promise<AdapterModel[]> {
    return [];
  }

  abstract createSession(options: SessionOptions): AdapterSession;

  killAll(): void {}

  getToolCategories(): ToolCategories {
    return { explore: new Set(), hidden: new Set(), progress: new Set(), subagent: new Set() };
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
}
