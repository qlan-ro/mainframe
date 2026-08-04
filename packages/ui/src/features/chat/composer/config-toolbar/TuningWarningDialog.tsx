'use client';

/**
 * TuningWarningDialog — the mid-session model/effort/feature confirm (todo #288).
 *
 * Pure presentation over the shared ConfirmDialog in its non-destructive variant:
 * all state lives in useTuningWarning, all copy in tuning-warning-copy. One dialog
 * serves all three control kinds, so there is one testid family to assert on.
 */

import { ConfirmDialog } from '@v2/features/shared/ConfirmDialog';
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
  // Rendered closed rather than early-returning null — see ConfirmDialog's
  // note on the Radix pointer-events leak.
  const { title, body, confirmLabel } =
    pending != null
      ? describeTuningChange(pending, contextTokens)
      : { title: '', body: undefined, confirmLabel: undefined };

  return (
    <ConfirmDialog
      open={pending != null}
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
