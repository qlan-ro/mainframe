import type { AdapterSession, Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';
import type { AdapterRegistry } from '../adapters/index.js';
import type { DatabaseManager } from '../db/index.js';
import { createWorktree, removeWorktree, moveSessionFiles, getClaudeProjectDir } from '../workspace/index.js';
import type { ActiveChat } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('config-manager');

export interface ConfigManagerDeps {
  adapters: AdapterRegistry;
  db: DatabaseManager;
  startingChats: Map<string, Promise<void>>;
  getActiveChat: (chatId: string) => ActiveChat | undefined;
  startChat: (chatId: string) => Promise<void>;
  stopChat: (chatId: string) => Promise<void>;
  emitEvent: (event: DaemonEvent) => void;
  /** Re-resolve tuning against the (possibly new) model and apply to the live session. */
  applyTuning: (chatId: string) => Promise<void>;
  /** Stop launch processes for a project+path pair (e.g. before worktree removal) */
  stopLaunchProcesses?: (projectId: string, projectPath: string) => Promise<void>;
}

export class ChatConfigManager {
  constructor(private deps: ConfigManagerDeps) {}

  setStopLaunchProcesses(fn: (projectId: string, projectPath: string) => Promise<void>): void {
    this.deps.stopLaunchProcesses = fn;
  }

  private requireActiveChat(chatId: string): ActiveChat {
    const active = this.deps.getActiveChat(chatId);
    if (!active) throw new Error(`Chat ${chatId} not found`);
    return active;
  }

  /** Kill the spawned adapter session, if any, and detach it from the active chat. */
  private async detachSession(active: ActiveChat): Promise<void> {
    if (active.session?.isSpawned) {
      await active.session.kill();
      active.session = null;
    }
  }

  /**
   * Apply one config setting to an already-spawned session and stage it into `updates`/
   * `active.chat` only if the CLI accepts it. Rejections are logged, not thrown, so sibling
   * settings in the same request still get their own chance to apply.
   */
  private async applyLiveSetting<K extends 'model' | 'permissionMode' | 'planMode'>(
    chatId: string,
    active: ActiveChat,
    updates: Partial<Chat>,
    key: K,
    value: Chat[K] | undefined,
    setter: (value: NonNullable<Chat[K]>) => Promise<void>,
  ): Promise<void> {
    if (value === undefined) return;
    const setterName = `set${key[0]!.toUpperCase()}${key.slice(1)}`;
    try {
      await setter(value as NonNullable<Chat[K]>);
      updates[key] = value;
      active.chat[key] = value;
    } catch (err) {
      log.warn({ err, chatId }, `${setterName} rejected; not persisting ${key}`);
    }
  }

  /**
   * Each setting is applied and persisted INDEPENDENTLY: a rejected/timed-out setModel()
   * (which now awaits and throws — see session.ts) must not skip setPermissionMode or
   * setPlanMode, and must not 500 the whole request. Only settings the CLI actually
   * accepted get written to the DB.
   */
  private async applyLiveSessionSettings(
    chatId: string,
    active: ActiveChat,
    session: AdapterSession,
    changes: { model?: string; permissionMode?: Chat['permissionMode']; planMode?: boolean },
  ): Promise<void> {
    const updates: Partial<Chat> = {};
    await this.applyLiveSetting(chatId, active, updates, 'model', changes.model, (v) => session.setModel(v));
    await this.applyLiveSetting(chatId, active, updates, 'permissionMode', changes.permissionMode, (v) =>
      session.setPermissionMode(v),
    );
    await this.applyLiveSetting(chatId, active, updates, 'planMode', changes.planMode, (v) => session.setPlanMode(v));

    if (Object.keys(updates).length === 0) return;
    this.deps.db.chats.update(chatId, updates);
    // Model switch can invalidate the live tuning (e.g. xhigh/ultracode on a model that
    // doesn't support them). Re-resolve against the new model and re-apply.
    if (updates.model !== undefined) await this.deps.applyTuning(chatId);
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
  }

  /**
   * Config change that needs a respawn: an adapter switch, or any setting change while no live
   * session exists yet to apply it to directly. Waits out an in-flight spawn, kills the current
   * session, persists the new settings, then restarts if a session had been running.
   */
  private async respawnWithConfig(
    chatId: string,
    active: ActiveChat,
    changes: { adapterId?: string; model?: string; permissionMode?: Chat['permissionMode']; planMode?: boolean },
  ): Promise<void> {
    const inflight = this.deps.startingChats.get(chatId);
    if (inflight) {
      try {
        await inflight;
      } catch {
        /* spawn may have failed */
      }
    }

    const wasSpawned = active.session?.isSpawned ?? false;
    if (wasSpawned) {
      await active.session!.kill();
      active.session = null;
    }

    const updates: Partial<Chat> = {};
    if (changes.adapterId !== undefined) {
      updates.adapterId = changes.adapterId;
      active.chat.adapterId = changes.adapterId;
    }
    if (changes.model !== undefined) {
      updates.model = changes.model;
      active.chat.model = changes.model;
    }
    if (changes.permissionMode !== undefined) {
      updates.permissionMode = changes.permissionMode;
      active.chat.permissionMode = changes.permissionMode;
    }
    if (changes.planMode !== undefined) {
      updates.planMode = changes.planMode;
      active.chat.planMode = changes.planMode;
    }

    this.deps.db.chats.update(chatId, updates);
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
    if (wasSpawned) await this.deps.startChat(chatId);
  }

  /** Persist a worktree path/branch change (undefined clears it) and broadcast it. */
  private applyWorktreeUpdate(
    active: ActiveChat,
    chatId: string,
    worktreePath: string | undefined,
    branchName: string | undefined,
  ): void {
    active.chat.worktreePath = worktreePath;
    active.chat.branchName = branchName;
    this.deps.db.chats.update(chatId, { worktreePath, branchName });
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
  }

  async updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: Chat['permissionMode'],
    planMode?: boolean,
  ): Promise<void> {
    const active = this.requireActiveChat(chatId);

    if (adapterId !== undefined && adapterId !== active.chat.adapterId && active.chat.claudeSessionId) {
      throw new Error('Cannot change adapter after a session has started');
    }

    const adapterChanged = adapterId !== undefined && adapterId !== active.chat.adapterId;
    const modelChanged = model !== undefined && model !== active.chat.model;
    const modeChanged = permissionMode !== undefined && permissionMode !== active.chat.permissionMode;
    const planModeChanged = planMode !== undefined && planMode !== (active.chat.planMode ?? false);
    if (!adapterChanged && !modelChanged && !modeChanged && !planModeChanged) return;

    if (active.session?.isSpawned && !adapterChanged) {
      await this.applyLiveSessionSettings(chatId, active, active.session, {
        model: modelChanged ? model : undefined,
        permissionMode: modeChanged ? permissionMode : undefined,
        planMode: planModeChanged ? planMode : undefined,
      });
      return;
    }

    await this.respawnWithConfig(chatId, active, {
      adapterId: adapterChanged ? adapterId : undefined,
      model: modelChanged ? model : undefined,
      permissionMode: modeChanged ? permissionMode : undefined,
      planMode: planModeChanged ? planMode : undefined,
    });
  }

  async enableWorktree(chatId: string, baseBranch: string, branchName: string): Promise<void> {
    const active = this.requireActiveChat(chatId);
    if (active.chat.worktreePath) return;

    const project = this.deps.db.projects.get(active.chat.projectId);
    if (!project) throw new Error('Project not found');

    if (active.chat.claudeSessionId) {
      // Mid-session path: stop, create worktree, move session files (claude only), restart.
      // Codex resumes by threadId + cwd and stores rollouts under ~/.codex/sessions/<date>/
      // (not project-keyed), so there is nothing to relocate.
      await this.deps.stopChat(chatId);

      const worktreeDir = this.deps.db.settings.get('general', 'worktreeDir') ?? GENERAL_DEFAULTS.worktreeDir;
      const info = await createWorktree(project.path, worktreeDir, baseBranch, branchName);

      if (active.chat.adapterId === 'claude') {
        const oldProjectDir = getClaudeProjectDir(project.path);
        const newProjectDir = getClaudeProjectDir(info.worktreePath);
        await moveSessionFiles(active.chat.claudeSessionId, oldProjectDir, newProjectDir);
      }

      this.applyWorktreeUpdate(active, chatId, info.worktreePath, info.branchName);
      await this.deps.startChat(chatId);
      return;
    }

    // Pre-session path: kill any untracked process and create worktree
    await this.detachSession(active);

    const worktreeDir = this.deps.db.settings.get('general', 'worktreeDir') ?? GENERAL_DEFAULTS.worktreeDir;
    const info = await createWorktree(project.path, worktreeDir, baseBranch, branchName);
    this.applyWorktreeUpdate(active, chatId, info.worktreePath, info.branchName);
  }

  async attachWorktree(chatId: string, worktreePath: string, branchName: string): Promise<void> {
    const active = this.requireActiveChat(chatId);
    if (active.chat.worktreePath) return;

    if (active.chat.claudeSessionId) {
      // Mid-session path: stop, move session files to attached worktree, restart
      const project = this.deps.db.projects.get(active.chat.projectId);
      if (!project) throw new Error('Project not found');

      await this.deps.stopChat(chatId);

      if (active.chat.adapterId === 'claude') {
        const oldProjectDir = getClaudeProjectDir(project.path);
        const newProjectDir = getClaudeProjectDir(worktreePath);
        await moveSessionFiles(active.chat.claudeSessionId, oldProjectDir, newProjectDir);
      }

      this.applyWorktreeUpdate(active, chatId, worktreePath, branchName);
      await this.deps.startChat(chatId);
      return;
    }

    // Pre-session path
    await this.detachSession(active);
    this.applyWorktreeUpdate(active, chatId, worktreePath, branchName);
  }

  async disableWorktree(chatId: string): Promise<void> {
    const active = this.deps.getActiveChat(chatId);
    if (!active?.chat.worktreePath) return;
    if (active.chat.claudeSessionId) throw new Error('Cannot disable worktree after session has started');

    await this.detachSession(active);

    await this.deps.stopLaunchProcesses?.(active.chat.projectId, active.chat.worktreePath);

    const project = this.deps.db.projects.get(active.chat.projectId);
    if (project) await removeWorktree(project.path, active.chat.worktreePath, active.chat.branchName!);

    this.applyWorktreeUpdate(active, chatId, undefined, undefined);
  }
}
