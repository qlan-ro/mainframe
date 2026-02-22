import { spawn } from 'node:child_process';
import type {
  AdapterModel,
  AdapterSession,
  SessionOptions,
  ChatMessage,
  Skill,
  AgentConfig,
  CreateSkillInput,
  CreateAgentInput,
} from '@mainframe/types';
import { BaseAdapter } from '../../../adapters/base.js';
import { ClaudeSession } from './session.js';
import * as skills from './skills.js';
import type { ToolCategories } from '../../../messages/tool-categorization.js';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const CLAUDE_MODELS: AdapterModel[] = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
];

export class ClaudeAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Claude CLI';

  private sessions = new Set<ClaudeSession>();

  // TODO we might need to support user provided path instead of relying it's added to $PATH
  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { shell: true });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }

  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { shell: true });
      let output = '';
      child.stdout?.on('data', (chunk) => (output += chunk.toString()));
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code === 0) {
          const match = output.match(/(\d+\.\d+\.\d+)/);
          resolve(match?.[1] ?? output.trim());
        } else {
          resolve(null);
        }
      });
    });
  }

  override async listModels(): Promise<AdapterModel[]> {
    return CLAUDE_MODELS;
  }

  override getToolCategories(): ToolCategories {
    return {
      explore: new Set(['Read', 'Glob', 'Grep']),
      hidden: new Set([
        'TaskList',
        'TaskGet',
        'TaskOutput',
        'TaskStop',
        'TodoWrite',
        'Skill',
        'EnterPlanMode',
        'AskUserQuestion',
      ]),
      progress: new Set(['TaskCreate', 'TaskUpdate']),
      subagent: new Set(['Task']),
    };
  }

  override createSession(options: SessionOptions): AdapterSession {
    const session = new ClaudeSession(options);
    this.sessions.add(session);
    session.on('exit', () => this.sessions.delete(session));
    return session;
  }

  async loadHistory(sessionId: string, projectPath: string): Promise<ChatMessage[]> {
    const session = this.createSession({ projectPath, chatId: sessionId });
    return session.loadHistory();
  }

  override killAll(): void {
    for (const session of this.sessions) {
      session.kill().catch(() => {});
    }
    this.sessions.clear();
  }

  override async listSkills(projectPath: string): Promise<Skill[]> {
    return skills.listSkills(projectPath);
  }

  override async createSkill(projectPath: string, input: CreateSkillInput): Promise<Skill> {
    return skills.createSkill(projectPath, input);
  }

  override async updateSkill(skillId: string, projectPath: string, content: string): Promise<Skill> {
    return skills.updateSkill(skillId, projectPath, content);
  }

  override async deleteSkill(skillId: string, projectPath: string): Promise<void> {
    return skills.deleteSkill(skillId, projectPath);
  }

  override async listAgents(projectPath: string): Promise<AgentConfig[]> {
    return skills.listAgents(projectPath);
  }

  override async createAgent(projectPath: string, input: CreateAgentInput): Promise<AgentConfig> {
    return skills.createAgent(projectPath, input);
  }

  override async updateAgent(agentId: string, projectPath: string, content: string): Promise<AgentConfig> {
    return skills.updateAgent(agentId, projectPath, content);
  }

  override async deleteAgent(agentId: string, projectPath: string): Promise<void> {
    return skills.deleteAgent(agentId, projectPath);
  }
}
