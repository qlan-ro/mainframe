import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  AdapterProcess,
  SpawnOptions,
  PermissionResponse,
  ChatMessage,
  ContextFile,
  Skill,
  AgentConfig,
  CreateSkillInput,
  CreateAgentInput,
  SkillFileEntry,
  AdapterModel,
} from '@mainframe/types';
import { BaseAdapter } from './base.js';
import type { ClaudeProcess } from './claude-types.js';
import { handleStdout, handleStderr } from './claude-events.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('claude-adapter');
import {
  loadHistory as loadHistoryFromDisk,
  extractPlanFilePaths as extractPlans,
  extractSkillFilePaths as extractSkills,
} from './claude-history.js';
import * as skills from './claude-skills.js';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const CLAUDE_MODELS: AdapterModel[] = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
];

export class ClaudeAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Claude CLI';

  private processes = new Map<string, ClaudeProcess>();

  private getProcessFromCacheOrThrow(processId: string): ClaudeProcess {
    const cp = this.processes.get(processId);
    if (!cp) throw new Error(`Process ${processId} not found`);
    return cp;
  }

  // TODO we might need to support user provided path instead of relying it's added to $PATH
  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { shell: true });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }

  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { shell: true });
      let output = '';
      child.stdout?.on('data', (chunk) => (output += chunk.toString()));
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code === 0) {
          const match = output.match(/(\d+\.\d+\.\d+)/);
          resolve(match?.[1] ?? output.trim());
        } else {
          resolve(null);
        }
      });
    });
  }

  override async listModels(): Promise<AdapterModel[]> {
    return CLAUDE_MODELS;
  }

  async spawn(options: SpawnOptions): Promise<AdapterProcess> {
    const processId = nanoid();

    const args = [
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
    ];

    if (options.chatId) {
      args.push('--resume', options.chatId);
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.permissionMode === 'plan') {
      args.push('--permission-mode', 'plan');
    } else if (options.permissionMode === 'acceptEdits') {
      args.push('--permission-mode', 'acceptEdits');
    } else if (options.permissionMode === 'yolo') {
      args.push('--dangerously-skip-permissions');
    }

    const child = spawn('claude', args, {
      cwd: options.projectPath,
      shell: process.platform === 'win32',
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    const adapterProcess: ClaudeProcess = {
      id: processId,
      adapterId: this.id,
      chatId: '',
      pid: child.pid || 0,
      status: 'starting',
      projectPath: options.projectPath,
      model: options.model,
      child,
      buffer: '',
    };

    this.processes.set(processId, adapterProcess);
    log.debug(
      {
        processId,
        projectPath: options.projectPath,
        resume: !!options.chatId,
        model: options.model ?? 'default',
        permissionMode: options.permissionMode ?? 'default',
      },
      'claude process spawned',
    );

    child.stdout?.on('data', (chunk) => handleStdout(processId, chunk, this.processes, this));
    child.stderr?.on('data', (chunk) => handleStderr(processId, chunk, this));
    child.on('error', (error) => {
      log.error({ processId, err: error }, 'claude process error');
      this.emit('error', processId, error);
    });
    child.on('close', (code) => {
      this.processes.delete(processId);
      this.emit('exit', processId, code);
    });

    return adapterProcess;
  }

  async kill(process: AdapterProcess): Promise<void> {
    const cp = this.processes.get(process.id);
    if (cp) {
      log.debug({ processId: process.id }, 'claude process killed');
      cp.child.kill('SIGTERM');
      this.processes.delete(process.id);
    }
  }

  override async interrupt(process: AdapterProcess): Promise<void> {
    const cp = this.processes.get(process.id);
    if (!cp) return;

    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    };

    cp.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  override async setPermissionMode(process: AdapterProcess, mode: string): Promise<void> {
    const cp = this.getProcessFromCacheOrThrow(process.id);

    const cliMode = mode === 'yolo' ? 'bypassPermissions' : mode;
    // TODO here we should map agnostic mode from mainframe core to claude code specific modes. Not only for yolo

    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'set_permission_mode', mode: cliMode },
    };

    cp.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  override async setModel(process: AdapterProcess, model: string): Promise<void> {
    const cp = this.getProcessFromCacheOrThrow(process.id);

    const payload = {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'set_model', model },
    };

    cp.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  override async sendCommand(process: AdapterProcess, command: string, args = ''): Promise<void> {
    const cp = this.getProcessFromCacheOrThrow(process.id);

    const text = `<command-name>/${command}</command-name>\n<command-message>${command}</command-message>\n<command-args>${args}</command-args>`;
    const payload = {
      type: 'user',
      session_id: cp.chatId,
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
    };

    cp.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  // TODO this claude.ts seems to act also as a process/session, but also as sessions/processes manager. Double responsability ?
  killAll(): void {
    for (const cp of this.processes.values()) {
      cp.child.kill('SIGTERM');
    }
    this.processes.clear();
  }

  async sendMessage(
    process: AdapterProcess,
    message: string,
    images?: { mediaType: string; data: string }[],
  ): Promise<void> {
    const cp = this.getProcessFromCacheOrThrow(process.id);

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
      session_id: cp.chatId,
      message: { role: 'user', content },
      parent_tool_use_id: null,
    };

    cp.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  async respondToPermission(process: AdapterProcess, response: PermissionResponse): Promise<void> {
    const cp = this.getProcessFromCacheOrThrow(process.id);

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

    const stdin = cp.child.stdin;
    if (!stdin || stdin.destroyed) {
      log.error(
        { processId: process.id, requestId: response.requestId, toolName: response.toolName },
        'respondToPermission: stdin unavailable, response dropped',
      );
      return;
    }
    log.info(
      {
        processId: process.id,
        requestId: response.requestId,
        toolName: response.toolName,
        behavior: response.behavior,
        payload: json,
      },
      'writing permission response to stdin',
    );
    stdin.write(json + '\n');
  }

  override getContextFiles(projectPath: string): { global: ContextFile[]; project: ContextFile[] } {
    const globalDir = path.join(homedir(), '.claude');
    const global: ContextFile[] = [];
    // TODO this list should not stay inside this method, it can be reused (e.g the method bellow)
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const p = path.join(globalDir, name);
      if (existsSync(p)) {
        try {
          global.push({ path: name, content: readFileSync(p, 'utf-8'), source: 'global' });
        } catch {}
      }
    }

    const project: ContextFile[] = [];
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const p = path.join(projectPath, name);
      if (existsSync(p)) {
        try {
          project.push({ path: name, content: readFileSync(p, 'utf-8'), source: 'project' });
        } catch {}
      }
    }

    return { global, project };
  }

  // Delegate to extracted modules
  override async loadHistory(sessionId: string, projectPath: string): Promise<ChatMessage[]> {
    return loadHistoryFromDisk(sessionId, projectPath);
  }

  // TODO rename to extractSessionPlanFilePaths
  async extractPlanFilePaths(sessionId: string, projectPath: string): Promise<string[]> {
    return extractPlans(sessionId, projectPath);
  }

  // TODO rename to extractSessionSkillFilePaths
  async extractSkillFilePaths(sessionId: string, projectPath: string): Promise<SkillFileEntry[]> {
    return extractSkills(sessionId, projectPath);
  }

  override async listSkills(projectPath: string): Promise<Skill[]> {
    return skills.listSkills(projectPath);
  }

  override async createSkill(projectPath: string, input: CreateSkillInput): Promise<Skill> {
    return skills.createSkill(projectPath, input);
  }

  override async updateSkill(skillId: string, projectPath: string, content: string): Promise<Skill> {
    return skills.updateSkill(skillId, projectPath, content);
  }

  override async deleteSkill(skillId: string, projectPath: string): Promise<void> {
    return skills.deleteSkill(skillId, projectPath);
  }

  override async listAgents(projectPath: string): Promise<AgentConfig[]> {
    return skills.listAgents(projectPath);
  }

  override async createAgent(projectPath: string, input: CreateAgentInput): Promise<AgentConfig> {
    return skills.createAgent(projectPath, input);
  }

  override async updateAgent(agentId: string, projectPath: string, content: string): Promise<AgentConfig> {
    return skills.updateAgent(agentId, projectPath, content);
  }

  override async deleteAgent(agentId: string, projectPath: string): Promise<void> {
    return skills.deleteAgent(agentId, projectPath);
  }
}
