/**
 * select-logs — pure log-entry selector.
 *
 * Filters the sandbox log output to entries matching an exact scope key and
 * process name. Kept pure so it is trivially unit-testable without React.
 */
import type { LogEntry } from '@/store/sandbox';

/**
 * Return log entries whose `scopeKey` and `name` match the given arguments.
 * Both must match exactly (strict equality).
 */
export function selectLogs(logs: ReadonlyArray<LogEntry>, scopeKey: string, name: string): LogEntry[] {
  return logs.filter((l) => l.scopeKey === scopeKey && l.name === name);
}
