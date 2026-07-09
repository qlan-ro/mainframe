// packages/core/src/plugins/builtin/codex/adapter.ts
import { execFile, spawn } from 'node:child_process';
import type {
  Adapter,
  AdapterModel,
  AdapterSession,
  ExternalSession,
  ExternalSessionPage,
  SessionOptions,
} from '@qlan-ro/mainframe-types';
import { CodexSession } from './session.js';
import { CodexPlanModeHandler } from './plan-mode-handler.js';
import { isCodexTranscriptPresent } from './transcript.js';
import { JsonRpcClient } from './jsonrpc.js';
import type { ToolCategories } from '../../../messages/tool-categorization.js';
import type { InitializeResult, ModelInfo, ModelListResult, ThreadListResult } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:adapter');

export function mapCodexModel(m: ModelInfo): AdapterModel {
  const model: AdapterModel = { id: m.id, label: m.displayName ?? m.id };
  if (m.description) model.description = m.description;
  if (m.isDefault) model.isDefault = true;
  if (m.supportedReasoningEfforts?.length) {
    model.supportedEfforts = m.supportedReasoningEfforts.map((e) => e.reasoningEffort);
  }
  if (m.defaultReasoningEffort) model.defaultEffort = m.defaultReasoningEffort;
  if (m.additionalSpeedTiers?.includes('fast')) model.supportsFast = true;
  if (m.supportsPersonality) model.supportsPersonality = true;
  return model;
}

export class CodexAdapter implements Adapter {
  readonly id = 'codex';
  readonly name = 'Codex';
  readonly capabilities = { planMode: true } as const;

  private sessions = new Set<CodexSession>();
  /** Model catalog is static per session; cache it so resolution (spawn + every
   *  composer toggle) doesn't respawn a temp app-server each time. */
  private cachedModels: AdapterModel[] | null = null;

  createPlanModeHandler(): unknown {
    return new CodexPlanModeHandler();
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('codex', ['--version'], (err) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('codex', ['--version'], (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        resolve(match?.[1] ?? stdout.trim());
      });
    });
  }

  getFallbackModels(): AdapterModel[] {
    return [];
  }

  async listModels(): Promise<AdapterModel[]> {
    if (this.cachedModels) return this.cachedModels;
    let client: JsonRpcClient | null = null;
    try {
      client = await this.spawnTempAppServer();
      const result = await client.request<ModelListResult>('model/list');
      const models = result.data.filter((m) => !m.hidden).map(mapCodexModel);
      if (models.length > 0) this.cachedModels = models; // don't cache transient failures (empty)
      return models;
    } catch (err) {
      log.warn({ err }, 'codex: failed to list models');
      return [];
    } finally {
      client?.close();
    }
  }

  getToolCategories(): ToolCategories {
    return {
      explore: new Set(),
      hidden: new Set([
        'todo_list', // Codex todoList items — hidden from chat; Context tab TasksSection (todo #133) handles them
      ]),
      progress: new Set(['todo_list']), // declared for parity; redundant once hidden filter fires
      subagent: new Set(['CollabAgent']),
    };
  }

  createSession(options: SessionOptions): AdapterSession {
    const session = new CodexSession(options, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill().catch((err) => log.warn({ err }, 'failed to kill codex session during killAll'));
    }
    this.sessions.clear();
  }

  // TODO: implement getContextFiles
  // TODO: implement listSkills, createSkill, updateSkill, deleteSkill
  // TODO: implement listAgents, createAgent, updateAgent, deleteAgent
  // TODO: implement listCommands

  async listExternalSessions(
    projectPath: string,
    excludeSessionIds: string[],
    opts?: { offset?: number; limit?: number },
  ): Promise<ExternalSessionPage> {
    let client: JsonRpcClient | null = null;
    try {
      client = await this.spawnTempAppServer();
      const seen = new Set<string>();
      const aggregated: ExternalSession[] = [];
      try {
        const result = await client.request<ThreadListResult>('thread/list', {
          cwd: projectPath,
          archived: false,
        });
        for (const t of result.data) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          aggregated.push({
            sessionId: t.id,
            adapterId: this.id,
            projectPath,
            firstPrompt: t.name ?? t.preview,
            summary: t.name ?? t.preview,
            createdAt: new Date(t.createdAt).toISOString(),
            modifiedAt: new Date(t.updatedAt).toISOString(),
            model: t.model,
          });
        }
      } catch (err) {
        log.warn({ err, projectPath }, 'codex: failed to list external sessions for path');
      }
      const excludeSet = new Set(excludeSessionIds);
      const filtered = aggregated.filter((s) => !excludeSet.has(s.sessionId));
      const offset = Math.max(0, opts?.offset ?? 0);
      const limit = opts?.limit ?? 50;
      const total = filtered.length;
      if (limit <= 0) return { sessions: [], total, nextOffset: null };
      const sessions = filtered.slice(offset, offset + limit);
      const nextOffset = offset + limit < total ? offset + limit : null;
      return { sessions, total, nextOffset };
    } catch (err) {
      log.warn({ err }, 'codex: failed to list external sessions');
      return { sessions: [], total: 0, nextOffset: null };
    } finally {
      client?.close();
    }
  }

  async isTranscriptPresent(sessionId: string): Promise<boolean | null> {
    return isCodexTranscriptPresent(sessionId);
  }

  private async spawnTempAppServer(): Promise<JsonRpcClient> {
    const child = spawn('codex', ['app-server'], {
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const client = new JsonRpcClient(child, {
      onNotification: () => {},
      onRequest: () => {},
      onError: () => {},
      onExit: () => {},
    });

    await client.request<InitializeResult>('initialize', {
      clientInfo: { name: 'mainframe', title: 'Mainframe', version: '1.0.0' },
    });
    client.notify('initialized');

    return client;
  }
}
