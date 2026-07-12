/**
 * Warm-chrome tint palettes for Tasks/Todos surface.
 *
 * Returns Tailwind utility class strings for status, type, and priority.
 *
 * typeTint/priorityTint/priorityDotClass map to semantic theme tokens
 * (`--mf-task-type-*` / `--mf-priority-*`, defined once in globals.css from
 * the design's TD_TYPE/TD_PRI palettes, 12-todos.jsx:12-27). `feature` and
 * chip-backed entries (documentation/wont_fix/invalid/low) reuse existing
 * tokens (`bg-primary`, `bg-mf-chip`). statusTint/statusDotColor have no
 * design ground truth (not defined in 12-todos.jsx) and keep generic Tailwind
 * swatches.
 */
import type { TodoStatus, TodoType, TodoPriority } from '@/lib/api/todos';

/**
 * Background + text tint for a todo status dot/badge.
 * Returns a Tailwind class string.
 */
export function statusTint(status: TodoStatus): string {
  switch (status) {
    case 'open':
      return 'bg-muted text-muted-foreground';
    case 'in_progress':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'done':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/**
 * Tint background for a todo type badge; the hue lives on the background only,
 * the label ink stays neutral (foreground/muted) for contrast in every theme.
 * Background matches the design's TD_TYPE palette (12-todos.jsx:12-20).
 */
export function typeTint(type: TodoType): string {
  switch (type) {
    case 'bug':
      return 'bg-mf-task-type-bug/10 text-foreground';
    case 'feature':
      return 'bg-primary/10 text-foreground';
    case 'enhancement':
      return 'bg-mf-task-type-enhancement/10 text-foreground';
    case 'documentation':
      return 'bg-mf-chip text-muted-foreground';
    case 'question':
      return 'bg-mf-task-type-question/[0.12] text-foreground';
    case 'wont_fix':
      return 'bg-mf-chip text-muted-foreground';
    case 'duplicate':
      return 'bg-mf-task-type-duplicate/10 text-foreground';
    case 'invalid':
      return 'bg-mf-chip text-muted-foreground';
    default:
      return 'bg-mf-chip text-muted-foreground';
  }
}

/**
 * Tint background for a priority pill; the hue is carried by the background and
 * the leading dot only, the label ink stays neutral for contrast.
 * Background matches the design's TD_PRI palette (12-todos.jsx:21-26).
 */
export function priorityTint(priority: TodoPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-mf-priority-critical/10 text-foreground';
    case 'high':
      return 'bg-mf-priority-high/10 text-foreground';
    case 'medium':
      return 'bg-mf-priority-medium/[0.12] text-foreground';
    case 'low':
      return 'bg-mf-chip text-muted-foreground';
    default:
      return 'bg-mf-chip text-muted-foreground';
  }
}

/**
 * Leading dot color class for a priority pill.
 * Matches the prototype TdPill dot palette (--mf-priority-*-dot tokens):
 * critical=#c4302b, high=#e8730f, medium=#e0a019, low=#c4c2bd
 */
export function priorityDotClass(priority: TodoPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-mf-priority-critical-dot';
    case 'high':
      return 'bg-mf-priority-high-dot';
    case 'medium':
      return 'bg-mf-priority-medium-dot';
    case 'low':
    default:
      return 'bg-mf-priority-low-dot';
  }
}

/** Dot color class for a status indicator dot. */
export function statusDotColor(status: TodoStatus): string {
  switch (status) {
    case 'open':
      return 'bg-muted-foreground';
    case 'in_progress':
      return 'bg-blue-500';
    case 'done':
      return 'bg-green-500';
    default:
      return 'bg-muted-foreground';
  }
}
