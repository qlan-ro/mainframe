/**
 * The execution modes, their spelling and tone, shared by the composer's
 * permissions control, its combined chip and the plan gate.
 */
import type { ExecutionMode } from '@qlan-ro/mainframe-types';

export type ModeTone = 'caution' | 'warning' | undefined;

export interface PermissionMode {
  id: ExecutionMode;
  label: string;
  description: string;
  tone?: ModeTone;
}

/** Least to most permissive. */
export const PERMISSION_MODES: readonly PermissionMode[] = [
  { id: 'default', label: 'Interactive', description: 'Approve every action' },
  { id: 'acceptEdits', label: 'Auto-Edits', description: 'Edits applied, commands ask' },
  { id: 'auto', label: 'Auto', description: 'The agent decides what needs approval', tone: 'caution' },
  { id: 'yolo', label: 'Unattended', description: 'Runs without prompts', tone: 'warning' },
];

export function permissionLabel(mode: ExecutionMode): string {
  return PERMISSION_MODES.find((m) => m.id === mode)?.label ?? mode;
}

/** ⇧⇥ toggles Interactive and Auto-Edits, and steps down from the freer modes (C12). */
export function cyclePermission(mode: ExecutionMode): ExecutionMode {
  return mode === 'default' ? 'acceptEdits' : 'default';
}
