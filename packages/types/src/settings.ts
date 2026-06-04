import type { EffortLevel } from './adapter.js';

export const EXECUTION_MODES = ['default', 'acceptEdits', 'yolo'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export type PermissionMode = ExecutionMode | 'plan';

export interface ResolvedExecutable {
  path: string;
  source: 'config' | 'detected' | 'fallback';
  valid: boolean;
  version?: string;
}

export interface ProviderConfig {
  defaultModel?: string;
  defaultMode?: ExecutionMode;
  defaultPlanMode?: 'true' | 'false';
  executablePath?: string;
  systemPrompt?: string;
  resolvedExecutable?: ResolvedExecutable;
  defaultEffort?: EffortLevel;
  defaultFast?: 'true' | 'false';
  defaultUltracode?: 'true' | 'false';
  defaultAdaptiveThinking?: 'true' | 'false';
  personality?: 'none' | 'friendly' | 'pragmatic';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
}

export interface NotificationConfig {
  chat: { taskComplete: boolean; sessionError: boolean };
  permission: { toolRequest: boolean; userQuestion: boolean; planApproval: boolean };
  other: { plugin: boolean };
}

export interface GeneralConfig {
  worktreeDir: string;
  notifications: NotificationConfig;
}

export const NOTIFICATION_DEFAULTS: NotificationConfig = {
  chat: { taskComplete: true, sessionError: true },
  permission: { toolRequest: true, userQuestion: true, planApproval: true },
  other: { plugin: true },
};

export const GENERAL_DEFAULTS: GeneralConfig = {
  worktreeDir: '.worktrees',
  notifications: NOTIFICATION_DEFAULTS,
};
