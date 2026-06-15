/**
 * ConflictView — lists conflict files + Abort action; shown for an active
 * merge/rebase operation. No in-app conflict editor (parity with desktop).
 */
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      <div className="flex items-center gap-2 px-3 py-2 bg-mf-destructive-tint rounded-t">
        <AlertTriangle size={14} className="text-destructive shrink-0" />
        <span className="text-body font-semibold text-destructive">{headerLabel}</span>
        {hasConflicts && (
          <span className="font-mono text-caption font-bold text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5 shrink-0">
            {conflictFiles.length}
          </span>
        )}
      </div>

      {operationInProgress ? (
        <div className="px-3 py-3 text-body text-muted-foreground leading-relaxed">
          A {activeOperation} is in progress. Ask an agent to continue the {activeOperation}, use an external editor, or
          abort to return to the previous state.
        </div>
      ) : (
        <>
          <div className="max-h-40 overflow-y-auto py-1">
            {conflictFiles.map((f) => (
              <div key={f.path} className="flex items-center gap-2 px-3 py-1 text-body">
                <span className="text-destructive font-mono text-caption shrink-0">C</span>
                <span className="text-foreground truncate" style={{ direction: 'rtl', textAlign: 'left' }}>
                  {f.path}
                </span>
              </div>
            ))}
          </div>

          <div className="px-3 py-2 border-t border-border">
            <p className="text-caption text-muted-foreground leading-relaxed">
              Ask an agent to resolve the conflicts, or use an external editor. Once resolved, stage and commit to
              complete the operation.
            </p>
          </div>
        </>
      )}

      <div className="px-3 py-2 border-t border-border">
        <button
          data-testid="git-conflict-abort"
          onClick={onAbort}
          disabled={aborting}
          className={cn(
            'w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-body rounded',
            'bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity',
            aborting && 'opacity-40 cursor-not-allowed',
          )}
        >
          {aborting ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
          {aborting ? 'Aborting...' : 'Abort'}
        </button>
      </div>
    </div>
  );
}
