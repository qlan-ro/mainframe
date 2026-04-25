import { NOTIFICATION_DEFAULTS, type NotificationConfig } from '@qlan-ro/mainframe-types';
import type { DatabaseManager } from '../db/index.js';

/**
 * Read the notification config from the settings DB. Falls back to defaults
 * (everything enabled) if no row exists or the stored JSON is malformed.
 *
 * Kept as a synchronous function so it can be called inline from event-handler
 * hot paths without restructuring them as async — settings reads are a single
 * SQLite point lookup.
 */
export function readNotificationConfig(db: DatabaseManager): NotificationConfig {
  const raw = db.settings.get('general', 'notifications');
  if (!raw) return NOTIFICATION_DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationConfig>;
    return {
      chat: { ...NOTIFICATION_DEFAULTS.chat, ...parsed.chat },
      permission: { ...NOTIFICATION_DEFAULTS.permission, ...parsed.permission },
      other: { ...NOTIFICATION_DEFAULTS.other, ...parsed.other },
    };
  } catch {
    /* expected: malformed stored JSON → fall back to defaults */
    return NOTIFICATION_DEFAULTS;
  }
}

/** Returns true if the OS notification for a permission request should fire, given the tool name. */
export function shouldNotifyPermission(config: NotificationConfig, toolName: string | undefined): boolean {
  if (toolName === 'AskUserQuestion') return config.permission.userQuestion;
  if (toolName === 'ExitPlanMode') return config.permission.planApproval;
  return config.permission.toolRequest;
}
