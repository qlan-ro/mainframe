export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'yolo';

export interface ResolvedExecutable {
  path: string;
  source: 'config' | 'detected' | 'fallback';
  valid: boolean;
  version?: string;
}

export interface ProviderConfig {
  defaultModel?: string;
  defaultMode?: 'default' | 'acceptEdits' | 'yolo';
  defaultPlanMode?: 'true' | 'false';
  executablePath?: string;
  systemPrompt?: string;
  resolvedExecutable?: ResolvedExecutable;
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
