/**
 * ReviewDiffPane — center column: the per-file toolbar above the diff.
 * Composes ReviewFileToolbar + ReviewDiffView for the selected file, or an
 * empty prompt when nothing is selected. Split out of ReviewPanel to keep the
 * orchestrator small.
 */
import { ReviewFileToolbar } from './ReviewFileToolbar';
import { ReviewDiffView } from './ReviewDiffView';

interface ReviewDiffPaneProps {
  port: number;
  projectId: string;
  chatId?: string;
  file: string | null;
  additions: number;
  deletions: number;
  viewed: boolean;
  onToggleViewed: () => void;
  onOpenInWorkspace: () => void;
  onAppend: (text: string) => void;
}

export function ReviewDiffPane({
  port,
  projectId,
  chatId,
  file,
  additions,
  deletions,
  viewed,
  onToggleViewed,
  onOpenInWorkspace,
  onAppend,
}: ReviewDiffPaneProps) {
  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-caption text-muted-foreground">
        Select a file to review
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ReviewFileToolbar
        file={file}
        additions={additions}
        deletions={deletions}
        viewed={viewed}
        onToggleViewed={onToggleViewed}
        onOpenInWorkspace={onOpenInWorkspace}
      />
      <div className="min-h-0 flex-1">
        <ReviewDiffView port={port} projectId={projectId} chatId={chatId} file={file} onAppend={onAppend} />
      </div>
    </div>
  );
}
