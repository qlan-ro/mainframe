import { z } from 'zod';
import { NOTIFICATION_DEFAULTS, type NotificationConfig } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';

/**
 * Per-group runtime-shape validation for the stored JSON blob. We validate
 * each group independently so a single bad leaf (e.g. someone hand-edits
 * `permission.toolRequest` to a string) doesn't make us discard the user's
 * other valid overrides — which would silently re-enable notifications they
 * had turned off.
 */
const ChatGroupSchema = z.object({ taskComplete: z.boolean(), sessionError: z.boolean() }).partial();
const PermissionGroupSchema = z
  .object({ toolRequest: z.boolean(), userQuestion: z.boolean(), planApproval: z.boolean() })
  .partial();
const OtherGroupSchema = z.object({ plugin: z.boolean() }).partial();

function salvage<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * Read the notification config from the settings DB. Falls back to defaults
 * (everything enabled) if no row exists or the JSON is malformed. Each group
 * (chat / permission / other) is validated independently; corruption in one
 * group falls back to that group's defaults without disturbing the others.
 *
 * Synchronous: settings reads are a single SQLite point lookup, called from
 * event-handler hot paths.
 */
export function readNotificationConfig(db: DatabaseManager): NotificationConfig {
  const raw = db.settings.get('general', 'notifications');
  if (!raw) return NOTIFICATION_DEFAULTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* expected: malformed stored JSON → fall back to defaults */
    return NOTIFICATION_DEFAULTS;
  }
  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  return {
    chat: { ...NOTIFICATION_DEFAULTS.chat, ...salvage(ChatGroupSchema, root.chat) },
    permission: { ...NOTIFICATION_DEFAULTS.permission, ...salvage(PermissionGroupSchema, root.permission) },
    other: { ...NOTIFICATION_DEFAULTS.other, ...salvage(OtherGroupSchema, root.other) },
  };
}

/** Returns true if the OS notification for a permission request should fire, given the tool name. */
export function shouldNotifyPermission(config: NotificationConfig, toolName: string | undefined): boolean {
  if (toolName === 'AskUserQuestion') return config.permission.userQuestion;
  if (toolName === 'ExitPlanMode') return config.permission.planApproval;
  return config.permission.toolRequest;
}
