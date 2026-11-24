import type { ExecutionMode } from '@qlan-ro/mainframe-types';

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  default: 'Interactive',
  acceptEdits: 'Auto-Edits',
  auto: 'Auto',
  yolo: 'Unattended',
};
