/**
 * Warm-chrome tint palettes for Tasks/Todos surface.
 *
 * Returns Tailwind utility class strings for status, type, and priority.
 *
 * typeTint/priorityTint/priorityDotClass are bespoke hex tints ported
 * verbatim from the design's TD_TYPE/TD_PRI palettes (12-todos.jsx:12-27,
 * finding 9.3) — arbitrary-value Tailwind classes (`bg-[#hex]/NN`), the
 * established pattern for one-off design hex in this codebase (see
 * WfLibrary.tsx `bg-[#7a4d9e]/10`). `feature` and chip-backed entries
 * (documentation/wont_fix/invalid/low) map to real theme tokens
 * (`bg-primary`, `bg-mf-chip`) rather than inventing new CSS vars.
 * statusTint/statusDotColor have no design ground truth (not defined in
 * 12-todos.jsx) and keep generic Tailwind swatches.
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
 * Matches the design's TD_TYPE palette (12-todos.jsx:12-20).
 */
export function typeTint(type: TodoType): string {
  switch (type) {
    case 'bug':
      return 'bg-[#c4302b]/10 text-[#c4302b]';
    case 'feature':
      return 'bg-primary/10 text-primary';
    case 'enhancement':
      return 'bg-[#7b3ff2]/10 text-[#7b3ff2]';
    case 'documentation':
      return 'bg-mf-chip text-muted-foreground';
    case 'question':
      return 'bg-[#b9770e]/[0.12] text-[#b9770e]';
    case 'wont_fix':
      return 'bg-mf-chip text-mf-text-3';
    case 'duplicate':
      return 'bg-[#c2540a]/10 text-[#c2540a]';
    case 'invalid':
      return 'bg-mf-chip text-mf-text-3';
    default:
      return 'bg-mf-chip text-muted-foreground';
  }
}

/**
 * Background + text tint for a priority pill.
 * Matches the design's TD_PRI palette (12-todos.jsx:21-26).
 */
export function priorityTint(priority: TodoPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-[#c4302b]/10 text-[#c4302b]';
    case 'high':
      return 'bg-[#c2540a]/10 text-[#c2540a]';
    case 'medium':
      return 'bg-[#b9770e]/[0.12] text-[#a76d0c]';
    case 'low':
      return 'bg-mf-chip text-mf-text-3';
    default:
      return 'bg-mf-chip text-muted-foreground';
  }
}

/**
 * Leading dot color class for a priority pill.
 * Matches the prototype TdPill dot palette:
 * critical=#c4302b, high=#e8730f, medium=#e0a019, low=#c4c2bd
 */
export function priorityDotClass(priority: TodoPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-[#c4302b]';
    case 'high':
      return 'bg-[#e8730f]';
    case 'medium':
      return 'bg-[#e0a019]';
    case 'low':
    default:
      return 'bg-[#c4c2bd]';
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
