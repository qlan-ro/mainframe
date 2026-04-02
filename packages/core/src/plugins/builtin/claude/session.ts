import { spawn } from 'node:child_process';
import { existsSync, readFileSync, accessSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ChildProcess } from 'node:child_process';
import type {
  AdapterProcess,
  AdapterSession,
  SessionSpawnOptions,
  SessionOptions,
  SessionSink,
  ControlResponse,
  ControlUpdate,
  ChatMessage,
  ContextFile,
  SkillFileEntry,
} from '@qlan-ro/mainframe-types';
import { handleStdout, handleStderr } from './events.js';
import { createChildLogger } from '../../../logger.js';
import {
  loadHistory as loadHistoryFromDisk,
  extractPlanFilePaths as extractPlans,
  extractSkillFilePaths as extractSkills,
} from './history.js';

const log = createChildLogger('claude:session');

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
};

export interface ClaudeSessionState {
  chatId: string;
  buffer: string;
  lastAssistantUsage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  child: ChildProcess | null;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
  pid: number;
  activeTasks: Map<string, { type: string; command?: string }>;
}

/**
 * The CLI's permission_suggestions always use destination:"session" (in-memory only).
 * The terminal CLI's "Always Allow" button changes destinations to "localSettings"
 * before applying them. This function does the same: promotes every session-scoped
 * suggestion to localSettings so the CLI persists the rule AND updates in-memory state.
 */
export function promoteToLocalSettings(updates: ControlUpdate[]): ControlUpdate[] {
  return updates.map((u) => (u.destination === 'session' ? { ...u, destination: 'localSettings' as const } : u));
}

export class ClaudeSession implements AdapterSession {
  readonly id: string;
  readonly adapterId = 'claude';
  readonly projectPath: string;

  /** Mutable internal state — readable by claude-events.ts and tests. */
  readonly state: ClaudeSessionState;

  private readonly resumeSessionId: string | undefined;
  private readonly onExit: (() => void) | undefined;

  constructor(options: SessionOptions, onExit?: () => void) {
    this.id = nanoid();
    this.projectPath = options.projectPath;
    this.resumeSessionId = options.chatId;
    this.onExit = onExit;
    this.state = {
      chatId: options.chatId ?? '',
      buffer: '',
      child: null,
      status: 'starting',
      pid: 0,
      activeTasks: new Map(),
    };
  }

  get isSpawned(): boolean {
    return this.state.child !== null;
  }

  getProcessInfo(): AdapterProcess | null {
    if (!this.state.child) return null;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.state.chatId,
      pid: this.state.pid,
      status: this.state.status,
      projectPath: this.projectPath,
    };
  }

  async spawn(options: SessionSpawnOptions = {}, sink?: SessionSink): Promise<AdapterProcess> {
    const activeSink = sink ?? nullSink;

    const args = [
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
    ];

    if (this.resumeSessionId) args.push('--resume', this.resumeSessionId);
    if (options.model) args.push('--model', options.model);
    const cliMode = options.permissionMode === 'yolo' ? 'bypassPermissions' : (options.permissionMode ?? 'default');
    args.push('--permission-mode', cliMode, '--allow-dangerously-skip-permissions');

    const executable = options.executablePath || 'claude';
    try {
      accessSync(this.projectPath);
    } catch {
      throw new Error(`Project directory does not exist or is not accessible: ${this.projectPath}`);
    }
    const child = spawn(executable, args, {
      cwd: this.projectPath,
      shell: process.platform === 'win32',
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        // Unset CLAUDECODE so the child Claude CLI doesn't refuse to start
        // when the daemon itself runs inside a Claude Code session.
        CLAUDECODE: undefined,
      },
    });

    this.state.child = child;
    this.state.pid = child.pid || 0;
    this.state.status = 'starting';

    log.debug(
      {
        sessionId: this.id,
        projectPath: this.projectPath,
        resume: !!this.resumeSessionId,
        model: options.model ?? 'default',
        permissionMode: options.permissionMode ?? 'default',
      },
      'claude session spawned',
    );

    child.stdout?.on('data', (chunk) => handleStdout(this, chunk, activeSink));
    child.stderr?.on('data', (chunk) => handleStderr(this, chunk, activeSink));
    child.on('error', (error: Error) => {
      log.error({ sessionId: this.id, err: error }, 'claude process error');
      activeSink.onError(error);
    });
    child.on('close', (code: number | null) => {
      this.state.child = null;
      activeSink.onExit(code);
      this.onExit?.();
    });

    return this.getProcessInfo()!;
  }

  async kill(): Promise<void> {
    const child = this.state.child;
    if (child) {
      log.debug({ sessionId: this.id }, 'claude session killed');
      child.kill('SIGTERM');
      this.state.child = null;
    }
  }

  async interrupt(): Promise<void> {
    const child = this.state.child;
    if (!child) return;
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');

    for (const [taskId] of this.state.activeTasks) {
      const stopPayload = {
        type: 'control_request',
        request_id: crypto.randomUUID(),
        request: { subtype: 'stop_task', task_id: taskId },
      };
      child.stdin?.write(JSON.stringify(stopPayload) + '\n');
    }
    this.state.activeTasks.clear();

    // Also send SIGINT: the CLI's stdin message loop blocks while background
    // agents are running (agent-wait loop), so the protocol interrupt above
    // may sit unread in the buffer. SIGINT triggers the CLI's signal handler
    // which calls abort() on the current turn's AbortController directly.
    child.kill('SIGINT');
  }

  requestContextUsage(): void {
    const child = this.state.child;
    if (!child) return;
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'get_context_usage' },
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  async setPermissionMode(mode: string): Promise<void> {
    const child = this.state.child;
    if (!child) throw new Error(`Session ${this.id} not spawned`);
    const cliMode = mode === 'yolo' ? 'bypassPermissions' : mode;
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'set_permission_mode', mode: cliMode },
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  async setModel(model: string): Promise<void> {
    const child = this.state.child;
    if (!child) throw new Error(`Session ${this.id} not spawned`);
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'set_model', model },
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  async sendCommand(command: string, args = ''): Promise<void> {
    const child = this.state.child;
    if (!child) throw new Error(`Session ${this.id} not spawned`);
    const text = `<command-name>/${command}</command-name>\n<command-message>${command}</command-message>\n<command-args>${args}</command-args>`;
    const payload = {
      type: 'user',
      session_id: this.state.chatId,
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  async sendMessage(message: string, images?: { mediaType: string; data: string }[]): Promise<void> {
    const child = this.state.child;
    if (!child) throw new Error(`Session ${this.id} not spawned`);
    const content: Record<string, unknown>[] = [];
    if (images?.length) {
      for (const img of images) {
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      }
    }
    if (message || content.length === 0) {
      content.push({ type: 'text', text: message });
    }
    const payload = {
      type: 'user',
      session_id: this.state.chatId,
      message: { role: 'user', content },
      parent_tool_use_id: null,
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  async respondToPermission(response: ControlResponse): Promise<void> {
    const innerResponse: Record<string, unknown> = {
      behavior: response.behavior,
      toolUseID: response.toolUseId,
    };

    if (response.behavior === 'allow') {
      if (response.updatedInput) innerResponse.updatedInput = response.updatedInput;
      if (response.updatedPermissions) {
        innerResponse.updatedPermissions = promoteToLocalSettings(response.updatedPermissions);
      }
    } else {
      if (response.toolName === 'ExitPlanMode') {
        const preamble =
          "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";
        innerResponse.message = response.message
          ? `${preamble} To tell you how to proceed, the user said:\n${response.message}`
          : `${preamble} The user rejected the plan. Stay in plan mode and wait for new instructions from the user.`;
      } else {
        innerResponse.message =
          response.message ||
          (response.toolName === 'AskUserQuestion' ? 'User skipped the question' : 'User denied permission');
      }
      if (response.toolName !== 'AskUserQuestion' && response.toolName !== 'ExitPlanMode') {
        innerResponse.interrupt = true;
      }
    }

    const payload = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: response.requestId,
        response: innerResponse,
      },
    };

    const json = JSON.stringify(payload);
    const stdin = this.state.child?.stdin;
    if (!stdin || stdin.destroyed) {
      log.error(
        { sessionId: this.id, requestId: response.requestId, toolName: response.toolName },
        'respondToPermission: stdin unavailable, response dropped',
      );
      return;
    }
    log.info(
      {
        sessionId: this.id,
        requestId: response.requestId,
        toolName: response.toolName,
        behavior: response.behavior,
        payload: json,
      },
      'writing permission response to stdin',
    );
    stdin.write(json + '\n');
  }

  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    const globalDir = path.join(homedir(), '.claude');
    const global: ContextFile[] = [];
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const p = path.join(globalDir, name);
      if (existsSync(p)) {
        try {
          global.push({ path: name, content: readFileSync(p, 'utf-8'), source: 'global' });
        } catch {
          /* expected */
        }
      }
    }
    const project: ContextFile[] = [];
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      // Check both project root and .claude/ subdirectory
      for (const dir of [this.projectPath, path.join(this.projectPath, '.claude')]) {
        const p = path.join(dir, name);
        if (existsSync(p)) {
          try {
            const relPath = path.relative(this.projectPath, p);
            project.push({ path: relPath, content: readFileSync(p, 'utf-8'), source: 'project' });
          } catch {
            /* expected */
          }
        }
      }
    }
    return { global, project };
  }

  async loadHistory(): Promise<ChatMessage[]> {
    if (!this.resumeSessionId) return [];
    return loadHistoryFromDisk(this.resumeSessionId, this.projectPath);
  }

  async extractPlanFiles(): Promise<string[]> {
    if (!this.resumeSessionId) return [];
    return extractPlans(this.resumeSessionId, this.projectPath);
  }

  async extractSkillFiles(): Promise<SkillFileEntry[]> {
    if (!this.resumeSessionId) return [];
    return extractSkills(this.resumeSessionId, this.projectPath);
  }
}
