import { execFile } from 'node:child_process';
import type {
  Adapter,
  AdapterModel,
  AdapterSession,
  CustomCommand,
  ExternalSession,
  SessionOptions,
  Skill,
  AgentConfig,
  CreateSkillInput,
  CreateAgentInput,
} from '@qlan-ro/mainframe-types';
import { ClaudeSession } from './session.js';
import * as skills from './skills.js';
import { listExternalSessions } from './external-sessions.js';
import type { ToolCategories } from '../../../messages/tool-categorization.js';
import manifest from './manifest.json' with { type: 'json' };

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

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('claude', ['--version'], (err, _stdout, _stderr) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('claude', ['--version'], (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        resolve(match?.[1] ?? stdout.trim());
      });
    });
  }

  async listModels(): Promise<AdapterModel[]> {
    return CLAUDE_MODELS;
  }

  getToolCategories(): ToolCategories {
    return {
      explore: new Set(['Read', 'Glob', 'Grep', 'LS']),
      hidden: new Set([
        'TaskList',
        'TaskGet',
        'TaskOutput',
        'TaskStop',
        'TodoWrite',
        'Skill',
        'EnterPlanMode',
        'AskUserQuestion',
        'ToolSearch',
      ]),
      progress: new Set(['TaskCreate', 'TaskUpdate']),
      subagent: new Set(['Task']),
    };
  }

  createSession(options: SessionOptions): AdapterSession {
    const session = new ClaudeSession(options, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
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

  listCommands(): CustomCommand[] {
    // Commands disabled: /clear and /compact don't work reliably via sendCommand()
    // in stream-json mode. Keep the infrastructure for when this is fixed upstream.
    return [];
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

  async listExternalSessions(projectPath: string, excludeSessionIds: string[]): Promise<ExternalSession[]> {
    return listExternalSessions(projectPath, excludeSessionIds);
  }
}
