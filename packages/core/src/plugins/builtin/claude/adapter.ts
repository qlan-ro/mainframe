import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type {
  Adapter,
  AdapterModel,
  AdapterSession,
  SessionOptions,
  ChatMessage,
  Skill,
  AgentConfig,
  CreateSkillInput,
  CreateAgentInput,
} from '@mainframe/types';
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

export class ClaudeAdapter implements Adapter {
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

  async listModels(): Promise<AdapterModel[]> {
    return CLAUDE_MODELS;
  }

  getToolCategories(): ToolCategories {
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

  createSession(options: SessionOptions): AdapterSession {
    const session = new ClaudeSession(options);
    this.sessions.add(session);
    // ClaudeSession extends EventEmitter internally; cast is safe for cleanup tracking.
    (session as unknown as EventEmitter).once('exit', () => this.sessions.delete(session));
    return session;
  }

  async loadHistory(sessionId: string, projectPath: string): Promise<ChatMessage[]> {
    const session = this.createSession({ projectPath, chatId: sessionId });
    return session.loadHistory();
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill().catch(() => {});
    }
    this.sessions.clear();
  }

  async listSkills(projectPath: string): Promise<Skill[]> {
    return skills.listSkills(projectPath);
  }

  async createSkill(projectPath: string, input: CreateSkillInput): Promise<Skill> {
    return skills.createSkill(projectPath, input);
  }

  async updateSkill(skillId: string, projectPath: string, content: string): Promise<Skill> {
    return skills.updateSkill(skillId, projectPath, content);
  }

  async deleteSkill(skillId: string, projectPath: string): Promise<void> {
    return skills.deleteSkill(skillId, projectPath);
  }

  async listAgents(projectPath: string): Promise<AgentConfig[]> {
    return skills.listAgents(projectPath);
  }

  async createAgent(projectPath: string, input: CreateAgentInput): Promise<AgentConfig> {
    return skills.createAgent(projectPath, input);
  }

  async updateAgent(agentId: string, projectPath: string, content: string): Promise<AgentConfig> {
    return skills.updateAgent(agentId, projectPath, content);
  }

  async deleteAgent(agentId: string, projectPath: string): Promise<void> {
    return skills.deleteAgent(agentId, projectPath);
  }
}
