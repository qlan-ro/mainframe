/** Save-status chip shown in the ViewerShell header actions slot. */
export function SaveStatusChip({ dirty }: { dirty: boolean }) {
  if (dirty) {
    return (
      <span
        data-testid="editor-save-status"
        className="rounded-[4px] bg-mf-warning-tint px-[5px] py-[1px] font-mono text-caption text-foreground"
      >
        <span className="text-mf-warning" aria-hidden>
          ●
        </span>{' '}
        unsaved
      </span>
    );
  }
  return (
    <span
      data-testid="editor-save-status"
      className="rounded-[4px] bg-mf-success-tint px-[5px] py-[1px] font-mono text-caption text-muted-foreground"
    >
      <span className="text-mf-success" aria-hidden>
        ●
      </span>{' '}
      saved
    </span>
  );
}
