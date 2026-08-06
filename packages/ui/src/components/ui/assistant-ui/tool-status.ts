/**
 * Status icon + dot helpers shared by ToolFallback and the per-tool-family cards.
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
 * Maps assistant-ui tool status → the status-dot fill. `running` is `primary`,
 * not `warning`: under v2 `warning` means wrong-but-not-broken, and a tool that
 * is still working is neither.
 */
export const STATUS_DOT_CLASS: Record<ToolStatus, string> = {
  running: 'bg-primary',
  complete: 'bg-success',
  incomplete: 'bg-destructive',
  'requires-action': 'bg-primary',
};
