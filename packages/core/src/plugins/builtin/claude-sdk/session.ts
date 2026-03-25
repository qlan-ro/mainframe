import { nanoid } from 'nanoid';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mapSdkMessage } from './event-mapper.js';
import { PermissionBridge } from './permission-bridge.js';
import { createChildLogger } from '../../../logger.js';
import type {
  AdapterProcess,
  AdapterSession,
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
  private activeQuery: any | null = null;
  private queryHandle: any | null = null;
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
      pid: process.pid,
      status: this.activeQuery ? 'running' : 'stopped',
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

  async sendMessage(message: string, images?: { mediaType: string; data: string }[]): Promise<void> {
    if (!this.sink) return;

    if (!this.activeQuery) {
      this.startQuery(message, images);
    } else {
      await this.streamFollowUp(message, images);
    }
  }

  private startQuery(message: string, _images?: { mediaType: string; data: string }[]): void {
    const options: Record<string, any> = {
      cwd: this.projectPath,
      permissionMode: toSdkPermissionMode(this.spawnOptions.permissionMode),
      allowDangerouslySkipPermissions: true,
      env: {
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

    this.activeQuery = query({ prompt: message, options });
    this.queryHandle = this.activeQuery;
    this.runEventLoop();
  }

  private async streamFollowUp(message: string, _images?: { mediaType: string; data: string }[]): Promise<void> {
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
    if (!this.activeQuery || !this.sink) return;

    try {
      for await (const msg of this.activeQuery) {
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
      this.activeQuery = null;
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
    this.activeQuery = null;
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
    return { global: [], project: [] };
  }

  async loadHistory(): Promise<any[]> {
    return [];
  }

  async extractPlanFiles(): Promise<string[]> {
    return [];
  }

  async extractSkillFiles(): Promise<any[]> {
    return [];
  }
}
