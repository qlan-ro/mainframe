'use client';

/**
 * ProviderSwitchConfirm — "Continue this chat in Codex?" / "Go back to Claude?".
 *
 * The TuningWarningDialog recipe: the shared ConfirmDialog in its
 * non-destructive variant with a "Don't ask again" suppress. All state lives
 * in useProviderSwitch, all copy in provider-switch.ts.
 */
import { ConfirmDialog } from '@/features/shared/ConfirmDialog';
import { describeProviderSwitch } from './provider-switch';
import type { ProviderSwitchHook } from './use-provider-switch';

export function ProviderSwitchConfirm({ hook }: { hook: ProviderSwitchHook }) {
  const pending = hook.pending;
  // Rendered closed rather than early-returning null — see ConfirmDialog's
  // note on the Radix pointer-events leak.
  const copy =
    pending != null
      ? describeProviderSwitch(pending.fromName, pending.toName, pending.returning)
      : { title: '', body: undefined, confirmLabel: undefined };
  return (
    <ConfirmDialog
      open={pending != null}
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      cancelLabel="Cancel"
      onConfirm={hook.confirm}
      onCancel={hook.cancel}
      suppress={{ label: "Don't ask again", checked: hook.suppressChecked, onChange: hook.setSuppressChecked }}
      testid="composer-provider-switch-confirm"
    />
  );
}
