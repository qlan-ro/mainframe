/**
 * ImportIssuesDialog — turns the repository's open issues into paired tasks.
 *
 * An issue that is already paired stays in the list, disabled: showing it and
 * refusing it is what makes a silent duplicate impossible.
 */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { RemoteIssue } from '@/lib/api/todos-github';
import { runOrToast } from './run-or-toast';
import { useGitHubSyncStore } from './use-github-sync-store';

interface RowProps {
  issue: RemoteIssue;
  selected: boolean;
  onToggle: (issueNumber: number) => void;
}

function IssueRow({ issue, selected, onToggle }: RowProps): React.ReactElement {
  const paired = issue.pairedTodoNumber !== null;

  return (
    <label
      data-testid={`tasks-github-import-issue-${issue.number}`}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
        paired ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-accent',
      )}
    >
      <Checkbox
        checked={selected}
        disabled={paired}
        onCheckedChange={() => onToggle(issue.number)}
        className="shrink-0"
      />
      <span className="shrink-0 font-mono text-label font-medium text-primary">#{issue.number}</span>
      <span className={cn('min-w-0 flex-1 truncate text-body', paired ? 'text-muted-foreground' : 'text-foreground')}>
        {issue.title}
      </span>
      {paired ? (
        <span className="shrink-0 text-caption text-muted-foreground">
          Already paired with task #{issue.pairedTodoNumber}
        </span>
      ) : (
        <span className="flex shrink-0 flex-wrap gap-1">
          {issue.labels.map((label) => (
            <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
              {label}
            </span>
          ))}
        </span>
      )}
    </label>
  );
}

export function ImportIssuesDialog(): React.ReactElement | null {
  const { dialog, issues, error, importIssues, closeDialog } = useGitHubSyncStore();
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set());
  const isOpen = dialog?.kind === 'import';

  // A fresh list every time it opens — a stale selection would import issues
  // the user picked before the last refetch.
  React.useEffect(() => {
    if (!isOpen) setSelected(new Set());
  }, [isOpen]);

  if (!isOpen) return null;

  const importable = issues.filter((issue) => issue.pairedTodoNumber === null).map((issue) => issue.number);
  const chosen = importable.filter((number) => selected.has(number));
  const allSelected = importable.length > 0 && chosen.length === importable.length;

  const toggle = (issueNumber: number): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(issueNumber)) next.add(issueNumber);
      return next;
    });

  const runImport = (): Promise<void> =>
    runOrToast('Import failed', async () => {
      await importIssues(chosen);
      closeDialog();
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogContent data-testid="tasks-github-import-dialog" className="flex max-h-[85vh] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Import issues</DialogTitle>
          <DialogDescription>
            Each imported issue becomes a task paired with it. Labels come across; Mainframe&apos;s own workflow labels
            are never taken from GitHub.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {issues.length === 0 ? (
            error !== null ? (
              <p data-testid="tasks-github-import-error" className="px-2 py-4 text-body text-destructive">
                {error}
              </p>
            ) : (
              <p className="px-2 py-4 text-body text-muted-foreground">No open issues to import.</p>
            )
          ) : (
            <>
              <label
                data-testid="tasks-github-import-all"
                className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5"
              >
                <Checkbox
                  checked={allSelected}
                  disabled={importable.length === 0}
                  onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(importable))}
                  className="shrink-0"
                />
                <span className="text-label font-medium text-foreground">Select all</span>
                <span className="text-caption text-muted-foreground">{issues.length} open</span>
              </label>
              {issues.map((issue) => (
                <IssueRow key={issue.number} issue={issue} selected={selected.has(issue.number)} onToggle={toggle} />
              ))}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2">
          <Button data-testid="tasks-github-import-cancel" variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            data-testid="tasks-github-import-confirm"
            disabled={chosen.length === 0}
            onClick={() => void runImport()}
          >
            {`Import ${chosen.length} ${chosen.length === 1 ? 'issue' : 'issues'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
