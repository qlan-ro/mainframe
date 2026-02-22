import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ChildProcess } from 'node:child_process';
import type {
  AdapterProcess,
  SessionSpawnOptions,
  SessionOptions,
  PermissionResponse,
  ChatMessage,
  ContextFile,
  SkillFileEntry,
} from '@mainframe/types';
import { BaseSession } from '../../../adapters/base-session.js';
import { handleStdout, handleStderr } from './events.js';
import { createChildLogger } from '../../../logger.js';
import {
  loadHistory as loadHistoryFromDisk,
  extractPlanFilePaths as extractPlans,
  extractSkillFilePaths as extractSkills,
} from './history.js';
import type { ToolCategories } from '../../../messages/tool-categorization.js';

const log = createChildLogger('claude-session');

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
}

export class ClaudeSession extends BaseSession {
  readonly id: string;
  readonly adapterId = 'claude';
  readonly projectPath: string;

  /** Mutable internal state — readable by claude-events.ts and tests. */
  readonly state: ClaudeSessionState;

  private readonly resumeSessionId: string | undefined;

  constructor(options: SessionOptions) {
    super();
    this.id = nanoid();
    this.projectPath = options.projectPath;
    this.resumeSessionId = options.chatId;
    this.state = {
      chatId: options.chatId ?? '',
      buffer: '',
      child: null,
      status: 'starting',
      pid: 0,
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

  override getToolCategories(): ToolCategories {
    return {
      explore: new Set(['Read', 'Glob', 'Grep']),
      hidden: new Set([
        'TaskList',
        'TaskGet',
        'TaskOutput',
        'TaskStop',
        'TodoWrite',
        'Skill',
        'EnterPlanMode',
        'AskUserQuestion',
      ]),
      progress: new Set(['TaskCreate', 'TaskUpdate']),
      subagent: new Set(['Task']),
    };
  }

  async spawn(options: SessionSpawnOptions = {}): Promise<AdapterProcess> {
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
    if (options.permissionMode === 'plan') {
      args.push('--permission-mode', 'plan');
    } else if (options.permissionMode === 'acceptEdits') {
      args.push('--permission-mode', 'acceptEdits');
    } else if (options.permissionMode === 'yolo') {
      args.push('--dangerously-skip-permissions');
    }

    const child = spawn('claude', args, {
      cwd: this.projectPath,
      shell: process.platform === 'win32',
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
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

    child.stdout?.on('data', (chunk) => handleStdout(this, chunk));
    child.stderr?.on('data', (chunk) => handleStderr(this, chunk));
    child.on('error', (error) => {
      log.error({ sessionId: this.id, err: error }, 'claude process error');
      this.emit('error', error);
    });
    child.on('close', (code) => {
      this.state.child = null;
      this.emit('exit', code);
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

  override async interrupt(): Promise<void> {
    const child = this.state.child;
    if (!child) return;
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  override async setPermissionMode(mode: string): Promise<void> {
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

  override async setModel(model: string): Promise<void> {
    const child = this.state.child;
    if (!child) throw new Error(`Session ${this.id} not spawned`);
    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'set_model', model },
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  override async sendCommand(command: string, args = ''): Promise<void> {
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

  override async sendMessage(message: string, images?: { mediaType: string; data: string }[]): Promise<void> {
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

  override async respondToPermission(response: PermissionResponse): Promise<void> {
    const innerResponse: Record<string, unknown> = {
      behavior: response.behavior,
      toolUseID: response.toolUseId,
    };

    if (response.behavior === 'allow') {
      if (response.updatedInput) innerResponse.updatedInput = response.updatedInput;
      if (response.updatedPermissions) innerResponse.updatedPermissions = response.updatedPermissions;
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

  override getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
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
      const p = path.join(this.projectPath, name);
      if (existsSync(p)) {
        try {
          project.push({ path: name, content: readFileSync(p, 'utf-8'), source: 'project' });
        } catch {
          /* expected */
        }
      }
    }
    return { global, project };
  }

  override async loadHistory(): Promise<ChatMessage[]> {
    if (!this.resumeSessionId) return [];
    return loadHistoryFromDisk(this.resumeSessionId, this.projectPath);
  }

  override async extractPlanFiles(): Promise<string[]> {
    if (!this.resumeSessionId) return [];
    return extractPlans(this.resumeSessionId, this.projectPath);
  }

  override async extractSkillFiles(): Promise<SkillFileEntry[]> {
    if (!this.resumeSessionId) return [];
    return extractSkills(this.resumeSessionId, this.projectPath);
  }
}
