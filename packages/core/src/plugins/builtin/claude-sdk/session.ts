import { nanoid } from 'nanoid';
import { query, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { mapSdkMessage } from './event-mapper.js';
import { PermissionBridge } from './permission-bridge.js';
import { getContextFilesForProject } from './context.js';
import { convertSessionMessages } from './history.js';
import { createChildLogger } from '../../../logger.js';
import { MAINFRAME_SYSTEM_PROMPT_APPEND } from '../claude/constants.js';
import type {
  AdapterProcess,
  AdapterSession,
  ChatMessage,
  ControlResponse,
  SessionOptions,
  SessionSink,
  SessionSpawnOptions,
} from '@qlan-ro/mainframe-types';

const logger = createChildLogger('claude-sdk-session');

function toSdkPermissionMode(mode?: string): string {
  if (mode === 'yolo') return 'bypassPermissions';
  return mode ?? 'default';
}

export class ClaudeSdkSession implements AdapterSession {
  readonly id = nanoid();
  readonly adapterId = 'claude-sdk';
  readonly projectPath: string;

  private chatId: string | undefined;
  private queryHandle: any | null = null; // TODO: type as Query from @anthropic-ai/claude-agent-sdk
  private loopRunning = false;
  private bridge: PermissionBridge | null = null;
  private sink: SessionSink | null = null;
  private spawned = false;
  private spawnOptions: SessionSpawnOptions = {};
  private onExit?: () => void;

  constructor(options: SessionOptions, onExit?: () => void) {
    this.projectPath = options.projectPath;
    this.chatId = options.chatId;
    this.onExit = onExit;
  }

  get isSpawned(): boolean {
    return this.spawned;
  }

  getProcessInfo(): AdapterProcess | null {
    if (!this.spawned) return null;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.chatId ?? this.id,
      pid: 0, // SDK manages the subprocess internally; no direct PID access
      status: this.loopRunning ? 'running' : 'stopped',
      projectPath: this.projectPath,
      model: this.spawnOptions.model,
    };
  }

  async spawn(options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> {
    this.spawnOptions = options ?? {};
    this.sink = sink ?? null;
    this.spawned = true;

    if (this.sink) {
      this.bridge = new PermissionBridge(this.sink);
    }

    return this.getProcessInfo()!;
  }

  async sendMessage(message: string, images?: { mediaType: string; data: string }[], _uuid?: string): Promise<void> {
    if (!this.sink) return;

    if (!this.queryHandle) {
      this.startQuery(message, images);
    } else {
      await this.streamFollowUp(message, images);
    }
  }

  async cancelQueuedMessage(_uuid: string): Promise<boolean> {
    return false;
  }

  private startQuery(message: string, images?: { mediaType: string; data: string }[]): void {
    if (images?.length) {
      logger.warn({ count: images.length }, 'Image attachments not yet supported by SDK adapter — images dropped');
    }

    const options: Record<string, any> = {
      cwd: this.projectPath,
      permissionMode: toSdkPermissionMode(this.spawnOptions.permissionMode),
      // Route all permission checks through our canUseTool bridge instead of SDK's built-in prompts
      allowDangerouslySkipPermissions: true,
      ...(this.spawnOptions.systemPrompt !== 'disabled' && {
        appendSystemPrompt: MAINFRAME_SYSTEM_PROMPT_APPEND,
      }),
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        CLAUDECODE: undefined,
      },
    };

    if (this.spawnOptions.model) {
      options.model = this.spawnOptions.model;
    }

    if (this.chatId) {
      options.resume = this.chatId;
    }

    if (this.bridge) {
      options.canUseTool = this.bridge.canUseTool.bind(this.bridge);
    }

    this.queryHandle = query({ prompt: message, options });
    this.runEventLoop();
  }

  private async streamFollowUp(message: string, images?: { mediaType: string; data: string }[]): Promise<void> {
    if (images?.length) {
      logger.warn({ count: images.length }, 'Image attachments not yet supported by SDK adapter — images dropped');
    }

    if (!this.queryHandle || !this.chatId) return;

    const userMessage = {
      type: 'user' as const,
      message: { role: 'user' as const, content: message },
      parent_tool_use_id: null,
      session_id: this.chatId,
    };

    async function* singleMessage() {
      yield userMessage;
    }

    try {
      await this.queryHandle.streamInput(singleMessage());
    } catch (err) {
      logger.error({ err }, 'Failed to stream follow-up message');
    }
  }

  private async runEventLoop(): Promise<void> {
    if (!this.queryHandle || !this.sink) return;
    this.loopRunning = true;

    try {
      for await (const msg of this.queryHandle) {
        mapSdkMessage(msg, this.sink);

        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          this.chatId = msg.session_id;
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        logger.error({ err }, 'SDK event loop error');
        this.sink.onError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.loopRunning = false;
      this.sink.onExit(0);
      this.onExit?.();
    }
  }

  async kill(): Promise<void> {
    this.bridge?.rejectAll();
    if (this.queryHandle) {
      this.queryHandle.close();
      this.queryHandle = null;
    }
    this.loopRunning = false;
    this.spawned = false;
  }

  async interrupt(): Promise<void> {
    if (this.queryHandle) {
      await this.queryHandle.interrupt();
    }
  }

  async respondToPermission(response: ControlResponse): Promise<void> {
    this.bridge?.resolve(response);
  }

  async setModel(model: string): Promise<void> {
    if (this.queryHandle) {
      await this.queryHandle.setModel(model);
    }
  }

  async setPermissionMode(mode: string): Promise<void> {
    if (this.queryHandle) {
      await this.queryHandle.setPermissionMode(toSdkPermissionMode(mode));
    }
  }

  async sendCommand(_command: string, _args?: string): Promise<void> {
    logger.warn('sendCommand not implemented for claude-sdk adapter');
  }

  getContextFiles(): { global: any[]; project: any[] } {
    return getContextFilesForProject(this.projectPath);
  }

  async loadHistory(): Promise<ChatMessage[]> {
    if (!this.chatId) return [];
    try {
      const messages = await getSessionMessages(this.chatId, { dir: this.projectPath });
      return convertSessionMessages(messages, this.chatId);
    } catch (err) {
      logger.warn({ err }, 'Failed to load session history via SDK');
      return [];
    }
  }

  async extractPlanFiles(): Promise<string[]> {
    return [];
  }

  async extractSkillFiles(): Promise<any[]> {
    return [];
  }
}
