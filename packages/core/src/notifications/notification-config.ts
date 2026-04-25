import { z } from 'zod';
import { NOTIFICATION_DEFAULTS, type NotificationConfig } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';

/**
 * Defensive runtime-shape validation for the stored JSON blob. The PUT route
 * already runs Zod, but a future migration, hand-edit, or downgraded daemon
 * could leave a value of the wrong shape in the DB and we don't want JS
 * truthiness coercing a string `"false"` into a `true` notification gate.
 */
const StoredNotificationsSchema = z
  .object({
    chat: z.object({ taskComplete: z.boolean(), sessionError: z.boolean() }).partial().optional(),
    permission: z
      .object({ toolRequest: z.boolean(), userQuestion: z.boolean(), planApproval: z.boolean() })
      .partial()
      .optional(),
    other: z.object({ plugin: z.boolean() }).partial().optional(),
  })
  .partial();

/**
 * Read the notification config from the settings DB. Falls back to defaults
 * (everything enabled) if no row exists, the JSON is malformed, OR the parsed
 * shape doesn't match — invalid sub-fields are dropped, valid ones survive.
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
  const checked = StoredNotificationsSchema.safeParse(parsed);
  const data = checked.success ? checked.data : {};
  return {
    chat: { ...NOTIFICATION_DEFAULTS.chat, ...data.chat },
    permission: { ...NOTIFICATION_DEFAULTS.permission, ...data.permission },
    other: { ...NOTIFICATION_DEFAULTS.other, ...data.other },
  };
}

/** Returns true if the OS notification for a permission request should fire, given the tool name. */
export function shouldNotifyPermission(config: NotificationConfig, toolName: string | undefined): boolean {
  if (toolName === 'AskUserQuestion') return config.permission.userQuestion;
  if (toolName === 'ExitPlanMode') return config.permission.planApproval;
  return config.permission.toolRequest;
}
