/**
 * GitConfirmDialog — app-root outlet for the git confirm bridge.
 * Reads the pending request from useGitConfirm and renders a ConfirmDialog
 * that resolves the bridge promise on confirm or cancel.
 */
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGitConfirm } from './use-git-confirm';

export function GitConfirmDialog() {
  const pending = useGitConfirm((s) => s.pending);
  const resolve = useGitConfirm((s) => s.resolve);
  return (
    <ConfirmDialog
      open={pending != null}
      title={pending?.title ?? ''}
      body={pending?.body}
      confirmLabel={pending?.confirmLabel}
      destructive={pending?.destructive}
      onConfirm={() => resolve(true)}
      onCancel={() => resolve(false)}
      testid="git-confirm-dialog"
    />
  );
}
