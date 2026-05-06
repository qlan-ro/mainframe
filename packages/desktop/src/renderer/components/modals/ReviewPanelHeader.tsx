import React from 'react';
import { Button } from '../ui/button';
import { AlertCircle } from 'lucide-react';

interface ReviewPanelHeaderProps {
  isWorktree: boolean;
  onClose: () => void;
  filename?: string | null;
  mode?: 'inline' | 'split';
  onModeChange?: (mode: 'inline' | 'split') => void;
}

export const ReviewPanelHeader: React.FC<ReviewPanelHeaderProps> = ({
  isWorktree,
  onClose,
  filename,
  mode,
  onModeChange,
}) => {
  return (
    <div className="border-b border-mf-border">
      {/* Title bar: [title] [centered filename] [mode toggle | close] */}
      <div className="relative flex items-center justify-between px-6 py-4">
        <h2 className="text-lg font-semibold text-mf-text-primary">Review Changes</h2>

        {filename && (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center">
            <span className="truncate font-mono text-sm text-mf-text-secondary" title={filename}>
              {filename}
            </span>
          </div>
        )}

        <div className="relative flex items-center gap-2">
          {mode && onModeChange && (
            <>
              <Button
                variant={mode === 'inline' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('inline')}
                aria-label="Switch to inline diff view"
              >
                ≣ Inline
              </Button>
              <Button
                variant={mode === 'split' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('split')}
                aria-label="Switch to side-by-side diff view"
              >
                ⇄ Split
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close review panel"
            className="hover:bg-mf-hover"
          >
            ✕
          </Button>
        </div>
      </div>

      {/* Warning banner (only if not worktree) */}
      {!isWorktree && (
        <div className="flex gap-3 border-t border-mf-border bg-mf-hover px-6 py-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-mf-warning" />
          <p className="text-sm text-mf-text-secondary">
            Changes are not isolated to this chat. Review includes all uncommitted work in the project.
          </p>
        </div>
      )}
    </div>
  );
};
