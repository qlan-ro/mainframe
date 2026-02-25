# Mainframe Milestone 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundation of Mainframe - a Node.js daemon that manages Claude CLI sessions, and an Electron desktop app with JetBrains-style configurable panels for AI-assisted development.

**Architecture:** Monorepo with three packages: `@mainframe/types` (shared TypeScript types), `@mainframe/core` (Node.js daemon with WebSocket/REST API), and `@mainframe/desktop` (Electron + React app). The daemon manages Claude CLI processes via the adapter pattern and exposes APIs for the desktop app.

**Tech Stack:** Node.js 20+, TypeScript, pnpm workspaces, Electron 28+, React 18+, Vite, shadcn/ui, Tailwind CSS, Zustand, react-resizable-panels, Monaco Editor, better-sqlite3, ws (WebSocket)

---

## Task 1: Initialize Monorepo Structure

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.npmrc`

**Step 1: Create root package.json**

```json
{
  "name": "mainframe",
  "version": "0.1.0",
  "private": true,
  "description": "AI-native development environment for orchestrating agents",
  "scripts": {
    "dev": "pnpm --parallel -r run dev",
    "build": "pnpm -r run build",
    "lint": "pnpm -r run lint",
    "test": "pnpm -r run test",
    "clean": "pnpm -r run clean"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmit": false,
    "isolatedModules": true
  }
}
```

**Step 4: Create .gitignore**

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
out/
.next/

# Environment
.env
.env.*
!.env.example

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Testing
coverage/

# SQLite
*.db
*.db-wal
*.db-shm

# Electron
release/
```

**Step 5: Create .npmrc**

```ini
auto-install-peers=true
strict-peer-dependencies=false
```

**Step 6: Initialize git and commit**

Run: `git init && git add . && git commit -m "chore: initialize monorepo structure"`

---

## Task 2: Create Shared Types Package

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`
- Create: `packages/types/src/agent.ts`
- Create: `packages/types/src/session.ts`
- Create: `packages/types/src/events.ts`
- Create: `packages/types/src/api.ts`

**Step 1: Create packages/types/package.json**

```json
{
  "name": "@mainframe/types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

**Step 2: Create packages/types/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create packages/types/src/agent.ts**

```typescript
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
}

export interface SpawnOptions {
  projectPath: string;
  sessionId?: string;
  model?: string;
  permissionMode?: 'default' | 'plan' | 'yolo';
}

export interface AgentProcess {
  id: string;
  agentId: string;
  sessionId: string;
  pid: number;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
  projectPath: string;
  model?: string;
}

export type PermissionBehavior = 'allow' | 'deny';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  suggestions: string[];
  decisionReason?: string;
}

export interface PermissionResponse {
  requestId: string;
  behavior: PermissionBehavior;
  updatedPermissions?: string[];
  message?: string;
}

export interface AgentAdapter {
  id: string;
  name: string;

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  spawn(options: SpawnOptions): Promise<AgentProcess>;
  kill(process: AgentProcess): Promise<void>;
  sendMessage(process: AgentProcess, message: string): Promise<void>;
  respondToPermission(process: AgentProcess, response: PermissionResponse): Promise<void>;
}
```

**Step 4: Create packages/types/src/session.ts**

```typescript
export interface Session {
  id: string;
  agentId: string;
  projectId: string;
  claudeSessionId?: string;
  model?: string;
  status: 'active' | 'paused' | 'ended';
  createdAt: string;
  updatedAt: string;
  totalCost: number;
  totalTokensInput: number;
  totalTokensOutput: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'permission' | 'system' | 'error';
  content: MessageContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'permission_request'; request: import('./agent').PermissionRequest }
  | { type: 'error'; message: string };
```

**Step 5: Create packages/types/src/events.ts**

```typescript
import type { Session, SessionMessage } from './session';
import type { AgentProcess, PermissionRequest } from './agent';

export type DaemonEvent =
  | { type: 'session.created'; session: Session }
  | { type: 'session.updated'; session: Session }
  | { type: 'session.ended'; sessionId: string }
  | { type: 'process.started'; process: AgentProcess }
  | { type: 'process.ready'; processId: string; claudeSessionId: string }
  | { type: 'process.stopped'; processId: string }
  | { type: 'message.added'; sessionId: string; message: SessionMessage }
  | { type: 'permission.requested'; sessionId: string; request: PermissionRequest }
  | { type: 'error'; sessionId?: string; error: string };

export type ClientEvent =
  | { type: 'session.create'; projectId: string; agentId: string; model?: string }
  | { type: 'session.resume'; sessionId: string }
  | { type: 'session.end'; sessionId: string }
  | { type: 'message.send'; sessionId: string; content: string }
  | { type: 'permission.respond'; sessionId: string; response: import('./agent').PermissionResponse }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string };
```

**Step 6: Create packages/types/src/api.ts**

```typescript
import type { Project, Session } from './session';
import type { AgentInfo } from './agent';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProjectsApi {
  list(): Promise<ApiResponse<Project[]>>;
  get(id: string): Promise<ApiResponse<Project>>;
  create(path: string): Promise<ApiResponse<Project>>;
  remove(id: string): Promise<ApiResponse<void>>;
}

export interface SessionsApi {
  list(projectId: string): Promise<ApiResponse<Session[]>>;
  get(id: string): Promise<ApiResponse<Session>>;
  getMessages(id: string): Promise<ApiResponse<import('./session').SessionMessage[]>>;
}

export interface AgentsApi {
  list(): Promise<ApiResponse<AgentInfo[]>>;
  get(id: string): Promise<ApiResponse<AgentInfo>>;
}
```

**Step 7: Create packages/types/src/index.ts**

```typescript
export * from './agent';
export * from './session';
export * from './events';
export * from './api';
```

**Step 8: Build and commit**

Run: `cd packages/types && pnpm install && pnpm build`
Expected: Compiles successfully, creates dist/ folder

Run: `git add . && git commit -m "feat(types): add shared type definitions"`

---

## Task 3: Create Core Daemon Package - Setup

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/config.ts`

**Step 1: Create packages/core/package.json**

```json
{
  "name": "@mainframe/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "mainframe-daemon": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mainframe/types": "workspace:*",
    "better-sqlite3": "^9.4.3",
    "express": "^4.18.2",
    "nanoid": "^5.0.4",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.10",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  }
}
```

**Step 2: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create packages/core/src/config.ts**

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface MainframeConfig {
  port: number;
  wsPort: number;
  dataDir: string;
}

const DEFAULT_CONFIG: MainframeConfig = {
  port: 31415,
  wsPort: 31416,
  dataDir: join(homedir(), '.mainframe'),
};

export function getDataDir(): string {
  const dir = DEFAULT_CONFIG.dataDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getConfig(): MainframeConfig {
  const configPath = join(getDataDir(), 'config.json');

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  return DEFAULT_CONFIG;
}

export function saveConfig(config: Partial<MainframeConfig>): void {
  const configPath = join(getDataDir(), 'config.json');
  const current = getConfig();
  const merged = { ...current, ...config };
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
}
```

**Step 4: Create packages/core/src/index.ts (stub)**

```typescript
#!/usr/bin/env node
import { getConfig, getDataDir } from './config';

const config = getConfig();

console.log(`Mainframe Core Daemon`);
console.log(`Data directory: ${getDataDir()}`);
console.log(`HTTP port: ${config.port}`);
console.log(`WebSocket port: ${config.wsPort}`);
console.log(`Starting...`);

// TODO: Initialize database, servers, and adapters
```

**Step 5: Install dependencies and build**

Run: `cd packages/core && pnpm install && pnpm build`
Expected: Compiles successfully

Run: `git add . && git commit -m "feat(core): add daemon package setup and config"`

---

## Task 4: Implement SQLite Database Layer

**Files:**
- Create: `packages/core/src/db/index.ts`
- Create: `packages/core/src/db/schema.ts`
- Create: `packages/core/src/db/projects.ts`
- Create: `packages/core/src/db/sessions.ts`

**Step 1: Create packages/core/src/db/schema.ts**

```typescript
import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      claude_session_id TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      total_cost REAL DEFAULT 0,
      total_tokens_input INTEGER DEFAULT 0,
      total_tokens_output INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON session_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON session_messages(timestamp);
  `);
}
```

**Step 2: Create packages/core/src/db/projects.ts**

```typescript
import type Database from 'better-sqlite3';
import type { Project } from '@mainframe/types';
import { nanoid } from 'nanoid';
import { basename } from 'node:path';

export class ProjectsRepository {
  constructor(private db: Database.Database) {}

  list(): Project[] {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt
      FROM projects
      ORDER BY last_opened_at DESC
    `);
    return stmt.all() as Project[];
  }

  get(id: string): Project | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt
      FROM projects WHERE id = ?
    `);
    return stmt.get(id) as Project | null;
  }

  getByPath(path: string): Project | null {
    const stmt = this.db.prepare(`
      SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt
      FROM projects WHERE path = ?
    `);
    return stmt.get(path) as Project | null;
  }

  create(path: string, name?: string): Project {
    const id = nanoid();
    const now = new Date().toISOString();
    const projectName = name || basename(path);

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, path, created_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, projectName, path, now, now);

    return { id, name: projectName, path, createdAt: now, lastOpenedAt: now };
  }

  updateLastOpened(id: string): void {
    const stmt = this.db.prepare(`UPDATE projects SET last_opened_at = ? WHERE id = ?`);
    stmt.run(new Date().toISOString(), id);
  }

  remove(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM projects WHERE id = ?`);
    stmt.run(id);
  }
}
```

**Step 3: Create packages/core/src/db/sessions.ts**

```typescript
import type Database from 'better-sqlite3';
import type { Session, SessionMessage, MessageContent } from '@mainframe/types';
import { nanoid } from 'nanoid';

export class SessionsRepository {
  constructor(private db: Database.Database) {}

  list(projectId: string): Session[] {
    const stmt = this.db.prepare(`
      SELECT
        id, agent_id as agentId, project_id as projectId,
        claude_session_id as claudeSessionId, model, status,
        created_at as createdAt, updated_at as updatedAt,
        total_cost as totalCost, total_tokens_input as totalTokensInput,
        total_tokens_output as totalTokensOutput
      FROM sessions
      WHERE project_id = ?
      ORDER BY updated_at DESC
    `);
    return stmt.all(projectId) as Session[];
  }

  get(id: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT
        id, agent_id as agentId, project_id as projectId,
        claude_session_id as claudeSessionId, model, status,
        created_at as createdAt, updated_at as updatedAt,
        total_cost as totalCost, total_tokens_input as totalTokensInput,
        total_tokens_output as totalTokensOutput
      FROM sessions WHERE id = ?
    `);
    return stmt.get(id) as Session | null;
  }

  create(projectId: string, agentId: string, model?: string): Session {
    const id = nanoid();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent_id, project_id, model, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `);
    stmt.run(id, agentId, projectId, model || null, now, now);

    return {
      id,
      agentId,
      projectId,
      model,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
    };
  }

  update(id: string, updates: Partial<Session>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.claudeSessionId !== undefined) {
      fields.push('claude_session_id = ?');
      values.push(updates.claudeSessionId);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.totalCost !== undefined) {
      fields.push('total_cost = ?');
      values.push(updates.totalCost);
    }
    if (updates.totalTokensInput !== undefined) {
      fields.push('total_tokens_input = ?');
      values.push(updates.totalTokensInput);
    }
    if (updates.totalTokensOutput !== undefined) {
      fields.push('total_tokens_output = ?');
      values.push(updates.totalTokensOutput);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  addMessage(sessionId: string, type: SessionMessage['type'], content: MessageContent[]): SessionMessage {
    const id = nanoid();
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO session_messages (id, session_id, type, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, sessionId, type, JSON.stringify(content), timestamp);

    return { id, sessionId, type, content, timestamp };
  }

  getMessages(sessionId: string): SessionMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, session_id as sessionId, type, content, timestamp, metadata
      FROM session_messages
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);
    const rows = stmt.all(sessionId) as Array<{
      id: string;
      sessionId: string;
      type: SessionMessage['type'];
      content: string;
      timestamp: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      ...row,
      content: JSON.parse(row.content),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }
}
```

**Step 4: Create packages/core/src/db/index.ts**

```typescript
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { getDataDir } from '../config';
import { initializeSchema } from './schema';
import { ProjectsRepository } from './projects';
import { SessionsRepository } from './sessions';

export class DatabaseManager {
  private db: Database.Database;
  public projects: ProjectsRepository;
  public sessions: SessionsRepository;

  constructor() {
    const dbPath = join(getDataDir(), 'mainframe.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    initializeSchema(this.db);

    this.projects = new ProjectsRepository(this.db);
    this.sessions = new SessionsRepository(this.db);
  }

  close(): void {
    this.db.close();
  }
}

export { ProjectsRepository } from './projects';
export { SessionsRepository } from './sessions';
```

**Step 5: Build and test**

Run: `cd packages/core && pnpm build`
Expected: Compiles successfully

Run: `git add . && git commit -m "feat(core): add SQLite database layer"`

---

## Task 5: Implement Claude CLI Adapter

**Files:**
- Create: `packages/core/src/adapters/base.ts`
- Create: `packages/core/src/adapters/claude.ts`
- Create: `packages/core/src/adapters/index.ts`

**Step 1: Create packages/core/src/adapters/base.ts**

```typescript
import { EventEmitter } from 'node:events';
import type { AgentAdapter, AgentProcess, SpawnOptions, PermissionResponse, PermissionRequest, MessageContent } from '@mainframe/types';

export interface AdapterEvents {
  init: (processId: string, claudeSessionId: string, model: string, tools: string[]) => void;
  message: (processId: string, content: MessageContent[]) => void;
  permission: (processId: string, request: PermissionRequest) => void;
  result: (processId: string, data: { cost: number; tokensInput: number; tokensOutput: number }) => void;
  error: (processId: string, error: Error) => void;
  exit: (processId: string, code: number | null) => void;
}

export abstract class BaseAdapter extends EventEmitter implements AgentAdapter {
  abstract id: string;
  abstract name: string;

  abstract isInstalled(): Promise<boolean>;
  abstract getVersion(): Promise<string | null>;
  abstract spawn(options: SpawnOptions): Promise<AgentProcess>;
  abstract kill(process: AgentProcess): Promise<void>;
  abstract sendMessage(process: AgentProcess, message: string): Promise<void>;
  abstract respondToPermission(process: AgentProcess, response: PermissionResponse): Promise<void>;

  override emit<K extends keyof AdapterEvents>(event: K, ...args: Parameters<AdapterEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof AdapterEvents>(event: K, listener: AdapterEvents[K]): this {
    return super.on(event, listener);
  }
}
```

**Step 2: Create packages/core/src/adapters/claude.ts**

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { nanoid } from 'nanoid';
import type { AgentProcess, SpawnOptions, PermissionResponse, PermissionRequest, MessageContent } from '@mainframe/types';
import { BaseAdapter } from './base';

interface ClaudeProcess extends AgentProcess {
  child: ChildProcess;
  buffer: string;
}

export class ClaudeAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Claude CLI';

  private processes = new Map<string, ClaudeProcess>();

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
          resolve(match ? match[1] : output.trim());
        } else {
          resolve(null);
        }
      });
    });
  }

  async spawn(options: SpawnOptions): Promise<AgentProcess> {
    const processId = nanoid();

    const args = [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio',
    ];

    if (options.sessionId) {
      args.push('--resume', options.sessionId);
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.permissionMode === 'plan') {
      args.push('--permission-mode', 'plan');
    } else if (options.permissionMode === 'yolo') {
      args.push('--dangerously-skip-permissions');
    }

    const child = spawn('claude', args, {
      cwd: options.projectPath,
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    const agentProcess: ClaudeProcess = {
      id: processId,
      agentId: this.id,
      sessionId: '',
      pid: child.pid || 0,
      status: 'starting',
      projectPath: options.projectPath,
      model: options.model,
      child,
      buffer: '',
    };

    this.processes.set(processId, agentProcess);

    child.stdout?.on('data', (chunk) => this.handleStdout(processId, chunk));
    child.stderr?.on('data', (chunk) => this.handleStderr(processId, chunk));
    child.on('error', (error) => this.emit('error', processId, error));
    child.on('close', (code) => {
      this.processes.delete(processId);
      this.emit('exit', processId, code);
    });

    return agentProcess;
  }

  async kill(process: AgentProcess): Promise<void> {
    const cp = this.processes.get(process.id);
    if (cp) {
      cp.child.kill('SIGTERM');
      this.processes.delete(process.id);
    }
  }

  async sendMessage(process: AgentProcess, message: string): Promise<void> {
    const cp = this.processes.get(process.id);
    if (!cp) throw new Error(`Process ${process.id} not found`);

    const payload = {
      type: 'user',
      session_id: cp.sessionId,
      message: {
        role: 'user',
        content: [{ type: 'text', text: message }],
      },
      parent_tool_use_id: null,
    };

    cp.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  async respondToPermission(process: AgentProcess, response: PermissionResponse): Promise<void> {
    const cp = this.processes.get(process.id);
    if (!cp) throw new Error(`Process ${process.id} not found`);

    const payload = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: response.requestId,
        response: {
          behavior: response.behavior,
          ...(response.updatedPermissions && { updatedPermissions: response.updatedPermissions }),
          ...(response.message && { message: response.message }),
        },
      },
    };

    cp.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  private handleStdout(processId: string, chunk: Buffer): void {
    const cp = this.processes.get(processId);
    if (!cp) return;

    cp.buffer += chunk.toString();
    const lines = cp.buffer.split('\n');
    cp.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line.trim());
        this.handleEvent(processId, event);
      } catch {
        // Not JSON, skip
      }
    }
  }

  private handleStderr(processId: string, chunk: Buffer): void {
    const message = chunk.toString().trim();
    if (message) {
      this.emit('error', processId, new Error(message));
    }
  }

  private handleEvent(processId: string, event: Record<string, unknown>): void {
    const cp = this.processes.get(processId);
    if (!cp) return;

    switch (event.type) {
      case 'system': {
        if (event.subtype === 'init') {
          cp.sessionId = event.session_id as string;
          cp.status = 'ready';
          this.emit('init', processId, event.session_id as string, event.model as string, event.tools as string[]);
        }
        break;
      }

      case 'assistant': {
        const message = event.message as { content: MessageContent[]; usage?: { input_tokens: number; output_tokens: number } };
        if (message?.content) {
          this.emit('message', processId, message.content);
        }
        break;
      }

      case 'control_request': {
        const request = event.request as Record<string, unknown>;
        if (request?.subtype === 'can_use_tool') {
          const permRequest: PermissionRequest = {
            requestId: event.request_id as string,
            toolName: request.tool_name as string,
            toolUseId: request.tool_use_id as string,
            input: request.input as Record<string, unknown>,
            suggestions: (request.permission_suggestions as string[]) || [],
            decisionReason: request.decision_reason as string | undefined,
          };
          this.emit('permission', processId, permRequest);
        }
        break;
      }

      case 'result': {
        this.emit('result', processId, {
          cost: (event.total_cost_usd as number) || 0,
          tokensInput: 0,
          tokensOutput: 0,
        });
        break;
      }
    }
  }
}
```

**Step 3: Create packages/core/src/adapters/index.ts**

```typescript
import type { AgentAdapter, AgentInfo } from '@mainframe/types';
import { ClaudeAdapter } from './claude';

export class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  constructor() {
    this.register(new ClaudeAdapter());
  }

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  async list(): Promise<AgentInfo[]> {
    const infos: AgentInfo[] = [];
    for (const adapter of this.adapters.values()) {
      const installed = await adapter.isInstalled();
      const version = installed ? await adapter.getVersion() : undefined;
      infos.push({
        id: adapter.id,
        name: adapter.name,
        description: `${adapter.name} agent adapter`,
        installed,
        version: version || undefined,
      });
    }
    return infos;
  }
}

export { ClaudeAdapter } from './claude';
export { BaseAdapter } from './base';
```

**Step 4: Build and commit**

Run: `cd packages/core && pnpm build`
Expected: Compiles successfully

Run: `git add . && git commit -m "feat(core): add Claude CLI adapter with NDJSON streaming"`

---

## Task 6: Implement Session Manager

**Files:**
- Create: `packages/core/src/session-manager.ts`

**Step 1: Create packages/core/src/session-manager.ts**

```typescript
import { EventEmitter } from 'node:events';
import type { Session, SessionMessage, AgentProcess, PermissionRequest, PermissionResponse, MessageContent, DaemonEvent } from '@mainframe/types';
import type { DatabaseManager } from './db';
import type { AdapterRegistry } from './adapters';
import { ClaudeAdapter } from './adapters';

interface ActiveSession {
  session: Session;
  process: AgentProcess | null;
}

export class SessionManager extends EventEmitter {
  private activeSessions = new Map<string, ActiveSession>();
  private processToSession = new Map<string, string>();

  constructor(
    private db: DatabaseManager,
    private adapters: AdapterRegistry
  ) {
    super();
    this.setupAdapterListeners();
  }

  private setupAdapterListeners(): void {
    const claude = this.adapters.get('claude') as ClaudeAdapter;
    if (!claude) return;

    claude.on('init', (processId, claudeSessionId, model, _tools) => {
      const sessionId = this.processToSession.get(processId);
      if (!sessionId) return;

      const active = this.activeSessions.get(sessionId);
      if (!active) return;

      this.db.sessions.update(sessionId, { claudeSessionId });
      active.session.claudeSessionId = claudeSessionId;

      this.emitEvent({ type: 'process.ready', processId, claudeSessionId });
    });

    claude.on('message', (processId, content) => {
      const sessionId = this.processToSession.get(processId);
      if (!sessionId) return;

      const message = this.db.sessions.addMessage(sessionId, 'assistant', content);
      this.emitEvent({ type: 'message.added', sessionId, message });
    });

    claude.on('permission', (processId, request) => {
      const sessionId = this.processToSession.get(processId);
      if (!sessionId) return;

      this.emitEvent({ type: 'permission.requested', sessionId, request });
    });

    claude.on('result', (processId, data) => {
      const sessionId = this.processToSession.get(processId);
      if (!sessionId) return;

      const active = this.activeSessions.get(sessionId);
      if (!active) return;

      const newCost = active.session.totalCost + data.cost;
      const newInput = active.session.totalTokensInput + data.tokensInput;
      const newOutput = active.session.totalTokensOutput + data.tokensOutput;

      this.db.sessions.update(sessionId, {
        totalCost: newCost,
        totalTokensInput: newInput,
        totalTokensOutput: newOutput,
      });

      active.session.totalCost = newCost;
      active.session.totalTokensInput = newInput;
      active.session.totalTokensOutput = newOutput;

      this.emitEvent({ type: 'session.updated', session: active.session });
    });

    claude.on('exit', (processId, _code) => {
      const sessionId = this.processToSession.get(processId);
      if (!sessionId) return;

      const active = this.activeSessions.get(sessionId);
      if (active) {
        active.process = null;
      }

      this.processToSession.delete(processId);
      this.emitEvent({ type: 'process.stopped', processId });
    });

    claude.on('error', (processId, error) => {
      const sessionId = this.processToSession.get(processId);
      this.emitEvent({ type: 'error', sessionId, error: error.message });
    });
  }

  async createSession(projectId: string, agentId: string, model?: string): Promise<Session> {
    const session = this.db.sessions.create(projectId, agentId, model);
    this.activeSessions.set(session.id, { session, process: null });
    this.emitEvent({ type: 'session.created', session });
    return session;
  }

  async startSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      const session = this.db.sessions.get(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);
      this.activeSessions.set(sessionId, { session, process: null });
    }

    const { session } = this.activeSessions.get(sessionId)!;
    const adapter = this.adapters.get(session.agentId);
    if (!adapter) throw new Error(`Adapter ${session.agentId} not found`);

    const project = this.db.projects.get(session.projectId);
    if (!project) throw new Error(`Project ${session.projectId} not found`);

    const process = await adapter.spawn({
      projectPath: project.path,
      sessionId: session.claudeSessionId,
      model: session.model,
    });

    this.activeSessions.get(sessionId)!.process = process;
    this.processToSession.set(process.id, sessionId);

    this.emitEvent({ type: 'process.started', process });
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active?.process) throw new Error(`Session ${sessionId} not running`);

    const adapter = this.adapters.get(active.session.agentId);
    if (!adapter) throw new Error(`Adapter not found`);

    const message = this.db.sessions.addMessage(sessionId, 'user', [{ type: 'text', text: content }]);
    this.emitEvent({ type: 'message.added', sessionId, message });

    await adapter.sendMessage(active.process, content);
  }

  async respondToPermission(sessionId: string, response: PermissionResponse): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active?.process) throw new Error(`Session ${sessionId} not running`);

    const adapter = this.adapters.get(active.session.agentId);
    if (!adapter) throw new Error(`Adapter not found`);

    await adapter.respondToPermission(active.process, response);
  }

  async endSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    if (active.process) {
      const adapter = this.adapters.get(active.session.agentId);
      if (adapter) {
        await adapter.kill(active.process);
      }
      this.processToSession.delete(active.process.id);
    }

    this.db.sessions.update(sessionId, { status: 'ended' });
    this.activeSessions.delete(sessionId);
    this.emitEvent({ type: 'session.ended', sessionId });
  }

  getSession(sessionId: string): Session | null {
    const active = this.activeSessions.get(sessionId);
    if (active) return active.session;
    return this.db.sessions.get(sessionId);
  }

  getMessages(sessionId: string): SessionMessage[] {
    return this.db.sessions.getMessages(sessionId);
  }

  isSessionRunning(sessionId: string): boolean {
    const active = this.activeSessions.get(sessionId);
    return active?.process !== null;
  }

  private emitEvent(event: DaemonEvent): void {
    this.emit('event', event);
  }
}
```

**Step 2: Build and commit**

Run: `cd packages/core && pnpm build`
Expected: Compiles successfully

Run: `git add . && git commit -m "feat(core): add session manager with lifecycle handling"`

---

## Task 7: Implement HTTP and WebSocket Servers

**Files:**
- Create: `packages/core/src/server/http.ts`
- Create: `packages/core/src/server/websocket.ts`
- Create: `packages/core/src/server/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Create packages/core/src/server/http.ts**

```typescript
import express, { Express, Request, Response } from 'express';
import type { DatabaseManager } from '../db';
import type { SessionManager } from '../session-manager';
import type { AdapterRegistry } from '../adapters';

export function createHttpServer(
  db: DatabaseManager,
  sessions: SessionManager,
  adapters: AdapterRegistry
): Express {
  const app = express();
  app.use(express.json());

  // Projects API
  app.get('/api/projects', (_req: Request, res: Response) => {
    const projects = db.projects.list();
    res.json({ success: true, data: projects });
  });

  app.get('/api/projects/:id', (req: Request, res: Response) => {
    const project = db.projects.get(req.params.id);
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }
    res.json({ success: true, data: project });
  });

  app.post('/api/projects', (req: Request, res: Response) => {
    const { path, name } = req.body;
    if (!path) {
      res.status(400).json({ success: false, error: 'Path is required' });
      return;
    }

    const existing = db.projects.getByPath(path);
    if (existing) {
      db.projects.updateLastOpened(existing.id);
      res.json({ success: true, data: existing });
      return;
    }

    const project = db.projects.create(path, name);
    res.json({ success: true, data: project });
  });

  app.delete('/api/projects/:id', (req: Request, res: Response) => {
    db.projects.remove(req.params.id);
    res.json({ success: true });
  });

  // Sessions API
  app.get('/api/projects/:projectId/sessions', (req: Request, res: Response) => {
    const sessionsList = db.sessions.list(req.params.projectId);
    res.json({ success: true, data: sessionsList });
  });

  app.get('/api/sessions/:id', (req: Request, res: Response) => {
    const session = sessions.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    res.json({ success: true, data: session });
  });

  app.get('/api/sessions/:id/messages', (req: Request, res: Response) => {
    const messages = sessions.getMessages(req.params.id);
    res.json({ success: true, data: messages });
  });

  // Agents API
  app.get('/api/agents', async (_req: Request, res: Response) => {
    const agents = await adapters.list();
    res.json({ success: true, data: agents });
  });

  return app;
}
```

**Step 2: Create packages/core/src/server/websocket.ts**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { SessionManager } from '../session-manager';
import type { ClientEvent, DaemonEvent } from '@mainframe/types';

interface ClientConnection {
  ws: WebSocket;
  subscriptions: Set<string>;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientConnection>();

  constructor(server: Server, private sessions: SessionManager) {
    this.wss = new WebSocketServer({ server });
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.wss.on('connection', (ws) => {
      const client: ClientConnection = { ws, subscriptions: new Set() };
      this.clients.set(ws, client);

      ws.on('message', async (data) => {
        try {
          const event = JSON.parse(data.toString()) as ClientEvent;
          await this.handleClientEvent(client, event);
        } catch (error) {
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    this.sessions.on('event', (event: DaemonEvent) => {
      this.broadcastEvent(event);
    });
  }

  private async handleClientEvent(client: ClientConnection, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case 'session.create': {
        const session = await this.sessions.createSession(event.projectId, event.agentId, event.model);
        await this.sessions.startSession(session.id);
        client.subscriptions.add(session.id);
        break;
      }

      case 'session.resume': {
        await this.sessions.startSession(event.sessionId);
        client.subscriptions.add(event.sessionId);
        break;
      }

      case 'session.end': {
        await this.sessions.endSession(event.sessionId);
        client.subscriptions.delete(event.sessionId);
        break;
      }

      case 'message.send': {
        await this.sessions.sendMessage(event.sessionId, event.content);
        break;
      }

      case 'permission.respond': {
        await this.sessions.respondToPermission(event.sessionId, event.response);
        break;
      }

      case 'subscribe': {
        client.subscriptions.add(event.sessionId);
        break;
      }

      case 'unsubscribe': {
        client.subscriptions.delete(event.sessionId);
        break;
      }
    }
  }

  private broadcastEvent(event: DaemonEvent): void {
    const sessionId = 'sessionId' in event ? event.sessionId : undefined;
    const payload = JSON.stringify(event);

    for (const client of this.clients.values()) {
      if (!sessionId || client.subscriptions.has(sessionId)) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: message }));
    }
  }
}
```

**Step 3: Create packages/core/src/server/index.ts**

```typescript
import { createServer } from 'node:http';
import type { Express } from 'express';
import { createHttpServer } from './http';
import { WebSocketManager } from './websocket';
import type { DatabaseManager } from '../db';
import type { SessionManager } from '../session-manager';
import type { AdapterRegistry } from '../adapters';

export interface ServerManager {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}

export function createServerManager(
  db: DatabaseManager,
  sessions: SessionManager,
  adapters: AdapterRegistry
): ServerManager {
  const app: Express = createHttpServer(db, sessions, adapters);
  const httpServer = createServer(app);
  let wsManager: WebSocketManager | null = null;

  return {
    async start(port: number): Promise<void> {
      wsManager = new WebSocketManager(httpServer, sessions);

      return new Promise((resolve) => {
        httpServer.listen(port, () => {
          console.log(`HTTP server listening on port ${port}`);
          console.log(`WebSocket server listening on port ${port}`);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

export { createHttpServer } from './http';
export { WebSocketManager } from './websocket';
```

**Step 4: Update packages/core/src/index.ts**

```typescript
#!/usr/bin/env node
import { getConfig, getDataDir } from './config';
import { DatabaseManager } from './db';
import { AdapterRegistry } from './adapters';
import { SessionManager } from './session-manager';
import { createServerManager } from './server';

async function main(): Promise<void> {
  const config = getConfig();

  console.log(`Mainframe Core Daemon`);
  console.log(`Data directory: ${getDataDir()}`);
  console.log(`Starting on port ${config.port}...`);

  const db = new DatabaseManager();
  const adapters = new AdapterRegistry();
  const sessions = new SessionManager(db, adapters);
  const server = createServerManager(db, sessions, adapters);

  await server.start(config.port);

  console.log(`Daemon ready`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**Step 5: Build and test**

Run: `cd packages/core && pnpm build && pnpm start`
Expected: Daemon starts, outputs "Daemon ready"

Run: `git add . && git commit -m "feat(core): add HTTP and WebSocket servers"`

---

## Task 8: Create Desktop App Package - Electron Setup

**Files:**
- Create: `packages/desktop/package.json`
- Create: `packages/desktop/tsconfig.json`
- Create: `packages/desktop/tsconfig.node.json`
- Create: `packages/desktop/electron.vite.config.ts`
- Create: `packages/desktop/src/main/index.ts`
- Create: `packages/desktop/src/preload/index.ts`

**Step 1: Create packages/desktop/package.json**

```json
{
  "name": "@mainframe/desktop",
  "version": "0.1.0",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "clean": "rm -rf out dist",
    "start": "electron-vite preview",
    "lint": "eslint .",
    "package": "electron-builder"
  },
  "dependencies": {
    "@mainframe/types": "workspace:*",
    "@radix-ui/react-context-menu": "^2.1.5",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.4",
    "@radix-ui/react-tooltip": "^1.0.7",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.312.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-markdown": "^9.0.1",
    "react-resizable-panels": "^1.0.9",
    "rehype-highlight": "^7.0.0",
    "tailwind-merge": "^2.2.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "electron": "^28.1.3",
    "electron-builder": "^24.9.1",
    "electron-vite": "^2.0.0",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.12"
  }
}
```

**Step 2: Create packages/desktop/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true
  },
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

**Step 3: Create packages/desktop/tsconfig.node.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./out",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["src/main/**/*", "src/preload/**/*", "electron.vite.config.ts"]
}
```

**Step 4: Create packages/desktop/tsconfig.web.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./out",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src/renderer/**/*"]
}
```

**Step 5: Create packages/desktop/electron.vite.config.ts**

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    plugins: [react()],
  },
});
```

**Step 6: Create packages/desktop/src/main/index.ts**

```typescript
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let daemon: ChildProcess | null = null;

function startDaemon(): void {
  // In development, assume daemon is started separately
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode: assuming daemon is running');
    return;
  }

  // In production, start the bundled daemon
  const daemonPath = join(__dirname, '../../core/dist/index.js');
  daemon = spawn('node', [daemonPath], {
    stdio: 'inherit',
    detached: false,
  });

  daemon.on('error', (error) => {
    console.error('Daemon error:', error);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  startDaemon();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (daemon) {
    daemon.kill();
  }
});
```

**Step 7: Create packages/desktop/src/preload/index.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

export interface MainframeAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
}

const api: MainframeAPI = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
};

contextBridge.exposeInMainWorld('mainframe', api);
```

**Step 8: Commit**

Run: `git add . && git commit -m "feat(desktop): add Electron app setup with main and preload"`

---

## Task 9: Create Desktop App - React Renderer Setup

**Files:**
- Create: `packages/desktop/src/renderer/index.html`
- Create: `packages/desktop/src/renderer/main.tsx`
- Create: `packages/desktop/src/renderer/App.tsx`
- Create: `packages/desktop/src/renderer/index.css`
- Create: `packages/desktop/tailwind.config.js`
- Create: `packages/desktop/postcss.config.js`

**Step 1: Create packages/desktop/src/renderer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mainframe</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100 antialiased">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

**Step 2: Create packages/desktop/src/renderer/main.tsx**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Step 3: Create packages/desktop/src/renderer/App.tsx**

```typescript
import React from 'react';

export default function App(): React.ReactElement {
  return (
    <div className="h-screen flex flex-col">
      {/* Title bar area for macOS traffic lights */}
      <div className="h-10 bg-zinc-900 flex items-center justify-center border-b border-zinc-800 app-drag">
        <span className="text-sm font-medium text-zinc-400">Mainframe</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Welcome to Mainframe</h1>
          <p className="text-zinc-400">AI-native development environment</p>
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Create packages/desktop/src/renderer/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --card: 0 0% 7%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 7%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 9%;
    --secondary: 0 0% 14.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 14.9%;
    --muted-foreground: 0 0% 63.9%;
    --accent: 0 0% 14.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 14.9%;
    --input: 0 0% 14.9%;
    --ring: 0 0% 83.1%;
    --radius: 0.5rem;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}

@layer utilities {
  .app-drag {
    -webkit-app-region: drag;
  }

  .app-no-drag {
    -webkit-app-region: no-drag;
  }
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: hsl(var(--muted));
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.5);
}
```

**Step 5: Create packages/desktop/tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
```

**Step 6: Create packages/desktop/postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**Step 7: Install dependencies and test**

Run: `cd packages/desktop && pnpm install`
Expected: Dependencies installed

Run: `pnpm dev`
Expected: Electron app opens with "Welcome to Mainframe"

Run: `git add . && git commit -m "feat(desktop): add React renderer with Tailwind CSS"`

---

## Task 10: Implement Zustand State Store

**Files:**
- Create: `packages/desktop/src/renderer/store/index.ts`
- Create: `packages/desktop/src/renderer/store/projects.ts`
- Create: `packages/desktop/src/renderer/store/sessions.ts`
- Create: `packages/desktop/src/renderer/store/ui.ts`

**Step 1: Create packages/desktop/src/renderer/store/projects.ts**

```typescript
import { create } from 'zustand';
import type { Project } from '@mainframe/types';

interface ProjectsState {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;

  setProjects: (projects: Project[]) => void;
  setActiveProject: (id: string | null) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  activeProjectId: null,
  loading: false,
  error: null,

  setProjects: (projects) => set({ projects }),
  setActiveProject: (id) => set({ activeProjectId: id }),
  addProject: (project) => set((state) => ({ projects: [...state.projects, project] })),
  removeProject: (id) => set((state) => ({
    projects: state.projects.filter((p) => p.id !== id),
    activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
  })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
```

**Step 2: Create packages/desktop/src/renderer/store/sessions.ts**

```typescript
import { create } from 'zustand';
import type { Session, SessionMessage, PermissionRequest } from '@mainframe/types';

interface SessionsState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Map<string, SessionMessage[]>;
  pendingPermissions: Map<string, PermissionRequest>;

  setSessions: (sessions: Session[]) => void;
  setActiveSession: (id: string | null) => void;
  addSession: (session: Session) => void;
  updateSession: (session: Session) => void;
  removeSession: (id: string) => void;
  addMessage: (sessionId: string, message: SessionMessage) => void;
  setMessages: (sessionId: string, messages: SessionMessage[]) => void;
  addPendingPermission: (sessionId: string, request: PermissionRequest) => void;
  removePendingPermission: (sessionId: string) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  pendingPermissions: new Map(),

  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  addSession: (session) => set((state) => ({ sessions: [...state.sessions, session] })),
  updateSession: (session) => set((state) => ({
    sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
  })),
  removeSession: (id) => set((state) => ({
    sessions: state.sessions.filter((s) => s.id !== id),
    activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
  })),
  addMessage: (sessionId, message) => set((state) => {
    const newMessages = new Map(state.messages);
    const existing = newMessages.get(sessionId) || [];
    newMessages.set(sessionId, [...existing, message]);
    return { messages: newMessages };
  }),
  setMessages: (sessionId, messages) => set((state) => {
    const newMessages = new Map(state.messages);
    newMessages.set(sessionId, messages);
    return { messages: newMessages };
  }),
  addPendingPermission: (sessionId, request) => set((state) => {
    const newPending = new Map(state.pendingPermissions);
    newPending.set(sessionId, request);
    return { pendingPermissions: newPending };
  }),
  removePendingPermission: (sessionId) => set((state) => {
    const newPending = new Map(state.pendingPermissions);
    newPending.delete(sessionId);
    return { pendingPermissions: newPending };
  }),
}));
```

**Step 3: Create packages/desktop/src/renderer/store/ui.ts**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type PanelId = 'left' | 'right' | 'bottom';

interface UIState {
  panelSizes: Record<PanelId, number>;
  panelCollapsed: Record<PanelId, boolean>;
  leftPanelTab: 'files' | 'sessions' | 'context';
  rightPanelTab: 'diff' | 'preview' | 'info';
  bottomPanelTab: 'terminal' | 'history' | 'logs';

  setPanelSize: (id: PanelId, size: number) => void;
  togglePanel: (id: PanelId) => void;
  setLeftPanelTab: (tab: UIState['leftPanelTab']) => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
  setBottomPanelTab: (tab: UIState['bottomPanelTab']) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      panelSizes: { left: 240, right: 300, bottom: 200 },
      panelCollapsed: { left: false, right: false, bottom: true },
      leftPanelTab: 'sessions',
      rightPanelTab: 'diff',
      bottomPanelTab: 'terminal',

      setPanelSize: (id, size) => set((state) => ({
        panelSizes: { ...state.panelSizes, [id]: size },
      })),
      togglePanel: (id) => set((state) => ({
        panelCollapsed: { ...state.panelCollapsed, [id]: !state.panelCollapsed[id] },
      })),
      setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
    }),
    { name: 'mainframe-ui' }
  )
);
```

**Step 4: Create packages/desktop/src/renderer/store/index.ts**

```typescript
export { useProjectsStore } from './projects';
export { useSessionsStore } from './sessions';
export { useUIStore } from './ui';
```

**Step 5: Commit**

Run: `git add . && git commit -m "feat(desktop): add Zustand state stores"`

---

## Task 11: Implement Daemon Client

**Files:**
- Create: `packages/desktop/src/renderer/lib/client.ts`
- Create: `packages/desktop/src/renderer/hooks/useDaemon.ts`

**Step 1: Create packages/desktop/src/renderer/lib/client.ts**

```typescript
import type {
  Project, Session, SessionMessage, AgentInfo,
  ClientEvent, DaemonEvent, PermissionResponse
} from '@mainframe/types';

const API_BASE = 'http://localhost:31415';
const WS_URL = 'ws://localhost:31415';

class DaemonClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Set<(event: DaemonEvent) => void>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('Connected to daemon');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DaemonEvent;
        this.eventHandlers.forEach((handler) => handler(data));
      } catch (error) {
        console.error('Failed to parse daemon event:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('Disconnected from daemon');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    setTimeout(() => {
      console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  onEvent(handler: (event: DaemonEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private send(event: ClientEvent): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to daemon');
    }
    this.ws.send(JSON.stringify(event));
  }

  // REST API methods
  async getProjects(): Promise<Project[]> {
    const res = await fetch(`${API_BASE}/api/projects`);
    const json = await res.json();
    return json.data;
  }

  async createProject(path: string): Promise<Project> {
    const res = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const json = await res.json();
    return json.data;
  }

  async removeProject(id: string): Promise<void> {
    await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
  }

  async getSessions(projectId: string): Promise<Session[]> {
    const res = await fetch(`${API_BASE}/api/projects/${projectId}/sessions`);
    const json = await res.json();
    return json.data;
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
    const json = await res.json();
    return json.data;
  }

  async getAgents(): Promise<AgentInfo[]> {
    const res = await fetch(`${API_BASE}/api/agents`);
    const json = await res.json();
    return json.data;
  }

  // WebSocket methods
  createSession(projectId: string, agentId: string, model?: string): void {
    this.send({ type: 'session.create', projectId, agentId, model });
  }

  resumeSession(sessionId: string): void {
    this.send({ type: 'session.resume', sessionId });
  }

  endSession(sessionId: string): void {
    this.send({ type: 'session.end', sessionId });
  }

  sendMessage(sessionId: string, content: string): void {
    this.send({ type: 'message.send', sessionId, content });
  }

  respondToPermission(sessionId: string, response: PermissionResponse): void {
    this.send({ type: 'permission.respond', sessionId, response });
  }

  subscribe(sessionId: string): void {
    this.send({ type: 'subscribe', sessionId });
  }

  unsubscribe(sessionId: string): void {
    this.send({ type: 'unsubscribe', sessionId });
  }
}

export const daemonClient = new DaemonClient();
```

**Step 2: Create packages/desktop/src/renderer/hooks/useDaemon.ts**

```typescript
import { useEffect, useCallback } from 'react';
import { daemonClient } from '../lib/client';
import { useProjectsStore, useSessionsStore } from '../store';
import type { DaemonEvent } from '@mainframe/types';

export function useDaemon(): void {
  const { setProjects, addProject, setLoading, setError } = useProjectsStore();
  const {
    addSession, updateSession, removeSession,
    addMessage, addPendingPermission, removePendingPermission
  } = useSessionsStore();

  const handleEvent = useCallback((event: DaemonEvent) => {
    switch (event.type) {
      case 'session.created':
        addSession(event.session);
        break;
      case 'session.updated':
        updateSession(event.session);
        break;
      case 'session.ended':
        removeSession(event.sessionId);
        break;
      case 'message.added':
        addMessage(event.sessionId, event.message);
        break;
      case 'permission.requested':
        addPendingPermission(event.sessionId, event.request);
        break;
      case 'error':
        setError(event.error);
        break;
    }
  }, [addSession, updateSession, removeSession, addMessage, addPendingPermission, setError]);

  useEffect(() => {
    daemonClient.connect();
    const unsubscribe = daemonClient.onEvent(handleEvent);

    // Load initial data
    const loadData = async () => {
      setLoading(true);
      try {
        const projects = await daemonClient.getProjects();
        setProjects(projects);
      } catch (error) {
        setError('Failed to load projects');
      } finally {
        setLoading(false);
      }
    };

    loadData();

    return () => {
      unsubscribe();
      daemonClient.disconnect();
    };
  }, [handleEvent, setProjects, setLoading, setError]);
}

export function useProject(projectId: string | null) {
  const { sessions, setSessions, setMessages } = useSessionsStore();

  useEffect(() => {
    if (!projectId) return;

    const loadSessions = async () => {
      const sessionsList = await daemonClient.getSessions(projectId);
      setSessions(sessionsList);
    };

    loadSessions();
  }, [projectId, setSessions]);

  const createSession = useCallback((agentId: string, model?: string) => {
    if (!projectId) return;
    daemonClient.createSession(projectId, agentId, model);
  }, [projectId]);

  return { sessions, createSession };
}

export function useSession(sessionId: string | null) {
  const { messages, pendingPermissions, setMessages } = useSessionsStore();
  const sessionMessages = sessionId ? messages.get(sessionId) || [] : [];
  const pendingPermission = sessionId ? pendingPermissions.get(sessionId) : undefined;

  useEffect(() => {
    if (!sessionId) return;

    const loadMessages = async () => {
      const msgs = await daemonClient.getSessionMessages(sessionId);
      setMessages(sessionId, msgs);
    };

    loadMessages();
    daemonClient.subscribe(sessionId);

    return () => {
      daemonClient.unsubscribe(sessionId);
    };
  }, [sessionId, setMessages]);

  const sendMessage = useCallback((content: string) => {
    if (!sessionId) return;
    daemonClient.sendMessage(sessionId, content);
  }, [sessionId]);

  const respondToPermission = useCallback((behavior: 'allow' | 'deny', alwaysAllow?: string[]) => {
    if (!sessionId || !pendingPermission) return;
    daemonClient.respondToPermission(sessionId, {
      requestId: pendingPermission.requestId,
      behavior,
      updatedPermissions: alwaysAllow,
    });
    useSessionsStore.getState().removePendingPermission(sessionId);
  }, [sessionId, pendingPermission]);

  return { messages: sessionMessages, pendingPermission, sendMessage, respondToPermission };
}
```

**Step 3: Commit**

Run: `git add . && git commit -m "feat(desktop): add daemon client and hooks"`

---

## Task 12: Implement Panel Layout System

**Files:**
- Create: `packages/desktop/src/renderer/components/Layout.tsx`
- Create: `packages/desktop/src/renderer/components/TitleBar.tsx`
- Create: `packages/desktop/src/renderer/components/ProjectRail.tsx`
- Modify: `packages/desktop/src/renderer/App.tsx`

**Step 1: Create packages/desktop/src/renderer/components/TitleBar.tsx**

```typescript
import React from 'react';
import { Search } from 'lucide-react';

export function TitleBar(): React.ReactElement {
  return (
    <div className="h-10 bg-zinc-900 flex items-center border-b border-zinc-800 app-drag">
      {/* Space for macOS traffic lights */}
      <div className="w-20" />

      {/* Title */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm font-medium text-zinc-400">Mainframe</span>
      </div>

      {/* Search */}
      <div className="w-20 flex items-center justify-end pr-4 app-no-drag">
        <button className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
          <Search size={16} />
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Create packages/desktop/src/renderer/components/ProjectRail.tsx**

```typescript
import React from 'react';
import { FolderOpen, Plus, Settings, HelpCircle } from 'lucide-react';
import { useProjectsStore } from '../store';
import { cn } from '../lib/utils';

export function ProjectRail(): React.ReactElement {
  const { projects, activeProjectId, setActiveProject } = useProjectsStore();

  return (
    <div className="w-12 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      {/* Project icons */}
      <div className="flex-1 py-2 space-y-1 overflow-y-auto">
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => setActiveProject(project.id)}
            className={cn(
              'w-full aspect-square flex items-center justify-center mx-auto',
              'rounded-lg transition-colors',
              activeProjectId === project.id
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            )}
            title={project.name}
          >
            <FolderOpen size={20} />
          </button>
        ))}

        {/* Add project button */}
        <button
          className="w-full aspect-square flex items-center justify-center mx-auto rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          title="Add Project"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Bottom actions */}
      <div className="py-2 border-t border-zinc-800 space-y-1">
        <button
          className="w-full aspect-square flex items-center justify-center mx-auto rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          title="Settings"
        >
          <Settings size={20} />
        </button>
        <button
          className="w-full aspect-square flex items-center justify-center mx-auto rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          title="Help"
        >
          <HelpCircle size={20} />
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Create packages/desktop/src/renderer/components/Layout.tsx**

```typescript
import React from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '../store';
import { TitleBar } from './TitleBar';
import { ProjectRail } from './ProjectRail';

interface LayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
}

function ResizeHandle({ direction }: { direction: 'horizontal' | 'vertical' }): React.ReactElement {
  return (
    <PanelResizeHandle
      className={`
        ${direction === 'horizontal' ? 'w-1' : 'h-1'}
        bg-transparent hover:bg-zinc-600 transition-colors
        flex items-center justify-center
      `}
    >
      <div
        className={`
          ${direction === 'horizontal' ? 'w-px h-8' : 'w-8 h-px'}
          bg-zinc-700
        `}
      />
    </PanelResizeHandle>
  );
}

export function Layout({ leftPanel, centerPanel, rightPanel, bottomPanel }: LayoutProps): React.ReactElement {
  const { panelCollapsed, togglePanel } = useUIStore();

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        <ProjectRail />

        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left Panel */}
          {!panelCollapsed.left && (
            <>
              <Panel defaultSize={20} minSize={15} maxSize={40}>
                <div className="h-full bg-zinc-900 border-r border-zinc-800">
                  {leftPanel}
                </div>
              </Panel>
              <ResizeHandle direction="horizontal" />
            </>
          )}

          {/* Center + Bottom */}
          <Panel defaultSize={60}>
            <PanelGroup direction="vertical">
              {/* Center */}
              <Panel defaultSize={panelCollapsed.bottom ? 100 : 70}>
                <div className="h-full bg-zinc-950">{centerPanel}</div>
              </Panel>

              {/* Bottom Panel */}
              {!panelCollapsed.bottom && (
                <>
                  <ResizeHandle direction="vertical" />
                  <Panel defaultSize={30} minSize={15} maxSize={50}>
                    <div className="h-full bg-zinc-900 border-t border-zinc-800">
                      {bottomPanel}
                    </div>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          {/* Right Panel */}
          {!panelCollapsed.right && (
            <>
              <ResizeHandle direction="horizontal" />
              <Panel defaultSize={20} minSize={15} maxSize={40}>
                <div className="h-full bg-zinc-900 border-l border-zinc-800">
                  {rightPanel}
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  );
}
```

**Step 4: Create packages/desktop/src/renderer/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

**Step 5: Update packages/desktop/src/renderer/App.tsx**

```typescript
import React from 'react';
import { Layout } from './components/Layout';
import { useDaemon } from './hooks/useDaemon';

function LeftPanel(): React.ReactElement {
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-zinc-300 mb-4">Sessions</h2>
      <p className="text-xs text-zinc-500">No sessions yet</p>
    </div>
  );
}

function CenterPanel(): React.ReactElement {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-bold mb-2">Welcome to Mainframe</h1>
        <p className="text-zinc-400 text-sm">Select a project to get started</p>
      </div>
    </div>
  );
}

function RightPanel(): React.ReactElement {
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-zinc-300 mb-4">Details</h2>
      <p className="text-xs text-zinc-500">Select a session to view details</p>
    </div>
  );
}

function BottomPanel(): React.ReactElement {
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-zinc-300 mb-2">Terminal</h2>
      <p className="text-xs text-zinc-500">Terminal output will appear here</p>
    </div>
  );
}

export default function App(): React.ReactElement {
  useDaemon();

  return (
    <Layout
      leftPanel={<LeftPanel />}
      centerPanel={<CenterPanel />}
      rightPanel={<RightPanel />}
      bottomPanel={<BottomPanel />}
    />
  );
}
```

**Step 6: Build and test**

Run: `cd packages/desktop && pnpm dev`
Expected: App shows with resizable panel layout

Run: `git add . && git commit -m "feat(desktop): add panel layout system with project rail"`

---

## Task 13: Implement Chat Interface

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/ChatContainer.tsx`
- Create: `packages/desktop/src/renderer/components/chat/MessageList.tsx`
- Create: `packages/desktop/src/renderer/components/chat/ChatInput.tsx`
- Create: `packages/desktop/src/renderer/components/chat/MessageItem.tsx`

**Step 1: Create packages/desktop/src/renderer/components/chat/MessageItem.tsx**

```typescript
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { User, Bot, Terminal, AlertTriangle } from 'lucide-react';
import type { SessionMessage, MessageContent } from '@mainframe/types';
import { cn } from '../../lib/utils';

interface MessageItemProps {
  message: SessionMessage;
}

function ContentBlock({ content }: { content: MessageContent }): React.ReactElement | null {
  switch (content.type) {
    case 'text':
      return (
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{content.text}</ReactMarkdown>
        </div>
      );

    case 'thinking':
      return (
        <details className="text-zinc-500 text-sm">
          <summary className="cursor-pointer hover:text-zinc-400">Thinking...</summary>
          <div className="mt-2 pl-4 border-l border-zinc-700">
            {content.thinking}
          </div>
        </details>
      );

    case 'tool_use':
      return (
        <div className="bg-zinc-800 rounded-lg p-3 text-sm">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Terminal size={14} />
            <span className="font-medium">{content.name}</span>
          </div>
          <pre className="text-xs text-zinc-500 overflow-x-auto">
            {JSON.stringify(content.input, null, 2)}
          </pre>
        </div>
      );

    case 'tool_result':
      return (
        <div className={cn(
          'bg-zinc-800 rounded-lg p-3 text-sm',
          content.isError && 'border border-red-900/50'
        )}>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
            {content.content}
          </pre>
        </div>
      );

    case 'error':
      return (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertTriangle size={14} />
          <span>{content.message}</span>
        </div>
      );

    default:
      return null;
  }
}

export function MessageItem({ message }: MessageItemProps): React.ReactElement {
  const isUser = message.type === 'user';
  const Icon = isUser ? User : Bot;

  return (
    <div className={cn('flex gap-3 py-4', isUser && 'bg-zinc-900/50')}>
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
        isUser ? 'bg-zinc-700' : 'bg-violet-600'
      )}>
        <Icon size={16} />
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {message.content.map((content, i) => (
          <ContentBlock key={i} content={content} />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Create packages/desktop/src/renderer/components/chat/MessageList.tsx**

```typescript
import React, { useRef, useEffect } from 'react';
import type { SessionMessage } from '@mainframe/types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: SessionMessage[];
}

export function MessageList({ messages }: MessageListProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    const container = containerRef.current;
    if (!container) return;

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <p>Send a message to start the conversation</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

**Step 3: Create packages/desktop/src/renderer/components/chat/ChatInput.tsx**

```typescript
import React, { useState, useRef, useCallback } from 'react';
import { Send, Paperclip, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
}

export function ChatInput({ onSend, onStop, disabled, isRunning }: ChatInputProps): React.ReactElement {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  return (
    <div className="border-t border-zinc-800 p-4">
      <div className="flex items-end gap-2">
        <button
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Attach file"
        >
          <Paperclip size={18} />
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Send a message..."
            disabled={disabled}
            rows={1}
            className={cn(
              'w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm resize-none',
              'placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
        </div>

        {isRunning ? (
          <button
            onClick={onStop}
            className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
            title="Stop"
          >
            <Square size={18} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className={cn(
              'p-2 rounded-lg transition-colors',
              value.trim() && !disabled
                ? 'bg-violet-600 hover:bg-violet-700 text-white'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            )}
            title="Send"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Create packages/desktop/src/renderer/components/chat/ChatContainer.tsx**

```typescript
import React from 'react';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { useSession } from '../../hooks/useDaemon';
import { useSessionsStore } from '../../store';

export function ChatContainer(): React.ReactElement {
  const { activeSessionId } = useSessionsStore();
  const { messages, sendMessage } = useSession(activeSessionId);

  if (!activeSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <p className="text-lg mb-2">No active session</p>
          <p className="text-sm">Create a new session to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} />
      </div>
      <ChatInput onSend={sendMessage} />
    </div>
  );
}

export { MessageList } from './MessageList';
export { ChatInput } from './ChatInput';
export { MessageItem } from './MessageItem';
```

**Step 5: Commit**

Run: `git add . && git commit -m "feat(desktop): add chat interface components"`

---

## Task 14: Implement Session List Panel

**Files:**
- Create: `packages/desktop/src/renderer/components/panels/SessionsPanel.tsx`
- Create: `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`

**Step 1: Create packages/desktop/src/renderer/components/panels/SessionsPanel.tsx**

```typescript
import React, { useState } from 'react';
import { Plus, MessageSquare, Clock, DollarSign } from 'lucide-react';
import { useSessionsStore, useProjectsStore } from '../../store';
import { useProject } from '../../hooks/useDaemon';
import { cn } from '../../lib/utils';

export function SessionsPanel(): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const { sessions, activeSessionId, setActiveSession } = useSessionsStore();
  const { createSession } = useProject(activeProjectId);
  const [creating, setCreating] = useState(false);

  const handleCreate = () => {
    createSession('claude');
    setCreating(false);
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatCost = (cost: number) => {
    return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Sessions</h2>
        <button
          onClick={() => setCreating(true)}
          disabled={!activeProjectId}
          className={cn(
            'p-1 rounded hover:bg-zinc-700 transition-colors',
            activeProjectId ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 cursor-not-allowed'
          )}
          title="New Session"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Create session dialog */}
      {creating && (
        <div className="p-3 border-b border-zinc-800 bg-zinc-800/50">
          <p className="text-xs text-zinc-400 mb-2">Create new session with:</p>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex-1 py-1.5 px-3 text-xs bg-violet-600 hover:bg-violet-700 rounded transition-colors"
            >
              Claude
            </button>
            <button
              onClick={() => setCreating(false)}
              className="py-1.5 px-3 text-xs bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {!activeProjectId ? (
          <div className="p-4 text-center text-zinc-500 text-xs">
            Select a project to view sessions
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-4 text-center text-zinc-500 text-xs">
            No sessions yet
          </div>
        ) : (
          <div className="py-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                className={cn(
                  'w-full px-3 py-2 text-left transition-colors',
                  activeSessionId === session.id
                    ? 'bg-zinc-700'
                    : 'hover:bg-zinc-800'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare size={14} className="text-violet-400" />
                  <span className="text-sm font-medium truncate">
                    Session {session.id.slice(0, 8)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {formatTime(session.updatedAt)}
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign size={10} />
                    {formatCost(session.totalCost)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create packages/desktop/src/renderer/components/panels/LeftPanel.tsx**

```typescript
import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { MessageSquare, FolderTree, Cog } from 'lucide-react';
import { useUIStore } from '../../store';
import { SessionsPanel } from './SessionsPanel';
import { cn } from '../../lib/utils';

export function LeftPanel(): React.ReactElement {
  const { leftPanelTab, setLeftPanelTab } = useUIStore();

  return (
    <Tabs.Root
      value={leftPanelTab}
      onValueChange={(v) => setLeftPanelTab(v as typeof leftPanelTab)}
      className="h-full flex flex-col"
    >
      <Tabs.List className="flex border-b border-zinc-800">
        <Tabs.Trigger
          value="sessions"
          className={cn(
            'flex-1 py-2 px-3 text-xs font-medium transition-colors',
            'border-b-2 border-transparent',
            leftPanelTab === 'sessions'
              ? 'text-zinc-200 border-violet-500'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <MessageSquare size={14} className="inline mr-1.5" />
          Sessions
        </Tabs.Trigger>
        <Tabs.Trigger
          value="files"
          className={cn(
            'flex-1 py-2 px-3 text-xs font-medium transition-colors',
            'border-b-2 border-transparent',
            leftPanelTab === 'files'
              ? 'text-zinc-200 border-violet-500'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <FolderTree size={14} className="inline mr-1.5" />
          Files
        </Tabs.Trigger>
        <Tabs.Trigger
          value="context"
          className={cn(
            'flex-1 py-2 px-3 text-xs font-medium transition-colors',
            'border-b-2 border-transparent',
            leftPanelTab === 'context'
              ? 'text-zinc-200 border-violet-500'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Cog size={14} className="inline mr-1.5" />
          Context
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="sessions" className="flex-1 overflow-hidden">
        <SessionsPanel />
      </Tabs.Content>
      <Tabs.Content value="files" className="flex-1 overflow-hidden p-4">
        <p className="text-xs text-zinc-500">File tree coming soon</p>
      </Tabs.Content>
      <Tabs.Content value="context" className="flex-1 overflow-hidden p-4">
        <p className="text-xs text-zinc-500">Context viewer coming soon</p>
      </Tabs.Content>
    </Tabs.Root>
  );
}
```

**Step 3: Update App.tsx to use new components**

```typescript
import React from 'react';
import { Layout } from './components/Layout';
import { LeftPanel } from './components/panels/LeftPanel';
import { ChatContainer } from './components/chat/ChatContainer';
import { useDaemon } from './hooks/useDaemon';

function RightPanel(): React.ReactElement {
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-zinc-300 mb-4">Details</h2>
      <p className="text-xs text-zinc-500">Select a session to view details</p>
    </div>
  );
}

function BottomPanel(): React.ReactElement {
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-zinc-300 mb-2">Terminal</h2>
      <p className="text-xs text-zinc-500">Terminal output will appear here</p>
    </div>
  );
}

export default function App(): React.ReactElement {
  useDaemon();

  return (
    <Layout
      leftPanel={<LeftPanel />}
      centerPanel={<ChatContainer />}
      rightPanel={<RightPanel />}
      bottomPanel={<BottomPanel />}
    />
  );
}
```

**Step 4: Commit**

Run: `git add . && git commit -m "feat(desktop): add session list and left panel"`

---

## Task 15: Implement Permission Dialog

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/PermissionDialog.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/ChatContainer.tsx`

**Step 1: Create packages/desktop/src/renderer/components/chat/PermissionDialog.tsx**

```typescript
import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ShieldAlert, Check, X, Shield } from 'lucide-react';
import type { PermissionRequest } from '@mainframe/types';
import { cn } from '../../lib/utils';

interface PermissionDialogProps {
  request: PermissionRequest;
  onRespond: (behavior: 'allow' | 'deny', alwaysAllow?: string[]) => void;
}

export function PermissionDialog({ request, onRespond }: PermissionDialogProps): React.ReactElement {
  const handleAllow = () => onRespond('allow');
  const handleAlwaysAllow = () => onRespond('allow', request.suggestions);
  const handleDeny = () => onRespond('deny');

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[85vh] bg-zinc-900 rounded-lg border border-zinc-700 shadow-xl overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
            <div className="p-2 rounded-full bg-yellow-500/10">
              <ShieldAlert className="text-yellow-500" size={20} />
            </div>
            <div>
              <Dialog.Title className="font-semibold">Permission Required</Dialog.Title>
              <Dialog.Description className="text-sm text-zinc-400">
                Claude wants to use {request.toolName}
              </Dialog.Description>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 max-h-[300px] overflow-y-auto">
            <div className="bg-zinc-800 rounded-lg p-3 text-sm">
              <div className="text-zinc-400 mb-2 font-medium">Input:</div>
              <pre className="text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(request.input, null, 2)}
              </pre>
            </div>

            {request.decisionReason && (
              <div className="mt-3 text-xs text-zinc-500">
                <span className="font-medium">Reason:</span> {request.decisionReason}
              </div>
            )}

            {request.suggestions.length > 0 && (
              <div className="mt-3 text-xs text-zinc-500">
                <span className="font-medium">Suggested patterns:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {request.suggestions.map((suggestion, i) => (
                    <code key={i} className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">
                      {suggestion}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-zinc-800 flex justify-end gap-2">
            <button
              onClick={handleDeny}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors flex items-center gap-2"
            >
              <X size={16} />
              Deny
            </button>
            {request.suggestions.length > 0 && (
              <button
                onClick={handleAlwaysAllow}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors flex items-center gap-2"
              >
                <Shield size={16} />
                Always Allow
              </button>
            )}
            <button
              onClick={handleAllow}
              className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors flex items-center gap-2"
            >
              <Check size={16} />
              Allow
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**Step 2: Update ChatContainer.tsx**

```typescript
import React from 'react';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { PermissionDialog } from './PermissionDialog';
import { useSession } from '../../hooks/useDaemon';
import { useSessionsStore } from '../../store';

export function ChatContainer(): React.ReactElement {
  const { activeSessionId } = useSessionsStore();
  const { messages, pendingPermission, sendMessage, respondToPermission } = useSession(activeSessionId);

  if (!activeSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <p className="text-lg mb-2">No active session</p>
          <p className="text-sm">Create a new session to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} />
      </div>
      <ChatInput
        onSend={sendMessage}
        disabled={!!pendingPermission}
      />

      {pendingPermission && (
        <PermissionDialog
          request={pendingPermission}
          onRespond={respondToPermission}
        />
      )}
    </div>
  );
}

export { MessageList } from './MessageList';
export { ChatInput } from './ChatInput';
export { MessageItem } from './MessageItem';
export { PermissionDialog } from './PermissionDialog';
```

**Step 3: Commit**

Run: `git add . && git commit -m "feat(desktop): add permission request dialog"`

---

## Task 16: Implement Status Bar

**Files:**
- Create: `packages/desktop/src/renderer/components/StatusBar.tsx`
- Modify: `packages/desktop/src/renderer/components/Layout.tsx`

**Step 1: Create packages/desktop/src/renderer/components/StatusBar.tsx**

```typescript
import React from 'react';
import { Circle, Zap, Clock, DollarSign } from 'lucide-react';
import { useSessionsStore } from '../store';
import { cn } from '../lib/utils';

export function StatusBar(): React.ReactElement {
  const { activeSessionId, sessions } = useSessionsStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  };

  return (
    <div className="h-6 bg-zinc-900 border-t border-zinc-800 px-3 flex items-center justify-between text-xs">
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Circle size={8} className="fill-green-500 text-green-500" />
          <span>Connected</span>
        </div>

        {/* Active agent */}
        {activeSession && (
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Zap size={12} className="text-violet-400" />
            <span>Claude {activeSession.model || 'Sonnet'}</span>
          </div>
        )}
      </div>

      {activeSession && (
        <div className="flex items-center gap-4 text-zinc-500">
          {/* Tokens */}
          <div className="flex items-center gap-1">
            <span>{formatTokens(activeSession.totalTokensInput)} in</span>
            <span>/</span>
            <span>{formatTokens(activeSession.totalTokensOutput)} out</span>
          </div>

          {/* Cost */}
          <div className="flex items-center gap-1">
            <DollarSign size={12} />
            <span>{activeSession.totalCost.toFixed(3)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Update Layout.tsx to include StatusBar**

```typescript
import React from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '../store';
import { TitleBar } from './TitleBar';
import { ProjectRail } from './ProjectRail';
import { StatusBar } from './StatusBar';

interface LayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
}

function ResizeHandle({ direction }: { direction: 'horizontal' | 'vertical' }): React.ReactElement {
  return (
    <PanelResizeHandle
      className={`
        ${direction === 'horizontal' ? 'w-1' : 'h-1'}
        bg-transparent hover:bg-zinc-600 transition-colors
        flex items-center justify-center
      `}
    >
      <div
        className={`
          ${direction === 'horizontal' ? 'w-px h-8' : 'w-8 h-px'}
          bg-zinc-700
        `}
      />
    </PanelResizeHandle>
  );
}

export function Layout({ leftPanel, centerPanel, rightPanel, bottomPanel }: LayoutProps): React.ReactElement {
  const { panelCollapsed } = useUIStore();

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        <ProjectRail />

        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left Panel */}
          {!panelCollapsed.left && (
            <>
              <Panel defaultSize={20} minSize={15} maxSize={40}>
                <div className="h-full bg-zinc-900 border-r border-zinc-800">
                  {leftPanel}
                </div>
              </Panel>
              <ResizeHandle direction="horizontal" />
            </>
          )}

          {/* Center + Bottom */}
          <Panel defaultSize={60}>
            <PanelGroup direction="vertical">
              {/* Center */}
              <Panel defaultSize={panelCollapsed.bottom ? 100 : 70}>
                <div className="h-full bg-zinc-950">{centerPanel}</div>
              </Panel>

              {/* Bottom Panel */}
              {!panelCollapsed.bottom && (
                <>
                  <ResizeHandle direction="vertical" />
                  <Panel defaultSize={30} minSize={15} maxSize={50}>
                    <div className="h-full bg-zinc-900 border-t border-zinc-800">
                      {bottomPanel}
                    </div>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          {/* Right Panel */}
          {!panelCollapsed.right && (
            <>
              <ResizeHandle direction="horizontal" />
              <Panel defaultSize={20} minSize={15} maxSize={40}>
                <div className="h-full bg-zinc-900 border-l border-zinc-800">
                  {rightPanel}
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      <StatusBar />
    </div>
  );
}
```

**Step 3: Commit**

Run: `git add . && git commit -m "feat(desktop): add status bar with token and cost tracking"`

---

## Task 17: Add Project Open Dialog

**Files:**
- Create: `packages/desktop/src/renderer/components/dialogs/OpenProjectDialog.tsx`
- Modify: `packages/desktop/src/renderer/components/ProjectRail.tsx`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/index.ts`

**Step 1: Update packages/desktop/src/preload/index.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

export interface MainframeAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  openDirectoryDialog: () => Promise<string | null>;
}

const api: MainframeAPI = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
};

contextBridge.exposeInMainWorld('mainframe', api);
```

**Step 2: Update packages/desktop/src/main/index.ts**

```typescript
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let daemon: ChildProcess | null = null;

function startDaemon(): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode: assuming daemon is running');
    return;
  }

  const daemonPath = join(__dirname, '../../core/dist/index.js');
  daemon = spawn('node', [daemonPath], {
    stdio: 'inherit',
    detached: false,
  });

  daemon.on('error', (error) => {
    console.error('Daemon error:', error);
  });
}

function setupIPC(): void {
  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Directory',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  setupIPC();
  startDaemon();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (daemon) {
    daemon.kill();
  }
});
```

**Step 3: Create packages/desktop/src/renderer/types/global.d.ts**

```typescript
import type { MainframeAPI } from '../../preload';

declare global {
  interface Window {
    mainframe: MainframeAPI;
  }
}

export {};
```

**Step 4: Update packages/desktop/src/renderer/components/ProjectRail.tsx**

```typescript
import React, { useCallback } from 'react';
import { FolderOpen, Plus, Settings, HelpCircle } from 'lucide-react';
import { useProjectsStore } from '../store';
import { daemonClient } from '../lib/client';
import { cn } from '../lib/utils';

export function ProjectRail(): React.ReactElement {
  const { projects, activeProjectId, setActiveProject, addProject } = useProjectsStore();

  const handleAddProject = useCallback(async () => {
    const path = await window.mainframe.openDirectoryDialog();
    if (!path) return;

    try {
      const project = await daemonClient.createProject(path);
      addProject(project);
      setActiveProject(project.id);
    } catch (error) {
      console.error('Failed to add project:', error);
    }
  }, [addProject, setActiveProject]);

  return (
    <div className="w-12 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      {/* Project icons */}
      <div className="flex-1 py-2 space-y-1 overflow-y-auto">
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => setActiveProject(project.id)}
            className={cn(
              'w-10 h-10 mx-auto flex items-center justify-center',
              'rounded-lg transition-colors',
              activeProjectId === project.id
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            )}
            title={project.name}
          >
            <FolderOpen size={20} />
          </button>
        ))}

        {/* Add project button */}
        <button
          onClick={handleAddProject}
          className="w-10 h-10 mx-auto flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          title="Add Project"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Bottom actions */}
      <div className="py-2 border-t border-zinc-800 space-y-1">
        <button
          className="w-10 h-10 mx-auto flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          title="Settings"
        >
          <Settings size={20} />
        </button>
        <button
          className="w-10 h-10 mx-auto flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          title="Help"
        >
          <HelpCircle size={20} />
        </button>
      </div>
    </div>
  );
}
```

**Step 5: Commit**

Run: `git add . && git commit -m "feat(desktop): add project directory picker"`

---

## Task 18: Final Integration and Testing

**Files:**
- Modify: Root `package.json`
- Create: `README.md`

**Step 1: Update root package.json scripts**

```json
{
  "name": "mainframe",
  "version": "0.1.0",
  "private": true,
  "description": "AI-native development environment for orchestrating agents",
  "scripts": {
    "dev": "pnpm --filter @mainframe/core run dev & sleep 2 && pnpm --filter @mainframe/desktop run dev",
    "dev:core": "pnpm --filter @mainframe/core run dev",
    "dev:desktop": "pnpm --filter @mainframe/desktop run dev",
    "build": "pnpm -r run build",
    "build:types": "pnpm --filter @mainframe/types run build",
    "build:core": "pnpm --filter @mainframe/core run build",
    "build:desktop": "pnpm --filter @mainframe/desktop run build",
    "lint": "pnpm -r run lint",
    "test": "pnpm -r run test",
    "clean": "pnpm -r run clean",
    "package": "pnpm build && pnpm --filter @mainframe/desktop run package"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

**Step 2: Create README.md**

```markdown
# Mainframe

AI-native development environment for orchestrating agents.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in development
pnpm dev
```

## Architecture

- **@mainframe/types** - Shared TypeScript types
- **@mainframe/core** - Node.js daemon (WebSocket + REST API)
- **@mainframe/desktop** - Electron + React desktop app

## Development

Run the daemon and desktop app separately for better debugging:

```bash
# Terminal 1: Run the daemon
pnpm dev:core

# Terminal 2: Run the desktop app
pnpm dev:desktop
```

## Tech Stack

- Node.js 20+
- TypeScript
- Electron 28+
- React 18+
- Tailwind CSS
- shadcn/ui components
- SQLite (better-sqlite3)
- Zustand for state management
- react-resizable-panels for layout

## License

MIT
```

**Step 3: Install all dependencies and test**

Run: `pnpm install`
Expected: All dependencies installed

Run: `pnpm build`
Expected: All packages build successfully

Run: `pnpm dev`
Expected: Daemon starts, then Electron app opens showing the Mainframe UI

**Step 4: Final commit**

Run: `git add . && git commit -m "chore: add dev scripts and README"`

---

## Summary

This plan implements Mainframe Milestone 1 with:

1. **Monorepo structure** with pnpm workspaces
2. **Shared types package** for type safety across packages
3. **Node.js daemon** with:
   - SQLite database for projects and sessions
   - Claude CLI adapter with NDJSON streaming
   - Session manager with lifecycle handling
   - HTTP REST API + WebSocket for real-time events
4. **Electron desktop app** with:
   - JetBrains-style resizable panel layout
   - Project rail for quick switching
   - Session list with creation
   - Chat interface with message rendering
   - Permission request dialog
   - Status bar with token/cost tracking
   - Native directory picker

**Plan complete and saved to `docs/plans/2026-02-04-mainframe-m1.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**