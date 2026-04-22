// packages/core/src/plugins/builtin/codex/session.ts
import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { nanoid } from 'nanoid';
import type {
  AdapterProcess,
  AdapterSession,
  SessionSpawnOptions,
  SessionOptions,
  SessionSink,
  ControlResponse,
  ChatMessage,
  ContextFile,
  SkillFileEntry,
} from '@qlan-ro/mainframe-types';
import { JsonRpcClient } from './jsonrpc.js';
import { handleNotification, type CodexSessionState } from './event-mapper.js';
import { ApprovalHandler } from './approval-handler.js';
import { convertThreadItems } from './history.js';
import type {
  InitializeResult,
  ThreadStartResult,
  ThreadResumeResult,
  TurnStartResult,
  ThreadReadResult,
  ApprovalPolicy,
  SandboxMode,
  CollaborationMode,
  UserInput,
} from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:session');

const HANDSHAKE_TIMEOUT_MS = 10_000;

const nullSink: SessionSink = {
  onInit: () => {},
  onMessage: () => {},
  onToolResult: () => {},
  onPermission: () => {},
  onResult: () => {},
  onExit: () => {},
  onError: () => {},
  onCompact: () => {},
  onCompactStart: () => {},
  onContextUsage: () => {},
  onPlanFile: () => {},
  onSkillFile: () => {},
  onQueuedProcessed: () => {},
  onTodoUpdate: () => {},
  onPrDetected: () => {},
};

export class CodexSession implements AdapterSession {
  readonly id: string;
  readonly adapterId = 'codex';
  readonly projectPath: string;

  private client: JsonRpcClient | null = null;
  private approvalHandler: ApprovalHandler | null = null;
  private sink: SessionSink = nullSink;
  private readonly onExitCallback: (() => void) | undefined;
  private readonly resumeThreadId: string | undefined;

  readonly state: CodexSessionState = { threadId: null, currentTurnId: null, currentTurnPlan: null };

  private pendingModel: string | undefined;
  private pendingPermissionMode: string = 'default';
  private pid = 0;
  private status: 'starting' | 'ready' | 'running' | 'stopped' | 'error' = 'starting';

  constructor(options: SessionOptions, onExit?: () => void) {
    this.id = nanoid();
    this.projectPath = options.projectPath;
    this.resumeThreadId = options.chatId;
    this.onExitCallback = onExit;
  }

  get isSpawned(): boolean {
    return this.client !== null;
  }

  getProcessInfo(): AdapterProcess | null {
    if (!this.client) return null;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.state.threadId ?? '',
      pid: this.pid,
      status: this.status,
      projectPath: this.projectPath,
      model: this.pendingModel,
    };
  }

  async spawn(options: SessionSpawnOptions = {}, sink?: SessionSink): Promise<AdapterProcess> {
    this.sink = sink ?? nullSink;
    this.pendingModel = options.model;
    this.pendingPermissionMode = options.permissionMode ?? 'default';

    try {
      accessSync(this.projectPath);
    } catch {
      throw new Error(`Project directory does not exist or is not accessible: ${this.projectPath}`);
    }

    const executable = options.executablePath || 'codex';
    const child = spawn(executable, ['app-server'], {
      cwd: this.projectPath,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    this.pid = child.pid || 0;
    this.status = 'starting';

    this.approvalHandler = new ApprovalHandler(this.sink);
    const approvalHandler = this.approvalHandler;

    this.client = new JsonRpcClient(child, {
      onNotification: (method, params) => handleNotification(method, params, this.sink, this.state),
      onRequest: (method, params, id) => {
        approvalHandler.handleRequest(method, params, id, (rpcId, result) => {
          this.client?.respond(rpcId, result);
        });
      },
      onError: (error) => this.sink.onError(new Error(error)),
      onExit: (code) => {
        this.status = 'stopped';
        this.client = null;
        this.sink.onExit(code);
        this.onExitCallback?.();
      },
    });

    // Perform initialize handshake
    const handshakeTimer = setTimeout(() => {
      log.error({ sessionId: this.id }, 'codex handshake timeout');
      this.sink.onError(new Error('handshake timeout'));
      this.client?.close();
    }, HANDSHAKE_TIMEOUT_MS);

    try {
      await this.client.request<InitializeResult>('initialize', {
        clientInfo: { name: 'mainframe', title: 'Mainframe', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      });
      this.client.notify('initialized');
      this.status = 'ready';
    } finally {
      clearTimeout(handshakeTimer);
    }

    log.info(
      { sessionId: this.id, projectPath: this.projectPath, model: options.model, resume: !!this.resumeThreadId },
      'codex session spawned',
    );

    // Fire onInit immediately so the UI transitions from 'starting' to 'idle'.
    // For Codex, thread/started only fires after thread/start (first message),
    // but the UI needs to know the session is ready after spawn.
    this.sink.onInit(this.id);

    return this.getProcessInfo()!;
  }

  async sendMessage(message: string, images?: { mediaType: string; data: string }[], _uuid?: string): Promise<void> {
    if (!this.client) throw new Error(`Session ${this.id} not spawned`);

    const input: UserInput[] = [];
    if (images?.length) {
      log.warn({ sessionId: this.id, count: images.length }, 'codex: image attachments not supported yet, skipping');
    }
    input.push({ type: 'text', text: message, text_elements: [] });

    // First message: start or resume thread
    if (!this.state.threadId) {
      if (this.resumeThreadId) {
        const resumeResult = await this.client.request<ThreadResumeResult>('thread/resume', {
          threadId: this.resumeThreadId,
          model: this.pendingModel,
          cwd: this.projectPath,
          persistExtendedHistory: true,
        });
        this.state.threadId = resumeResult.thread.id;
      } else {
        const { approvalPolicy, sandbox } = this.mapPermissionMode(this.pendingPermissionMode);
        const startResult = await this.client.request<ThreadStartResult>('thread/start', {
          model: this.pendingModel,
          cwd: this.projectPath,
          approvalPolicy,
          sandbox,
          experimentalRawEvents: true,
          persistExtendedHistory: true,
        });
        this.state.threadId = startResult.thread.id;
      }
      // Persist the real Codex thread ID immediately — don't rely on the
      // thread/started push notification which may arrive late or be lost.
      this.sink.onInit(this.state.threadId);
    }

    // Start turn
    const { approvalPolicy, sandbox } = this.mapPermissionMode(this.pendingPermissionMode);
    const collaborationMode = this.buildCollaborationMode();

    await this.client.request<TurnStartResult>('turn/start', {
      threadId: this.state.threadId,
      input,
      approvalPolicy,
      sandboxPolicy: this.mapSandboxPolicy(sandbox),
      collaborationMode,
      model: this.pendingModel,
    });

    this.status = 'running';
  }

  async cancelQueuedMessage(_uuid: string): Promise<boolean> {
    return false;
  }

  async kill(): Promise<void> {
    this.approvalHandler?.rejectAll();
    this.client?.close();
    this.client = null;
  }

  async interrupt(): Promise<void> {
    if (!this.client || !this.state.threadId || !this.state.currentTurnId) return;
    await this.client.request('turn/interrupt', {
      threadId: this.state.threadId,
      turnId: this.state.currentTurnId,
    });
  }

  async respondToPermission(response: ControlResponse): Promise<void> {
    this.approvalHandler?.resolve(response);
  }

  async setModel(model: string): Promise<void> {
    this.pendingModel = model;
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.pendingPermissionMode = mode;
  }

  async sendCommand(_command: string, _args?: string): Promise<void> {
    // TODO: investigate Codex skills/apps as potential equivalents to Claude slash commands
    log.warn({ sessionId: this.id }, 'codex: sendCommand not supported');
  }

  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    // TODO: implement — read Codex-equivalent context files
    return { global: [], project: [] };
  }

  async loadHistory(): Promise<ChatMessage[]> {
    if (!this.resumeThreadId) return [];

    // Spawn a temporary app-server to read history
    const { spawn: spawnProcess } = await import('node:child_process');
    const child = spawnProcess('codex', ['app-server'], {
      cwd: this.projectPath,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const tempClient = new JsonRpcClient(child, {
      onNotification: () => {},
      onRequest: () => {},
      onError: () => {},
      onExit: () => {},
    });

    try {
      await tempClient.request('initialize', {
        clientInfo: { name: 'mainframe', title: 'Mainframe', version: '1.0.0' },
      });
      tempClient.notify('initialized');

      const result = await tempClient.request<ThreadReadResult>('thread/read', {
        threadId: this.resumeThreadId,
        includeTurns: true,
      });

      const allItems = result.thread.turns?.flatMap((t) => t.items) ?? [];
      return convertThreadItems(allItems, this.resumeThreadId);
    } catch (err) {
      log.warn({ err, threadId: this.resumeThreadId }, 'codex: failed to load history');
      return [];
    } finally {
      tempClient.close();
    }
  }

  async extractPlanFiles(): Promise<string[]> {
    // TODO: implement
    return [];
  }

  async extractSkillFiles(): Promise<SkillFileEntry[]> {
    // TODO: implement
    return [];
  }

  private mapPermissionMode(mode: string): { approvalPolicy: ApprovalPolicy; sandbox: SandboxMode } {
    if (mode === 'yolo') {
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    }
    return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  }

  private mapSandboxPolicy(sandbox: SandboxMode): { type: string } {
    switch (sandbox) {
      case 'danger-full-access':
        return { type: 'dangerFullAccess' };
      case 'read-only':
        return { type: 'readOnly' };
      case 'workspace-write':
      default:
        return { type: 'workspaceWrite' };
    }
  }

  private buildCollaborationMode(): CollaborationMode {
    const mode = this.pendingPermissionMode === 'plan' ? 'plan' : 'default';
    return {
      mode,
      settings: {
        model: this.pendingModel ?? '',
        reasoning_effort: null,
        developer_instructions: null,
      },
    };
  }
}
