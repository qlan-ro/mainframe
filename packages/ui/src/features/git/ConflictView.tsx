/**
 * ConflictView — lists conflict files + Abort action; shown for an active
 * merge/rebase operation. No in-app conflict editor (parity with desktop).
 */
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { Button } from '@v2/components/ui/button';

export interface ConflictFile {
  status: string;
  path: string;
}

export interface ConflictViewProps {
  conflictFiles: ConflictFile[];
  activeOperation?: 'merge' | 'rebase';
  onAbort: () => void;
  aborting: boolean;
}

export function ConflictView({ conflictFiles, activeOperation, onAbort, aborting }: ConflictViewProps) {
  const hasConflicts = conflictFiles.length > 0;
  const operationInProgress = !hasConflicts && activeOperation;

  const headerLabel = operationInProgress
    ? `${activeOperation === 'rebase' ? 'Rebase' : 'Merge'} in Progress`
    : 'Merge / Rebase Conflicts';

  return (
    <div data-testid="git-conflict-view" className="min-w-[280px]">
      {/* No rounded-t here — the parent card (PANEL_CARD_SHELL) is overflow-hidden with
          the matching rounded corner, so this header bleeds edge-to-edge under it
          per the design's edge-to-edge danger header (finding 10.1). */}
      <div className="flex items-center gap-2 border-b border-destructive/15 bg-destructive/10 px-3 py-2">
        <AlertTriangle size={14} className="shrink-0 text-destructive" />
        <span className="text-sm font-semibold text-destructive">{headerLabel}</span>
        {hasConflicts && (
          <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 font-mono text-xs font-bold text-destructive">
            {conflictFiles.length}
          </span>
        )}
      </div>

      {operationInProgress ? (
        <div className="px-3 py-3 text-sm leading-relaxed text-muted-foreground">
          A {activeOperation} is in progress. Ask an agent to continue the {activeOperation}, use an external editor, or
          abort to return to the previous state.
        </div>
      ) : (
        <>
          <div className="max-h-40 overflow-y-auto py-1">
            {conflictFiles.map((f) => (
              <div key={f.path} className="flex items-center gap-2 px-3 py-1 text-sm">
                <span className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm bg-destructive/10 font-mono text-xs font-bold text-destructive">
                  C
                </span>
                <span className="truncate text-foreground" style={{ direction: 'rtl', textAlign: 'left' }}>
                  {f.path}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-border px-3 py-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ask an agent to resolve the conflicts, or use an external editor. Once resolved, stage and commit to
              complete the operation.
            </p>
          </div>
        </>
      )}

      <div className="border-t border-border px-3 py-2">
        <Button
          data-testid="git-conflict-abort"
          variant="destructive"
          size="sm"
          onClick={onAbort}
          disabled={aborting}
          className="w-full"
        >
          {aborting ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" strokeWidth={2.4} />}
          {aborting ? 'Aborting...' : 'Abort'}
        </Button>
      </div>
    </div>
  );
}
