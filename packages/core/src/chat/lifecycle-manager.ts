import type { Chat, DaemonEvent, SessionSink, ControlResponse } from '@qlan-ro/mainframe-types';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import type { DatabaseManager } from '../db/index.js';
import { removeWorktree } from '../workspace/index.js';
import { existsSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);
import { createChildLogger } from '../logger.js';
import { generateTitle } from './title-generator.js';
import { extractMentionsFromText } from './context-tracker.js';
import { extractPrFromToolResult, PR_CREATE_COMMANDS } from '../plugins/builtin/claude/events.js';
import type { MessageCache } from './message-cache.js';
import type { PermissionManager } from './permission-manager.js';
import type { ActiveChat } from './types.js';

const log = createChildLogger('chat:lifecycle');

export interface LifecycleManagerDeps {
  db: DatabaseManager;
  adapters: AdapterRegistry;
  attachmentStore?: AttachmentStore;
  activeChats: Map<string, ActiveChat>;
  messages: MessageCache;
  permissions: PermissionManager;
  emitEvent: (event: DaemonEvent) => void;
  buildSink: (chatId: string, respondToPermission: (response: ControlResponse) => Promise<void>) => SessionSink;
  /** Stop launch processes for a project+path pair (e.g. before worktree removal) */
  stopLaunchProcesses?: (projectId: string, projectPath: string) => Promise<void>;
}

export class ChatLifecycleManager {
  private loadingChats = new Map<string, Promise<void>>();
  private startingChats = new Map<string, Promise<void>>();
  private interruptingChats = new Map<string, Promise<void>>();

  constructor(private deps: LifecycleManagerDeps) {}

  setStopLaunchProcesses(fn: (projectId: string, projectPath: string) => Promise<void>): void {
    this.deps.stopLaunchProcesses = fn;
  }

  /** Expose startingChats for ConfigManager's inflight check */
  getStartingChats(): Map<string, Promise<void>> {
    return this.startingChats;
  }

  /** Expose loadingChats for getMessages' inflight check */
  getLoadingChats(): Map<string, Promise<void>> {
    return this.loadingChats;
  }

  async createChat(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: string,
    worktreePath?: string,
    branchName?: string,
  ): Promise<Chat> {
    const chat = this.deps.db.chats.create(projectId, adapterId, model, permissionMode);
    if (worktreePath && branchName) {
      this.deps.db.chats.update(chat.id, { worktreePath, branchName });
      chat.worktreePath = worktreePath;
      chat.branchName = branchName;
    }
    log.info({ chatId: chat.id, projectId, adapterId, worktreePath }, 'chat created');
    this.deps.activeChats.set(chat.id, { chat, session: null });
    this.deps.emitEvent({ type: 'chat.created', chat });
    return chat;
  }

  async createChatWithDefaults(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: string,
    worktreePath?: string,
    branchName?: string,
  ): Promise<Chat> {
    let effectiveModel = model;
    let effectiveMode = permissionMode;

    if (!effectiveModel || !effectiveMode) {
      const defaultModel = this.deps.db.settings.get('provider', `${adapterId}.defaultModel`);
      const defaultMode = this.deps.db.settings.get('provider', `${adapterId}.defaultMode`);

      if (!effectiveModel && defaultModel) effectiveModel = defaultModel;
      if (!effectiveMode && defaultMode) effectiveMode = defaultMode;
    }

    return this.createChat(projectId, adapterId, effectiveModel, effectiveMode, worktreePath, branchName);
  }

  async resumeChat(chatId: string): Promise<void> {
    await this.loadChat(chatId);

    const chat = this.deps.activeChats.get(chatId)?.chat ?? this.deps.db.chats.get(chatId);
    if (!chat) return;

    if (chat.processState === 'working') {
      if (chat.permissionMode === 'yolo') {
        await this.startChat(chatId);
      } else if (!this.deps.permissions.hasPending(chatId)) {
        await this.startChat(chatId);
      }
    }

    // Always push current state to the just-(re)subscribed client so it can
    // recover displayStatus/isRunning after a project switch.
    this.deps.emitEvent({ type: 'chat.updated', chat });

    // Restore todo checklist state for the UI
    const todos = chat.todos;
    if (todos) {
      this.deps.emitEvent({ type: 'todos.updated', chatId, todos });
    }
  }

  async loadChat(chatId: string): Promise<void> {
    const inflight = this.loadingChats.get(chatId);
    if (inflight) return inflight;
    if (this.deps.activeChats.has(chatId)) return;

    const promise = this.doLoadChat(chatId);
    this.loadingChats.set(chatId, promise);
    try {
      await promise;
    } finally {
      this.loadingChats.delete(chatId);
    }
  }

  async startChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (active?.session?.isSpawned) {
      this.deps.emitEvent({ type: 'process.started', chatId, process: active.session.getProcessInfo()! });
      return;
    }

    const inflight = this.startingChats.get(chatId);
    if (inflight) return inflight;

    const promise = this.doStartChat(chatId);
    this.startingChats.set(chatId, promise);
    try {
      await promise;
    } finally {
      this.startingChats.delete(chatId);
    }
  }

  async interruptChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (!active?.session?.isSpawned) return;

    this.deps.permissions.clear(chatId);
    this.deps.permissions.markInterrupted(chatId);

    // SIGINT causes the CLI to exit. Track the exit so sendMessage can wait
    // for it before respawning — without this, a fast follow-up message would
    // write to the dying process's stdin and be silently lost.
    if (!this.interruptingChats.has(chatId)) {
      this.interruptingChats.set(
        chatId,
        new Promise<void>((resolve) => {
          const poll = setInterval(() => {
            if (!active.session?.isSpawned) {
              clearInterval(poll);
              this.interruptingChats.delete(chatId);
              resolve();
            }
          }, 50);
          // Safety: don't block forever if something goes wrong
          setTimeout(() => {
            clearInterval(poll);
            this.interruptingChats.delete(chatId);
            resolve();
          }, 5000);
        }),
      );
    }

    await active.session.interrupt();
  }

  /** Wait for any in-flight interrupt to finish (process exit). */
  async waitForInterrupt(chatId: string): Promise<void> {
    const pending = this.interruptingChats.get(chatId);
    if (pending) await pending;
  }

  async archiveChat(chatId: string, deleteWorktree = true): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (active?.session) {
      await active.session.kill();
    }

    const chat = active?.chat ?? this.deps.db.chats.get(chatId);
    if (deleteWorktree && chat?.worktreePath && chat?.branchName) {
      await this.deps.stopLaunchProcesses?.(chat.projectId, chat.worktreePath);
      const project = this.deps.db.projects.get(chat.projectId);
      if (project) removeWorktree(project.path, chat.worktreePath, chat.branchName);
    }

    this.deps.activeChats.delete(chatId);
    this.deps.messages.delete(chatId);
    this.deps.permissions.clear(chatId);
    await this.deps.attachmentStore?.deleteChat(chatId);
    this.deps.db.chats.update(chatId, { status: 'archived' });
    log.info({ chatId }, 'chat archived');
    this.deps.emitEvent({ type: 'chat.ended', chatId });
  }

  /** Stop a running session without ending the chat. Used for mid-session reconfiguration. */
  async stopChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (!active?.session) return;

    if (active.session.isSpawned) {
      await active.session.kill();
    }
    active.session = null;
  }

  async endChat(chatId: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (!active) return;

    if (active.session) {
      await active.session.kill();
    }

    this.deps.db.chats.update(chatId, { status: 'ended' });
    this.deps.activeChats.delete(chatId);
    this.deps.emitEvent({ type: 'chat.ended', chatId });
  }

  private async isWorkingTreeDirty(projectPath: string): Promise<boolean> {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    return stdout.trim().length > 0;
  }

  async forkToWorktree(
    chatId: string,
    baseBranch: string,
    branchName: string,
    enableWorktreeFn: (chatId: string, baseBranch: string, branchName: string) => Promise<void>,
  ): Promise<{ chatId: string }> {
    const sourceActive = this.deps.activeChats.get(chatId);
    const sourceChat = sourceActive?.chat ?? this.deps.db.chats.get(chatId);
    if (!sourceChat) throw new Error(`Chat ${chatId} not found`);

    const project = this.deps.db.projects.get(sourceChat.projectId);
    if (!project) throw new Error('Project not found');

    if (await this.isWorkingTreeDirty(project.path)) {
      const err = new Error('Commit or stash your changes before forking');
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }

    const newChat = await this.createChat(
      sourceChat.projectId,
      sourceChat.adapterId,
      sourceChat.model,
      sourceChat.permissionMode,
    );
    await enableWorktreeFn(newChat.id, baseBranch, branchName);
    return { chatId: newChat.id };
  }

  async doGenerateTitle(chatId: string, content: string): Promise<void> {
    const active = this.deps.activeChats.get(chatId);
    if (!active) return;

    const disabled = this.deps.db.settings.get('general', 'titleGeneration.disabled');
    if (disabled === 'true') return;

    const adapterId = active.chat.adapterId;
    const binary = this.deps.db.settings.get('provider', `${adapterId}.titleBinary`) || 'claude';

    try {
      const title = await generateTitle(content, binary);
      if (title) {
        active.chat.title = title;
        this.deps.db.chats.update(chatId, { title });
        this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
      }
    } catch (err) {
      log.warn({ err }, 'Title generation failed');
    }
  }

  private async doLoadChat(chatId: string): Promise<void> {
    const chat = this.deps.db.chats.get(chatId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);
    this.deps.activeChats.set(chatId, { chat, session: null });

    const adapter = this.deps.adapters.get(chat.adapterId);
    if (!adapter) return;

    const project = this.deps.db.projects.get(chat.projectId);
    if (!project) return;

    const effectivePath = chat.worktreePath ?? project.path;

    if (chat.worktreePath && !existsSync(chat.worktreePath)) {
      return;
    }

    if (chat.claudeSessionId) {
      const session = adapter.createSession({ projectPath: effectivePath, chatId: chat.claudeSessionId });
      const active = this.deps.activeChats.get(chatId)!;
      active.session = session;

      try {
        const history = await session.loadHistory();
        // loadHistory embeds the Claude sessionId as chatId — remap to Mainframe chatId
        const remapped = history.map((msg) => ({ ...msg, chatId }));
        if (remapped.length > 0) {
          this.deps.messages.set(chatId, remapped);
          this.deps.permissions.restorePendingPermission(chatId, remapped);
        }
      } catch {
        // Best-effort
      }

      const cached = this.deps.messages.get(chatId);
      if (cached) {
        for (const msg of cached) {
          if (msg.type !== 'user') continue;
          for (const block of msg.content) {
            if (block.type !== 'text') continue;
            const text = (block as { text: string }).text;
            // Skip command/skill injections — they contain example @-patterns
            if (/<mainframe-command|<command-name>/.test(text)) continue;
            extractMentionsFromText(chatId, text, this.deps.db);
          }
        }

        // Scan history for PR URLs with command-level correlation.
        // Walk messages in order: assistant tool_use blocks identify PR-create
        // commands; subsequent tool_result blocks with PR URLs are classified.
        const seenPrs = new Set<string>();
        const pendingCreates = new Set<string>();
        for (const msg of cached) {
          if (msg.type === 'assistant') {
            for (const block of msg.content) {
              if (block.type === 'tool_use') {
                const name = (block as Record<string, unknown>).name as string | undefined;
                if (name === 'Bash' || name === 'BashTool') {
                  const input = (block as Record<string, unknown>).input as { command?: string } | undefined;
                  if (input?.command && PR_CREATE_COMMANDS.some((re) => re.test(input.command!))) {
                    pendingCreates.add((block as Record<string, unknown>).id as string);
                  }
                }
              }
            }
          }
          if (msg.type !== 'tool_result') continue;
          for (const block of msg.content) {
            if (block.type !== 'tool_result') continue;
            const text = typeof block.content === 'string' ? block.content : '';
            const pr = extractPrFromToolResult(text);
            if (!pr) continue;
            const key = `${pr.owner}/${pr.repo}/${pr.number}`;
            if (seenPrs.has(key)) continue;
            seenPrs.add(key);
            const toolUseId = (block as Record<string, unknown>).toolUseId as string | undefined;
            const source = toolUseId && pendingCreates.has(toolUseId) ? ('created' as const) : ('mentioned' as const);
            if (source === 'created') pendingCreates.delete(toolUseId!);
            this.deps.emitEvent({ type: 'chat.prDetected', chatId, pr: { ...pr, source } });
          }
        }
      }

      try {
        const [planPaths, skillPaths] = await Promise.all([session.extractPlanFiles(), session.extractSkillFiles()]);
        for (const p of planPaths) this.deps.db.chats.addPlanFile(chatId, p);
        for (const p of skillPaths) this.deps.db.chats.addSkillFile(chatId, p);
      } catch {
        /* best-effort */
      }
    }
  }

  private async doStartChat(chatId: string): Promise<void> {
    await this.loadChat(chatId);

    const active = this.deps.activeChats.get(chatId);
    if (!active) throw new Error(`Chat ${chatId} not found after load`);

    if (active.session?.isSpawned) {
      this.deps.emitEvent({ type: 'process.started', chatId, process: active.session.getProcessInfo()! });
      return;
    }

    const { chat } = active;

    if (chat.worktreePath && !existsSync(chat.worktreePath)) {
      throw new Error(`Worktree directory does not exist: ${chat.worktreePath}`);
    }

    const adapter = this.deps.adapters.get(chat.adapterId);
    if (!adapter) throw new Error(`Adapter ${chat.adapterId} not found`);

    const project = this.deps.db.projects.get(chat.projectId);
    if (!project) throw new Error(`Project ${chat.projectId} not found`);

    const session = adapter.createSession({
      projectPath: chat.worktreePath ?? project.path,
      chatId: chat.claudeSessionId,
    });
    active.session = session;

    const sink = this.deps.buildSink(chatId, (response) => session.respondToPermission(response));

    const executablePath = this.deps.db.settings.get('provider', `${chat.adapterId}.executablePath`) ?? undefined;
    const systemPrompt = this.deps.db.settings.get('provider', `${chat.adapterId}.systemPrompt`) ?? undefined;
    const processInfo = await session.spawn(
      {
        model: chat.model,
        permissionMode: chat.permissionMode,
        executablePath,
        systemPrompt,
        effort: chat.effort,
      },
      sink,
    );
    log.info({ chatId }, 'chat session started');
    this.deps.emitEvent({ type: 'process.started', chatId, process: processInfo });
  }
}
