/**
 * Severity inks shared by the capsule and its popover. Normal use stays
 * neutral so it never pulls the eye; amber reads as warning, red as
 * destructive.
 */
import type { QuotaSeverity } from './quota-format';

export const QUOTA_PERCENT_TEXT: Record<QuotaSeverity, string> = {
  normal: 'text-foreground',
  amber: 'text-warning',
  red: 'text-destructive',
};

/** Re-tints `Progress`'s indicator rather than forking the primitive. */
export const QUOTA_BAR_FILL: Record<QuotaSeverity, string> = {
  normal: '*:data-[slot=progress-indicator]:bg-foreground',
  amber: '*:data-[slot=progress-indicator]:bg-warning',
  red: '*:data-[slot=progress-indicator]:bg-destructive',
};
