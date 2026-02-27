import type { Logger } from 'pino';
import type { Router } from 'express';
import type { ChatMessage } from './chat.js';

export type PluginCapability =
  | 'storage'
  | 'ui:panels'
  | 'ui:notifications'
  | 'daemon:public-events'
  | 'chat:read'
  | 'chat:read:content'
  | 'chat:create'
  | 'adapters'
  | 'process:exec'
  | 'http:outbound';

export type UIZone =
  | 'fullview' // replaces Left + Center + Right; trigger in TitleBar
  | 'left-panel' // replaces entire LeftPanel; trigger icon in Left Rail
  | 'right-panel' // replaces entire RightPanel; trigger icon in Right Rail
  | 'left-tab' // tab appended to LeftPanel tab strip
  | 'right-tab'; // tab appended to RightPanel tab strip

export interface PluginUIContribution {
  pluginId: string;
  zone: UIZone;
  label: string;
  icon?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  capabilities: PluginCapability[];
  /** UI contribution — required when plugin adds a panel or fullview */
  ui?: {
    zone: UIZone;
    label: string; // tooltip for rail icons; tab text for tab zones
    icon?: string; // Lucide icon name; required for fullview/left-panel/right-panel
  };
  /** Adapter plugins only */
  adapter?: {
    binaryName: string;
    displayName: string;
  };
  /** Custom commands this adapter exposes */
  commands?: Array<{ name: string; description: string }>;
}

// ─── Public daemon events (never contain message content) ────────────────────
export type PublicDaemonEventName =
  | 'chat.started'
  | 'chat.completed'
  | 'chat.error'
  | 'project.added'
  | 'project.removed';

export type PublicDaemonEvent =
  | { type: 'chat.started'; chatId: string; projectId: string; adapterId: string }
  | { type: 'chat.completed'; chatId: string; projectId: string; cost: number; durationMs: number }
  | { type: 'chat.error'; chatId: string; projectId: string; errorMessage: string }
  | { type: 'project.added'; projectId: string; path: string }
  | { type: 'project.removed'; projectId: string };

// ─── Chat events (require 'chat:read' capability) ────────────────────────────
export type ChatEventName = 'message.added' | 'message.streaming' | 'tool.called' | 'tool.result';

export type ChatEvent =
  | { type: 'message.added'; chatId: string; message: ChatMessage }
  | { type: 'message.streaming'; chatId: string; messageId: string; delta: string }
  | { type: 'tool.called'; chatId: string; toolName: string; args: unknown }
  | { type: 'tool.result'; chatId: string; toolUseId: string; content: unknown };

// ─── Service APIs exposed to plugins ─────────────────────────────────────────
export interface ChatSummary {
  id: string;
  title: string | null;
  projectId: string;
  adapterId: string;
  createdAt: string;
  totalCost: number;
}

export interface ChatServiceAPI {
  listChats(projectId: string): Promise<ChatSummary[]>;
  getChatById(chatId: string): Promise<ChatSummary | null>;
  // Only when 'chat:read:content' is declared:
  getMessages?: (chatId: string) => Promise<import('./chat.js').ChatMessage[]>;
  // Only when 'chat:create' is declared:
  createChat?: (options: {
    projectId: string;
    adapterId?: string;
    model?: string;
    initialMessage?: string;
  }) => Promise<{ chatId: string }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
}

export interface ProjectServiceAPI {
  listProjects(): Promise<ProjectSummary[]>;
  getProjectById(id: string): Promise<ProjectSummary | null>;
}

export interface AdapterRegistrationAPI {
  register(adapter: import('./adapter.js').Adapter): void;
}

// ─── PluginContext ────────────────────────────────────────────────────────────
export interface PluginDatabaseStatement<T> {
  run(...params: unknown[]): void;
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface PluginDatabaseContext {
  runMigration(sql: string): void;
  prepare<T = Record<string, unknown>>(sql: string): PluginDatabaseStatement<T>;
  transaction<T>(fn: () => T): T;
}

export interface PluginEventBus {
  emit(event: string, payload: unknown): void;
  on(event: string, handler: (payload: unknown) => void): void;
  onDaemonEvent(event: PublicDaemonEventName, handler: (event: PublicDaemonEvent) => void): void;
  onChatEvent<E extends ChatEventName>(event: E, handler: (e: Extract<ChatEvent, { type: E }>) => void): void;
}

export interface PluginUIContext {
  addPanel(opts: { zone: UIZone; label: string; icon?: string }): void;
  removePanel(): void;
  notify(options: { title: string; body: string; level?: 'info' | 'warning' | 'error' }): void;
}

export interface PluginConfig {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  getAll(): Record<string, unknown>;
}

export interface PluginAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PluginAttachmentContext {
  save(
    entityId: string,
    file: { filename: string; mimeType: string; data: string; sizeBytes: number },
  ): Promise<PluginAttachmentMeta>;
  get(entityId: string, id: string): Promise<{ data: string; meta: PluginAttachmentMeta } | null>;
  list(entityId: string): Promise<PluginAttachmentMeta[]>;
  delete(entityId: string, id: string): Promise<void>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly logger: Logger;
  onUnload(fn: () => void): void;

  // Always available
  readonly router: Router;
  readonly config: PluginConfig;
  readonly services: {
    chats: ChatServiceAPI;
    projects: ProjectServiceAPI;
  };

  // Requires 'storage'
  readonly db: PluginDatabaseContext;
  readonly attachments: PluginAttachmentContext;

  // Requires 'daemon:public-events'
  readonly events: PluginEventBus;

  // Requires 'ui:panels' or 'ui:notifications'
  readonly ui: PluginUIContext;

  // Requires 'adapters'
  readonly adapters?: AdapterRegistrationAPI;
}

// ─── Plugin entry point contract ─────────────────────────────────────────────
export interface PluginModule {
  activate(ctx: PluginContext): void | Promise<void>;
}
