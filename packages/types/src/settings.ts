import { z } from 'zod';
import type { EffortLevel } from './adapter.js';

export const EXECUTION_MODES = ['default', 'acceptEdits', 'auto', 'yolo'] as const;
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
  /** Model the CLI uses for its own background calls on a CLIProxyAPI session,
   *  whose catalog has no Haiku to fall back on. Empty = pick from the catalog. */
  cliproxySmallFastModel?: string;
}

/**
 * Patch shape for updating provider settings. The enum-valued fields additionally
 * accept `''` — the clear sentinel the server deletes on (→ the chat inherits the
 * model default). Use this for the update path instead of casting `''` into the
 * persisted `ProviderConfig`, whose unions don't include it.
 */
export type ProviderConfigUpdate = Omit<
  Partial<ProviderConfig>,
  'defaultEffort' | 'defaultFast' | 'defaultUltracode' | 'defaultAdaptiveThinking' | 'personality' | 'reasoningSummary'
> & {
  defaultEffort?: EffortLevel | '';
  defaultFast?: 'true' | 'false' | '';
  defaultUltracode?: 'true' | 'false' | '';
  defaultAdaptiveThinking?: 'true' | 'false' | '';
  personality?: 'none' | 'friendly' | 'pragmatic' | '';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none' | '';
};

export interface NotificationConfig {
  chat: { taskComplete: boolean; sessionError: boolean; attentionRequest: boolean };
  permission: { toolRequest: boolean; userQuestion: boolean; planApproval: boolean };
  other: { plugin: boolean };
}

export const UPDATE_CHANNELS = ['stable', 'prerelease'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export interface GeneralConfig {
  idleCompaction: { enabled: boolean };
  worktreeDir: string;
  notifications: NotificationConfig;
  updateChannel: UpdateChannel;
  /** Adapter id used to seed new chats. `null` = auto-pick the first installed adapter. */
  defaultAdapterId: string | null;
}

export const NOTIFICATION_DEFAULTS: NotificationConfig = {
  chat: { taskComplete: true, sessionError: true, attentionRequest: true },
  permission: { toolRequest: true, userQuestion: true, planApproval: true },
  other: { plugin: true },
};

export const GENERAL_DEFAULTS: GeneralConfig = {
  idleCompaction: { enabled: false },
  worktreeDir: '.worktrees',
  notifications: NOTIFICATION_DEFAULTS,
  updateChannel: 'stable',
  defaultAdapterId: null,
};

const notificationPatchSchema = z.object({
  chat: z
    .object({
      taskComplete: z.boolean().optional(),
      sessionError: z.boolean().optional(),
      attentionRequest: z.boolean().optional(),
    })
    .optional(),
  permission: z
    .object({
      toolRequest: z.boolean().optional(),
      userQuestion: z.boolean().optional(),
      planApproval: z.boolean().optional(),
    })
    .optional(),
  other: z.object({ plugin: z.boolean().optional() }).optional(),
});
export const IdleCompactionConfigSchema = z.object({ enabled: z.boolean() });
export const GeneralConfigSchema = z
  .object({
    worktreeDir: z.string(),
    notifications: z.object({
      chat: z.object({ taskComplete: z.boolean(), sessionError: z.boolean(), attentionRequest: z.boolean() }),
      permission: z.object({ toolRequest: z.boolean(), userQuestion: z.boolean(), planApproval: z.boolean() }),
      other: z.object({ plugin: z.boolean() }),
    }),
    updateChannel: z.enum(UPDATE_CHANNELS),
    defaultAdapterId: z.string().nullable(),
    idleCompaction: IdleCompactionConfigSchema.default({ enabled: false }),
  })
  .passthrough();
export const GeneralConfigPatchSchema = z.object({
  worktreeDir: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  notifications: notificationPatchSchema.optional(),
  updateChannel: z.enum(UPDATE_CHANNELS).optional(),
  defaultAdapterId: z.string().nullable().optional(),
  idleCompaction: IdleCompactionConfigSchema.optional(),
});
export type GeneralConfigPatch = z.infer<typeof GeneralConfigPatchSchema>;
