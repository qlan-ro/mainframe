/**
 * Warm-chrome status icon + dot helpers shared by ToolFallback and future
 * per-tool-family card components.
 */
import { AlertCircleIcon, CheckIcon, LoaderIcon, XCircleIcon } from 'lucide-react';
import type { ToolCallMessagePartStatus } from '@assistant-ui/react';

export type ToolStatus = ToolCallMessagePartStatus['type'];

/** Maps assistant-ui tool status → lucide icon component. */
export const STATUS_ICON: Record<ToolStatus, React.ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
  'requires-action': AlertCircleIcon,
};

/**
 * Maps assistant-ui tool status → warm-chrome Tailwind class for the status
 * dot. Uses real --mf-* token names; no /opacity modifier (CSS-var hex trap).
 */
export const STATUS_DOT_CLASS: Record<ToolStatus, string> = {
  running: 'bg-mf-warning',
  complete: 'bg-mf-success',
  incomplete: 'bg-destructive',
  'requires-action': 'bg-primary',
};
