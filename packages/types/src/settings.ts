export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'yolo';

export interface ProviderConfig {
  defaultModel?: string;
  defaultMode?: 'default' | 'acceptEdits' | 'yolo' | 'plan';
  planExecutionMode?: 'default' | 'acceptEdits' | 'yolo';
  executablePath?: string;
}

export interface GeneralConfig {
  worktreeDir: string;
}

export const GENERAL_DEFAULTS: GeneralConfig = {
  worktreeDir: '.worktrees',
};
