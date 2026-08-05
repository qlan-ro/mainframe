/**
 * ConfirmDialogHost — app-root outlet for the confirm bridge.
 * Reads the pending request from useConfirmBridge and renders a ConfirmDialog
 * that resolves the bridge promise on confirm or cancel.
 */
import { ConfirmDialog } from '@v2/features/shared/ConfirmDialog';
import { useConfirmBridge } from '@/lib/confirm-bridge';

export function ConfirmDialogHost() {
  const pending = useConfirmBridge((s) => s.pending);
  const resolve = useConfirmBridge((s) => s.resolve);
  return (
    <ConfirmDialog
      open={pending != null}
      title={pending?.title ?? ''}
      body={pending?.body}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      destructive={pending?.destructive}
      onConfirm={() => resolve(true)}
      onCancel={() => resolve(false)}
      testid={pending?.testid ?? 'confirm-dialog'}
    />
  );
}
