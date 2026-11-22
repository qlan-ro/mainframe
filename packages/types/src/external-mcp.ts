import type { ExecutionMode } from './settings.js';

export type ExternalMcpAccess = 'read' | 'control';

export interface CreateExternalMcpClient {
  name: string;
  projectIds: string[];
  access: ExternalMcpAccess;
  maxPermissionMode: ExecutionMode;
  /** Lets a control client answer permission prompts, questions and plan approvals. */
  answerPrompts: boolean;
}

export interface ExternalMcpClient extends CreateExternalMcpClient {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ExternalMcpClients {
  clients: ExternalMcpClient[];
  endpoint: string;
}

export interface CreatedExternalMcpClient {
  client: ExternalMcpClient;
  token: string;
}
