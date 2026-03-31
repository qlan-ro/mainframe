import React from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ConflictViewProps {
  conflictFiles: { status: string; path: string }[];
  activeOperation?: 'merge' | 'rebase';
  onAbort: () => void;
  aborting: boolean;
}

export function ConflictView({
  conflictFiles,
  activeOperation,
  onAbort,
  aborting,
}: ConflictViewProps): React.ReactElement {
  const hasConflicts = conflictFiles.length > 0;
  const operationInProgress = !hasConflicts && activeOperation;

  return (
    <div className="min-w-[280px]">
      {/* Warning header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#7f1d1d] rounded-t">
        <AlertTriangle size={14} className="text-mf-destructive shrink-0" />
        <span className="text-sm font-semibold text-mf-destructive">
          {operationInProgress
            ? `${activeOperation === 'rebase' ? 'Rebase' : 'Merge'} in Progress`
            : 'Merge / Rebase Conflicts'}
        </span>
      </div>

      {operationInProgress ? (
        <div className="px-3 py-3 text-sm text-mf-text-secondary leading-relaxed">
          A {activeOperation} is in progress. Ask an agent to continue the {activeOperation}, use an external editor, or
          abort to return to the previous state.
        </div>
      ) : (
        <>
          {/* Conflict files */}
          <div className="max-h-40 overflow-y-auto py-1">
            {conflictFiles.map((f) => (
              <div key={f.path} className="flex items-center gap-2 px-3 py-1 text-sm">
                <span className="text-mf-destructive font-mono text-xs shrink-0">C</span>
                <span className="text-mf-text-primary truncate">{f.path}</span>
              </div>
            ))}
          </div>

          {/* Help text */}
          <div className="px-3 py-2 border-t border-mf-border">
            <p className="text-xs text-mf-text-secondary leading-relaxed">
              Ask an agent to resolve the conflicts, or use an external editor. Once resolved, stage and commit to
              complete the operation.
            </p>
          </div>
        </>
      )}

      {/* Abort button */}
      <div className="px-3 py-2 border-t border-mf-border">
        <button
          onClick={onAbort}
          disabled={aborting}
          className={cn(
            'w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded',
            'bg-mf-destructive text-white hover:opacity-80 transition-opacity',
            aborting && 'opacity-40 cursor-not-allowed',
          )}
        >
          <XCircle size={12} />
          {aborting ? 'Aborting...' : 'Abort'}
        </button>
      </div>
    </div>
  );
}
