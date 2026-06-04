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
import { BackgroundTaskTracker } from '../../../background-tasks/tracker.js';
import { probeModels as doProbeModels } from './probe-models.js';
import * as skills from './skills.js';
import { listExternalSessions } from './external-sessions.js';
import { ClaudePlanModeHandler } from './plan-mode-handler.js';
import type { ToolCategories } from '../../../messages/tool-categorization.js';
import { createChildLogger } from '../../../logger.js';
import manifest from './manifest.json' with { type: 'json' };

const log = createChildLogger('claude:adapter');

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EXTENDED_CONTEXT_WINDOW = 1_000_000;
const CLAUDE_MODELS: AdapterModel[] = [
  // The CLI accepts "default" as an alias that resolves to the user's tier default
  // at spawn time (Opus 4.7 on Max with 1M merge enabled). The probe replaces this
  // with the live catalog, but keep the label aligned with the current upstream default.
  {
    id: 'default',
    label: 'Default - Opus 4.7',
    description: 'Opus 4.7 with 1M context',
    contextWindow: EXTENDED_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsFast: true,
    supportsUltracode: true,
    supportsAdaptiveThinking: true,
    isDefault: true,
  },
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.6',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsFast: true,
    supportsUltracode: true,
    supportsAdaptiveThinking: true,
  },
  {
    id: 'opus[1m]',
    label: 'Opus 4.6 (1M context)',
    contextWindow: EXTENDED_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsFast: true,
    supportsUltracode: true,
    supportsAdaptiveThinking: true,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'max'],
    supportsFast: true,
  },
  {
    id: 'sonnet[1m]',
    label: 'Sonnet 4.6 (1M context)',
    contextWindow: EXTENDED_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'max'],
    supportsFast: true,
  },
  {
    id: 'claude-opus-4-5-20251101',
    label: 'Opus 4.5',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsUltracode: true,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Sonnet 4.5',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'max'],
  },
  {
    id: 'claude-opus-4-1-20250805',
    label: 'Opus 4.1',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsUltracode: true,
  },
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Sonnet 4',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'max'],
  },
  {
    id: 'claude-opus-4-20250514',
    label: 'Opus 4.0',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsUltracode: true,
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    label: 'Sonnet 3.7',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    supportedEfforts: ['low', 'medium', 'high', 'max'],
  },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-3-5-sonnet-20241022', label: 'Sonnet 3.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
];

// The CLI's model probe doesn't expose context window size — only a marketing
// description like "Opus 4.7 with 1M context". Reconcile probed entries with
// the static catalog so known IDs retain their authoritative window, and
// unknown IDs fall back to a description sniff before the 200k default.
function enrichWithContextWindow(probed: AdapterModel[]): AdapterModel[] {
  const staticById = new Map(CLAUDE_MODELS.map((m) => [m.id, m]));
  return probed.map((model) => {
    if (model.contextWindow) return model;
    const fromStatic = staticById.get(model.id)?.contextWindow;
    if (fromStatic) return { ...model, contextWindow: fromStatic };
    const window = /\b1m\b|1m context/i.test(model.description ?? '')
      ? EXTENDED_CONTEXT_WINDOW
      : DEFAULT_CONTEXT_WINDOW;
    return { ...model, contextWindow: window };
  });
}

export class ClaudeAdapter implements Adapter {
  id = 'claude';
  name = manifest.name;
  readonly capabilities = { planMode: true } as const;

  private sessions = new Set<ClaudeSession>();
  private dynamicModels: AdapterModel[] | null = null;

  // Default arg keeps existing direct-construct call sites (tests under
  // packages/core/src/__tests__/ and plugins/.../__tests__/) compiling
  // without mass-editing them. Production wiring at core/src/index.ts
  // passes the shared singleton explicitly; tests get their own throwaway
  // instance.
  constructor(private readonly backgroundTasks: BackgroundTaskTracker = new BackgroundTaskTracker()) {}

  createPlanModeHandler(): unknown {
    return new ClaudePlanModeHandler();
  }

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
    return this.dynamicModels ?? CLAUDE_MODELS;
  }

  async probeModels(): Promise<AdapterModel[] | null> {
    const models = await doProbeModels('claude');
    if (models) {
      this.dynamicModels = enrichWithContextWindow(models);
    }
    return this.dynamicModels;
  }

  getToolCategories(): ToolCategories {
    return {
      explore: new Set(['Read', 'Glob', 'Grep', 'LS']),
      hidden: new Set([
        // TodoV1
        'TodoWrite',
        // TodoV2 (gated by isTodoV2Enabled() in the CLI; emitted as _TaskProgress)
        'TaskCreate',
        'TaskUpdate',
        'TaskList',
        'TaskGet',
        'TaskOutput',
        'TaskStop',
        // Mode/internal
        'EnterPlanMode',
        'AskUserQuestion', // pending state surfaces via BottomCard
        'ToolSearch',
      ]),
      progress: new Set(['TaskCreate', 'TaskUpdate']),
      subagent: new Set(['Task', 'Agent']),
    };
  }

  createSession(options: SessionOptions): AdapterSession {
    const session = new ClaudeSession(options, () => this.sessions.delete(session), this.backgroundTasks);
    this.sessions.add(session);
    return session;
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill().catch((err) => log.warn({ err }, 'failed to kill claude session during killAll'));
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
