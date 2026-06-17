/**
 * Warm-chrome tint palettes for Tasks/Todos surface.
 *
 * Returns Tailwind utility class strings for status, type, and priority.
 * Rules:
 *  - No `/opacity` modifier on CSS-var colors (phantom in Tailwind v4).
 *  - Use only real theme tokens or Tailwind named-color classes with
 *    explicit opacity utilities (e.g. `bg-red-500 opacity-15`).
 *  - All callsites use cn() to merge with additional classes.
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
 * Background + text tint for a todo type badge.
 */
export function typeTint(type: TodoType): string {
  switch (type) {
    case 'bug':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    case 'feature':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'enhancement':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    case 'documentation':
      return 'bg-muted text-muted-foreground';
    case 'question':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
    case 'wont_fix':
      return 'bg-muted text-muted-foreground';
    case 'duplicate':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
    case 'invalid':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/**
 * Background + text tint for a priority pill.
 */
export function priorityTint(priority: TodoPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    case 'high':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
    case 'medium':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
    case 'low':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/**
 * Leading dot color class for a priority pill.
 * Matches the prototype TdPill dot palette:
 * critical=#c4302b, high=#e8730f, medium=#e0a019, low=muted
 */
export function priorityDotClass(priority: TodoPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-600';
    case 'high':
      return 'bg-orange-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
    default:
      return 'bg-muted-foreground/60';
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
