'use client';

/**
 * TuningWarningDialog — the mid-session model/effort/feature confirm (todo #288).
 *
 * Pure presentation over the shared ConfirmDialog in its non-destructive variant:
 * all state lives in useTuningWarning, all copy in tuning-warning-copy. One dialog
 * serves all three control kinds, so there is one testid family to assert on.
 */

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { describeTuningChange } from './tuning-warning-copy';
import type { TuningChange } from './tuning-warning';

export interface TuningWarningDialogProps {
  pending: TuningChange | null;
  contextTokens: number | null;
  suppressChecked: boolean;
  onSuppressChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TuningWarningDialog({
  pending,
  contextTokens,
  suppressChecked,
  onSuppressChange,
  onConfirm,
  onCancel,
}: TuningWarningDialogProps) {
  if (pending == null) return null;

  const { title, body, confirmLabel } = describeTuningChange(pending, contextTokens);

  return (
    <ConfirmDialog
      open
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      suppress={{ label: "Don't warn again", checked: suppressChecked, onChange: onSuppressChange }}
      testid="composer-tuning-warning"
    />
  );
}
