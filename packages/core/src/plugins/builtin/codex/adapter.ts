// packages/core/src/plugins/builtin/codex/adapter.ts
import { execFile, spawn } from 'node:child_process';
import type { Adapter, AdapterModel, AdapterSession, ExternalSession, SessionOptions } from '@qlan-ro/mainframe-types';
import { CodexSession } from './session.js';
import { JsonRpcClient } from './jsonrpc.js';
import type { ToolCategories } from '../../../messages/tool-categorization.js';
import type { InitializeResult, ModelListResult, ThreadListResult } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:adapter');

export class CodexAdapter implements Adapter {
  readonly id = 'codex';
  readonly name = 'Codex';

  private sessions = new Set<CodexSession>();

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

  async listModels(): Promise<AdapterModel[]> {
    let client: JsonRpcClient | null = null;
    try {
      client = await this.spawnTempAppServer();
      const result = await client.request<ModelListResult>('model/list');
      return (result.models ?? []).map((m) => ({
        id: m.id,
        label: m.name ?? m.id,
      }));
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
      hidden: new Set(),
      progress: new Set(['todo_list']),
      subagent: new Set(),
    };
  }

  createSession(options: SessionOptions): AdapterSession {
    const session = new CodexSession(options, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill().catch(() => {});
    }
    this.sessions.clear();
  }

  // TODO: implement getContextFiles
  // TODO: implement listSkills, createSkill, updateSkill, deleteSkill
  // TODO: implement listAgents, createAgent, updateAgent, deleteAgent
  // TODO: implement listCommands

  async listExternalSessions(projectPath: string, _excludeSessionIds: string[]): Promise<ExternalSession[]> {
    let client: JsonRpcClient | null = null;
    try {
      client = await this.spawnTempAppServer();
      const result = await client.request<ThreadListResult>('thread/list', {
        cwd: projectPath,
        archived: false,
      });
      return result.threads.map((t) => ({
        sessionId: t.id,
        adapterId: this.id,
        projectPath,
        firstPrompt: t.name,
        summary: t.name,
        createdAt: t.createdAt ?? new Date().toISOString(),
        modifiedAt: t.modifiedAt ?? new Date().toISOString(),
        model: t.model,
      }));
    } catch (err) {
      log.warn({ err }, 'codex: failed to list external sessions');
      return [];
    } finally {
      client?.close();
    }
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
