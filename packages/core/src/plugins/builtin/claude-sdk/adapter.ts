import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeSdkSession } from './session.js';
import {
  listSkills,
  listAgents,
  createSkill,
  updateSkill,
  deleteSkill,
  createAgent,
  updateAgent,
  deleteAgent,
} from './skills.js';
import { getContextFilesForProject } from './context.js';
import { createChildLogger } from '../../../logger.js';
import type {
  Adapter,
  AdapterModel,
  AdapterSession,
  ExternalSession,
  SessionOptions,
  Skill,
  AgentConfig,
  CreateSkillInput,
  CreateAgentInput,
  CustomCommand,
  ContextFile,
  ToolCategories,
} from '@qlan-ro/mainframe-types';

const execFileAsync = promisify(execFile);
const logger = createChildLogger('claude-sdk-adapter');

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EXTENDED_CONTEXT_WINDOW = 1_000_000;
const CLAUDE_MODELS: AdapterModel[] = [
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    id: 'opus[1m]',
    label: 'Claude Opus 4.6 (1M context)',
    contextWindow: EXTENDED_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsAutoMode: true,
  },
  {
    id: 'sonnet[1m]',
    label: 'Claude Sonnet 4.6 (1M context)',
    contextWindow: EXTENDED_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsAutoMode: true,
  },
  {
    id: 'claude-opus-4-5-20251101',
    label: 'Claude Opus 4.5',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsAutoMode: true,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Claude Sonnet 4.5',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsAutoMode: true,
  },
  {
    id: 'claude-opus-4-1-20250805',
    label: 'Claude Opus 4.1',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsAutoMode: true,
  },
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsAutoMode: true,
  },
  {
    id: 'claude-opus-4-20250514',
    label: 'Claude Opus 4.0',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
    supportsAutoMode: true,
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    label: 'Claude Sonnet 3.7',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportsEffort: true,
  },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude Sonnet 3.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
];

export class ClaudeSdkAdapter implements Adapter {
  readonly id = 'claude-sdk';
  readonly name = 'Claude Agent SDK';

  private sessions = new Set<ClaudeSdkSession>();

  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync('claude', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('claude', ['--version']);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async listModels(): Promise<AdapterModel[]> {
    return CLAUDE_MODELS;
  }

  createSession(options: SessionOptions): AdapterSession {
    const session = new ClaudeSdkSession(options, () => {
      this.sessions.delete(session);
    });
    this.sessions.add(session);
    return session;
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill().catch((err) => {
        logger.warn({ err }, 'Failed to kill session');
      });
    }
    this.sessions.clear();
  }

  getToolCategories(): ToolCategories {
    return {
      explore: new Set(['Glob', 'Grep', 'Read', 'LSP']),
      hidden: new Set([
        'TodoWrite',
        'TaskOutput',
        'TaskStop',
        'Skill',
        'AskUserQuestion',
        'EnterPlanMode',
        'ExitPlanMode',
        'ToolSearch',
      ]),
      progress: new Set(['Bash', 'Write', 'Edit', 'NotebookEdit']),
      subagent: new Set(['Agent']),
    };
  }

  getContextFiles(projectPath: string): { global: ContextFile[]; project: ContextFile[] } {
    return getContextFilesForProject(projectPath);
  }

  async listSkills(projectPath: string): Promise<Skill[]> {
    return listSkills(projectPath);
  }

  async listAgents(projectPath: string): Promise<AgentConfig[]> {
    return listAgents(projectPath);
  }

  listCommands(): CustomCommand[] {
    return [];
  }

  async createSkill(projectPath: string, input: CreateSkillInput): Promise<Skill> {
    return createSkill(projectPath, input);
  }

  async updateSkill(skillId: string, projectPath: string, content: string): Promise<Skill> {
    return updateSkill(skillId, projectPath, content);
  }

  async deleteSkill(skillId: string, projectPath: string): Promise<void> {
    return deleteSkill(skillId, projectPath);
  }

  async createAgent(projectPath: string, input: CreateAgentInput): Promise<AgentConfig> {
    return createAgent(projectPath, input);
  }

  async updateAgent(agentId: string, projectPath: string, content: string): Promise<AgentConfig> {
    return updateAgent(agentId, projectPath, content);
  }

  async deleteAgent(agentId: string, projectPath: string): Promise<void> {
    return deleteAgent(agentId, projectPath);
  }

  async listExternalSessions(projectPath: string, excludeSessionIds: string[]): Promise<ExternalSession[]> {
    try {
      const sessions = await listSessions({ dir: projectPath });
      const excludeSet = new Set(excludeSessionIds);

      return sessions
        .filter((s: any) => !excludeSet.has(s.sessionId))
        .map((s: any) => ({
          sessionId: s.sessionId,
          adapterId: this.id,
          projectPath,
          firstPrompt: s.firstPrompt,
          summary: s.summary,
          messageCount: s.messageCount,
          createdAt: s.createdAt ?? new Date().toISOString(),
          modifiedAt: s.modifiedAt ?? new Date().toISOString(),
          gitBranch: s.gitBranch,
          model: s.model,
        }));
    } catch (err) {
      logger.warn({ err }, 'Failed to list external sessions via SDK');
      return [];
    }
  }
}
